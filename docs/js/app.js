const D = window.COMMUTE;

const trips = D.trips.map((trip) => ({ ...trip, dateObj: Format.parseDate(trip.date) }));

const state = { timeline: "all", plannerDirection: 0 };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function primaryPairs() {
  return D.overview.pairs.filter((p) => p.route_work === "A" && p.route_home === "A");
}

function coefficient(term) {
  return D.inference.ols.coefficients.find((c) => c.term === term);
}

function seconds(minutes) {
  return Math.round(minutes * 60);
}

function fitnessSwing() {
  const buckets = D.interpretation.season_learning.buckets;
  return buckets[0].adjusted - d3.min(buckets, (b) => b.adjusted);
}

function likeForLike() {
  const rows = D.inference.trend.season_effects_fitness_adjusted.filter((d) => d.season >= 2022 && d.season <= 2024);
  return d3.mean(rows, (d) => d.estimate);
}

function fillHeadline() {
  const h = D.overview.headline;
  const gap = D.inference.direction_gap;
  const best = D.modelling.cv.find((row) => row.model === D.modelling.best_model);
  const kpis = [
    [h.trips, "trips logged"],
    [d3.format(",")(Math.round(h.total_miles)), "miles ridden"],
    [`+${Format.clock(gap.median_gap)}`, "slower going home"],
    [D.weather ? `${D.weather.headwind_seconds_per_mph.toFixed(0)}s` : "–", "per mph of headwind"],
    [best.r2_mean.toFixed(2), "out-of-sample R²"],
  ];
  d3.select("#kpis").selectAll("div").data(kpis).join("div").attr("class", "kpi")
    .html(([value, label]) => `<div class="kpi-value">${value}</div><div class="kpi-label">${label}</div>`);
}

function fillFindings() {
  const gap = D.inference.direction_gap;
  const cold = D.inference.cold_penalty;
  const w = D.weather;
  const cards = [
    [`+${Format.clock(gap.median_gap)}`, "Home is always slower", `Slower on all ${gap.n_pairs} days ridden both ways on the same route.`, "#direction"],
    [w ? `${w.headwind_seconds_per_mph.toFixed(0)}s` : "–", "Per mph of headwind", "Wind matters, but evenings bring a tailwind home, so it doesn't explain the gap.", "#direction"],
    [`−${seconds(fitnessSwing())}s`, "Fitness builds each season", "From the first ride of a season to peak form, levelling off after about 15 rides.", "#fitness"],
    [`${Math.round(cold.share_explained_by_fitness * 100)}%`, "Of the cold penalty is fitness", "Cold mornings come early in the season, when the legs are least trained.", "#fitness"],
    [`−${Math.abs(seconds(likeForLike()))}s`, "Faster than 2019, like for like", "Rides fell from 56 a year to single digits. The rider didn't slow down.", "#years"],
  ];
  d3.select("#finding-cards").selectAll("a").data(cards).join("a").attr("href", (d) => d[3]).attr("class", "finding reveal block")
    .html(([value, title, body]) =>
      `<div class="finding-number">${value}</div><h3 class="mt-4 font-display text-lg font-semibold">${title}</h3>` +
      `<p class="mt-2 text-sm leading-relaxed text-brand-muted">${body}</p>`);
}

function fillDirection() {
  const gap = D.inference.direction_gap;
  d3.select("#direction-lede").html(
    `On every one of the ${gap.n_pairs} days ridden both ways on Route A, the trip home took longer, by a median of <strong>${Format.clock(gap.median_gap)}</strong>. Same rider, same bike, same day, same route. Only the direction changes.`
  );
}

function fillWeather() {
  const w = D.weather;
  if (!w) return;
  const home = w.by_direction.Home;
  const work = w.by_direction.Work;
  const rain = w.other_weather.precipitation;
  d3.select("#weather-lede").html(
    `The original log had no wind or rain, so hourly weather for central Pittsburgh was pulled from the Open-Meteo historical archive for every ride day. Each ride's departure hour was found by matching its recorded temperature to the hourly readings (median mismatch ${w.temperature_match_error_median}°F). ` +
      `Testing every compass bearing, held-out trips are predicted best if the ride to work heads <strong>${Math.round(w.work_bearing_deg)}°, west-north-west</strong> (90% CI ${w.work_bearing_ci[0]}–${w.work_bearing_ci[1]}°). ` +
      `On that line, each mph of headwind costs <strong>${w.headwind_seconds_per_mph.toFixed(1)} seconds</strong>.`
  );
  const tiles = [
    [`${w.headwind_seconds_per_mph.toFixed(1)}s`, `per mph of headwind (90% CI ${w.headwind_seconds_ci[0]}–${w.headwind_seconds_ci[1]}s)`],
    [`${w.cv_r_squared_without_wind.toFixed(3)} → ${w.cv_r_squared_with_wind.toFixed(3)}`, `out-of-sample R² with wind; held-out error ${Math.round(w.cv_rmse_without_wind_s)}s → ${Math.round(w.cv_rmse_with_wind_s)}s, better in ${Math.round(w.wind_better_share * 100)}% of folds`],
    [`${home.mean_wind_mph} vs ${work.mean_wind_mph} mph`, "average wind on the ride home vs. to work"],
    [`+${Math.round(rain.estimate * 6)}s`, `per 0.1 in of rain in the hour, but only ${w.rainy_trips} wet rides and no out-of-sample gain`],
  ];
  d3.select("#weather-tiles").selectAll("div").data(tiles).join("div").attr("class", "stat")
    .html(([v, l]) => `<div class="stat-value">${v}</div><div class="stat-label">${l}</div>`);
  d3.select("#weather-callout").html(
    `<strong>Wind rules itself out as the cause of the slow ride home.</strong> Evening winds are stronger, but they blow from about ${Math.round(home.wind_from_deg)}°, which on this route is a <em>tailwind</em> home (${Math.abs(home.mean_headwind_mph)} mph on average). ` +
      `Controlling for wind makes the home penalty slightly larger, ${w.home_penalty_without_wind.toFixed(2)} → ${w.home_penalty_with_wind.toFixed(2)} minutes. What remains points to the road itself: most likely a net climb toward home, or evening traffic and lights.`
  );
}

function fillFitness() {
  const ride = coefficient("season_ride_number");
  const cold = D.inference.cold_penalty;
  const steps = cold.steps;
  d3.select("#fitness-lede").html(
    `Each ride in a season makes the next about <strong>${Math.abs(seconds(ride.estimate))} seconds faster</strong>, worth about ${seconds(fitnessSwing())} seconds from the first ride to peak form. ` +
      `Cold mornings look costly (${seconds(steps[0].penalty_minutes)}s at ${cold.cold_f}°F vs. ${cold.mild_f}°F), but they cluster early in the season. Account for fitness and the cold penalty drops to <strong>${seconds(steps[steps.length - 1].penalty_minutes)} seconds</strong>. Heat costs nothing.`
  );
  d3.select("#cold-sub").text(`Extra seconds on a ${cold.cold_f}°F vs. ${cold.mild_f}°F morning, as each control is added.`);
}

function fillYears() {
  const trend = D.inference.trend;
  d3.select("#years-lede").html(
    `Taken at face value, trips get ${trend.naive_years_coef_seconds}s slower each year. But the bike came out ${D.overview.frequency[0].trips} times in 2019 and far less since, so later seasons rarely got past the slow early rides. ` +
      `Compare like for like and the 2022–24 seasons were <strong>${Math.abs(seconds(likeForLike()))}s faster</strong> than 2019.`
  );
}

function fillModels() {
  const cv = D.modelling.cv;
  const best = cv[0];
  const linear = cv.find((r) => r.model === "Linear regression");
  const baseline = cv.find((r) => r.model.includes("baseline"));
  d3.select("#models-lede").html(
    `The best model, an ensemble of a spline model, a Gaussian process and gradient boosting, predicts a trip within about <strong>${seconds(best.rmse_mean)} seconds</strong> (out-of-sample R² ${best.r2_mean.toFixed(2)}), against ${seconds(baseline.rmse_mean)}s for direction alone. ` +
      `Plain linear regression comes within ${seconds(linear.rmse_mean - best.rmse_mean)} seconds: no hidden thresholds, just a few smooth effects and about a minute of day-to-day noise.`
  );
}

function fillPlanner() {
  const conformal = D.modelling.conformal;
  d3.select("#planner-lede").html(
    `The model's predictions come with a 90% range of ±${Format.clock(D.planner.half_width)}, which held ${Math.round(conformal.empirical_coverage * 100)}% of the time in testing. Pick the conditions to get a leave-by time.`
  );
  const temp = document.getElementById("pl-temp");
  const month = document.getElementById("pl-month");
  const ride = document.getElementById("pl-ride");
  const arrive = document.getElementById("pl-arrive");
  ride.max = D.planner.ride_numbers.length - 1;
  month.max = D.planner.months.length - 1;
  [temp, month, ride, arrive].forEach((input) => input.addEventListener("input", updatePlanner));
  updatePlanner();
}

function setFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

function updatePlanner() {
  const temp = document.getElementById("pl-temp");
  const month = document.getElementById("pl-month");
  const ride = document.getElementById("pl-ride");
  [temp, month, ride].forEach(setFill);
  const p = D.planner;
  const tIndex = p.temperatures.indexOf(Number(temp.value));
  const mIndex = Number(month.value);
  const rIndex = Number(ride.value);
  const prediction = p.predictions[state.plannerDirection][mIndex][rIndex][tIndex];
  const upper = prediction + p.half_width;
  document.getElementById("pl-temp-out").textContent = `${temp.value}°F`;
  document.getElementById("pl-month-out").textContent = MONTH_NAMES[p.months[mIndex] - 1];
  document.getElementById("pl-ride-out").textContent = `ride #${p.ride_numbers[rIndex]}`;
  document.getElementById("pl-pred").textContent = Format.clock(prediction);
  document.getElementById("pl-range").textContent = `90% interval ${Format.clock(prediction - p.half_width)} – ${Format.clock(upper)}`;
  const [hh, mm] = document.getElementById("pl-arrive").value.split(":").map(Number);
  const leave = new Date(2026, 0, 1, hh, mm);
  leave.setSeconds(leave.getSeconds() - Math.ceil(upper * 60));
  document.getElementById("pl-leave").textContent = d3.timeFormat("%-I:%M")(leave);
  document.getElementById("pl-note").textContent =
    `Route A, ${state.plannerDirection ? "to home" : "to work"}, typical layoff, current-year fitness. Predictions outside the observed temperature range (26–90°F) are extrapolations.`;
  Charts.plannerBar("#pl-bar", prediction, p.half_width, state.plannerDirection ? "Home" : "Work");
}

function fillImplications() {
  const gap = D.inference.direction_gap;
  const items = [
    ["Ride more often", `Two or three rides a week keeps you at peak form, worth about ${seconds(fitnessSwing())} seconds a trip. It's the biggest lever.`],
    ["Budget the ride home separately", `Plan on about 33 minutes in and 39 out. The evening ride is ${Format.clock(gap.median_gap)} slower every time.`],
    ["Check the wind, not the thermometer", "A 10 mph headwind costs over a minute; a cold morning costs under one once fitness is accounted for."],
    ["Take Route D to work", "It's 0.1 mile shorter, which saves about 25 seconds. Avoid Route B, which adds about 4 minutes."],
  ];
  d3.select("#implication-list").selectAll("div").data(items).join("div").attr("class", "implication reveal")
    .html(([title, body], i) =>
      `<div class="implication-index">${String(i + 1).padStart(2, "0")}</div><div><h3 class="font-display text-lg font-semibold">${title}</h3><p class="mt-2 text-sm leading-relaxed text-brand-muted">${body}</p></div>`);
  d3.select("#caveat").text(
    "Based on 143 trips. Weather is hourly reanalysis for central Pittsburgh (Open-Meteo), matched to each ride by its recorded temperature. Elevation and traffic weren't recorded, and results are associations, not experiments."
  );
  d3.select("#generated").text(`Analysis run ${D.generated}`);
}

function renderCharts() {
  Charts.timeline("#timeline", trips, state.timeline);
  Charts.slope("#slope", primaryPairs());
  if (D.weather) {
    Charts.windCompass("#wind-compass", D.weather);
    Charts.windScatter("#wind-scatter", D.weather);
    if (D.weather.ablation) Charts.ablation("#ablation", D.weather.ablation);
  }
  Charts.learning("#learning", D.interpretation.season_learning, D.interpretation.curves.season_ride_number.ensemble);
  Charts.coldPenalty("#cold-penalty", D.inference.cold_penalty);
  Charts.frequency("#frequency", D.overview.frequency);
  Charts.seasonEffects("#season-effects", D.inference.trend.season_effects, D.inference.trend.season_effects_fitness_adjusted);
  Charts.leaderboard("#leaderboard", D.modelling.cv, D.modelling.best_model);
  updatePlanner();
}

function bindSegments() {
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
      if (seg.dataset.target === "timeline") {
        state.timeline = button.dataset.value;
        Charts.timeline("#timeline", trips, state.timeline);
      }
      if (seg.dataset.target === "planner-direction") {
        state.plannerDirection = Number(button.dataset.value);
        document.getElementById("pl-arrive").value = state.plannerDirection ? "18:00" : "08:30";
        updatePlanner();
      }
    });
  });
}

function bindScroll() {
  const bar = document.getElementById("progress");
  const topbar = document.getElementById("topbar");
  const links = [...document.querySelectorAll(".nav-link")];
  const sections = links.map((link) => document.querySelector(link.getAttribute("href")));
  const brandWheel = document.querySelector(".brand-wheel");
  const onScroll = () => {
    if (brandWheel) brandWheel.style.transform = `rotate(${(window.scrollY * 0.35).toFixed(1)}deg)`;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = `${(window.scrollY / max) * 100}%`;
    topbar.classList.toggle("scrolled", window.scrollY > 24);
    let current = -1;
    sections.forEach((section, i) => {
      if (section && section.getBoundingClientRect().top < window.innerHeight * 0.35) current = i;
    });
    links.forEach((link, i) => link.classList.toggle("active", i === current));
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  document.querySelectorAll(".section-head, .card, .callout").forEach((node) => node.classList.add("reveal"));
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      }),
    { threshold: 0.08 }
  );
  document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
}

function bindMenu() {
  const menu = document.getElementById("menu");
  const setOpen = (open) => {
    menu.classList.toggle("open", open);
    menu.setAttribute("aria-hidden", String(!open));
    document.body.style.overflow = open ? "hidden" : "";
  };
  document.getElementById("menu-open").addEventListener("click", () => setOpen(true));
  document.getElementById("menu-close").addEventListener("click", () => setOpen(false));
  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}

function init() {
  fillHeadline();
  fillFindings();
  fillDirection();
  fillWeather();
  fillFitness();
  fillYears();
  fillModels();
  fillPlanner();
  fillImplications();
  bindSegments();
  renderCharts();
  bindScroll();
  bindMenu();
  let width = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    clearTimeout(window.__resizeTimer);
    window.__resizeTimer = setTimeout(renderCharts, 180);
  });
}

init();
