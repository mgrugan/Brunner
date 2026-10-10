const D = window.COMMUTE;

const trips = D.trips.map((trip) => {
  const dateObj = Format.parseDate(trip.date);
  return { ...trip, dateObj, dayOfYear: d3.timeDay.count(d3.timeYear(dateObj), dateObj) + 1 };
});

const state = {
  timeline: "all",
  temperature: "Work",
  surface: "Work",
  routes: "Work",
  plannerDirection: 0,
};

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

function fillHeadline() {
  const h = D.overview.headline;
  const gap = D.inference.direction_gap;
  const best = D.modelling.cv.find((row) => row.model === D.modelling.best_model);
  const kpis = [
    [h.trips, "trips logged"],
    [d3.format(",")(Math.round(h.total_miles)), "miles ridden"],
    [`${h.total_hours}h`, "in the saddle"],
    [`+${Format.clock(gap.median_gap)}`, "median home penalty"],
    [best.r2_mean.toFixed(2), "cross-validated R²"],
  ];
  d3.select("#kpis")
    .selectAll("div")
    .data(kpis)
    .join("div")
    .attr("class", "kpi")
    .html(([value, label]) => `<div class="kpi-value">${value}</div><div class="kpi-label">${label}</div>`);
}

function fillFindings() {
  const gap = D.inference.direction_gap;
  const cold = D.inference.cold_penalty;
  const buckets = D.interpretation.season_learning.buckets;
  const fitnessGain = buckets[0].adjusted - d3.min(buckets, (b) => b.adjusted);
  const adjusted = D.inference.trend.season_effects_fitness_adjusted.filter((d) => d.season >= 2022 && d.season <= 2024);
  const likeForLike = d3.mean(adjusted, (d) => d.estimate);
  const cards = [
    [
      `+${Format.clock(gap.median_gap)}`,
      "Home is always slower",
      `The ride home was slower on ${gap.n_pairs} of ${gap.n_pairs} paired days. Direction alone explains about 80% of the variance in trip time.`,
      "#direction",
    ],
    [
      `−${Format.clock(fitnessGain)}`,
      "Fitness rebuilds each season",
      `From a season's first ride to peak form, the same trip gets about ${seconds(fitnessGain)} seconds faster, levelling off after roughly 15 rides.`,
      "#fitness",
    ],
    [
      `${Math.round(cold.share_explained_by_fitness * 100)}%`,
      "Cold gets too much blame",
      `The raw cold-morning penalty is ${seconds(cold.steps[0].penalty_minutes)}s. This share of it disappears once early-season fitness and the calendar are controlled.`,
      "#temperature",
    ],
    [
      Format.signedSeconds(likeForLike),
      "Riding less, not slower",
      `Trips fell from 56 a year to single digits. Like-for-like, the 2022–24 seasons were about ${Math.abs(seconds(likeForLike))} seconds faster than 2019.`,
      "#years",
    ],
  ];
  d3.select("#finding-cards")
    .selectAll("a")
    .data(cards)
    .join("a")
    .attr("href", (d) => d[3])
    .attr("class", "finding reveal block")
    .html(
      ([value, title, body]) =>
        `<div class="finding-number">${value}</div><h3 class="mt-4 font-display text-lg font-semibold">${title}</h3>` +
        `<p class="mt-2 text-sm leading-relaxed text-brand-muted">${body}</p>` +
        `<span class="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-orange">Explore <span aria-hidden="true">→</span></span>`
    );
}

function fillDirection() {
  const gap = D.inference.direction_gap;
  const home = coefficient("is_home");
  const paired = D.overview.paired;
  const residuals = D.inference.same_day_residuals;
  d3.select("#direction-lede").html(
    `On all <strong>${gap.n_pairs}</strong> days with a Route A ride in both directions, the trip home took longer: a median of <strong>${Format.clock(gap.median_gap)}</strong> extra (95% bootstrap CI ${gap.median_gap_ci[0].toFixed(1)}–${gap.median_gap_ci[1].toFixed(1)} min, Wilcoxon ${Format.p(gap.wilcoxon_p_value)}, Cohen's d<sub>z</sub> = ${gap.cohens_dz}). ` +
      `Holding temperature, fitness, layoff and year constant, the regression puts the penalty at <strong>+${home.estimate.toFixed(2)} min</strong> (95% CI ${home.ci_low.toFixed(2)}–${home.ci_high.toFixed(2)}).`
  );
  const stats = [
    [`${gap.n_pairs}/${gap.n_pairs}`, "days home was slower"],
    [`${gap.min_gap.toFixed(1)}–${gap.max_gap.toFixed(1)}m`, "smallest to largest gap"],
    [`+${paired.mean_temp_rise}°F`, "warmer on the way home"],
    [`r = ${residuals.r.toFixed(2)}`, "same-day residual link"],
  ];
  d3.select("#direction-stats")
    .selectAll("div")
    .data(stats)
    .join("div")
    .attr("class", "stat")
    .html(([v, l]) => `<div class="stat-value">${v}</div><div class="stat-label">${l}</div>`);
  d3.select("#direction-callout").html(
    `<strong>Why home is slower.</strong> The data has no elevation, wind or traffic, so the gap can't be pinned on a single cause. It does rule some out. ` +
      `Not temperature: evenings are ${paired.mean_temp_rise}°F warmer on average, and warmth doesn't slow these rides. ` +
      `Not a "bad day" effect either: a day-level random intercept absorbs essentially no variance (ICC ≈ ${D.inference.mixed_model.icc.toFixed(2)}), and a slow morning does not predict a slow evening (r = ${residuals.r.toFixed(2)}, ${Format.p(residuals.p_value)}). ` +
      `A gap this steady, ${Format.clock(gap.min_gap)} even on the best day, points to something built into the route: <strong>a net climb toward home, prevailing afternoon headwinds, or heavier evening traffic</strong>.`
  );
}

function fillTemperature() {
  const cold = D.inference.cold_penalty;
  const steps = cold.steps;
  const gp = D.interpretation.gp_relevance.find((d) => d.feature === "temperature_f");
  d3.select("#temperature-lede").html(
    `On raw numbers a ${cold.cold_f}°F morning costs about <strong>${seconds(steps[0].penalty_minutes)} seconds</strong> more than a ${cold.mild_f}°F one. But cold mornings are not random. They cluster at the start of each season (Spearman ρ = ${cold.spearman_temp_ride} with ride number, ${cold.spearman_temp_doy} with day of year), when the legs are least trained. ` +
      `Separate the two and the cold penalty falls to <strong>${seconds(steps[steps.length - 1].penalty_minutes)} seconds</strong>, with a 90% interval that reaches zero. On the ride home, temperature shows no detectable effect between 55°F and 90°F, so heat costs nothing.`
  );
  d3.select("#cold-sub").text(`Work trips on Route A, ${cold.cold_f}°F vs. ${cold.mild_f}°F, as controls are added. Bars show 90% bootstrap intervals.`);
  d3.select("#cold-note").html(
    `Given every feature at once, the Gaussian process pushes temperature's length-scale to its upper bound (${gp.length_scale}) and credits the seasonal signal to ride number instead. With drivers this tangled, naming a single cause is a modelling choice, so the fair estimate is a range: <strong class="text-brand-ink">${seconds(steps[steps.length - 1].penalty_minutes)}–${seconds(steps[0].penalty_minutes)}s</strong>.`
  );
}

function fillFitness() {
  const ride = coefficient("season_ride_number");
  const layoff = coefficient("log_days_since_last_ride");
  const curve = D.interpretation.curves.season_ride_number.ensemble;
  const buckets = D.interpretation.season_learning.buckets;
  const gain = buckets[0].adjusted - d3.min(buckets, (b) => b.adjusted);
  const modelGain = curve.pdp[0] - d3.min(curve.pdp);
  d3.select("#fitness-lede").html(
    `Ride number within a season is the second-strongest driver of trip time. Each extra ride shaves about <strong>${Math.abs(seconds(ride.estimate))} seconds</strong> off the next (95% CI ${Math.abs(seconds(ride.ci_high))}–${Math.abs(seconds(ride.ci_low))}s, ${Format.p(ride.p_value)}). ` +
      `Flexible models show the effect is a learning curve rather than a straight line, steep for the first dozen rides and flat after about 15. Bucket averages put the total at <strong>${seconds(gain)} seconds</strong>; the ensemble's partial dependence, which also separates out the calendar, puts it as high as ${Format.clock(modelGain)}. ` +
      `Time off between rides adds a little rust on top (+${seconds(layoff.estimate)}s per log-day, ${Format.p(layoff.p_value)}).`
  );
}

function fillYears() {
  const trend = D.inference.trend;
  const freq = D.overview.frequency;
  const first = freq.find((d) => d.season === 2019);
  const adjusted = trend.season_effects_fitness_adjusted.filter((d) => d.season >= 2022 && d.season <= 2024);
  d3.select("#years-lede").html(
    `The raw data suggests a slowly ageing rider: holding direction and temperature fixed, trips get <strong>${trend.naive_years_coef_seconds}s slower per year</strong> (${Format.p(trend.naive_years_p)}), and 2026 is the slowest season yet. ` +
      `But the bike came out ${first.trips} times in 2019 and far less since, so later seasons rarely got past the slow early part of the fitness curve. ` +
      `Control for ride number and layoff and the sign flips to <strong>${trend.adjusted_years_coef_seconds}s per year</strong>. Like for like, the 2022–24 seasons were ${Math.abs(seconds(d3.mean(adjusted, (d) => d.estimate)))}s <em>faster</em> than 2019. The rider hasn't slowed down. The riding habit has.`
  );
  const tiles = [
    [`${trend.naive_years_coef_seconds > 0 ? "+" : ""}${trend.naive_years_coef_seconds}s/yr`, "Naive trend (direction & temperature only)"],
    [`${trend.adjusted_years_coef_seconds}s/yr`, "Trend after controlling ride number & layoff"],
    [`${trend.theil_sen_seconds_per_year}s/yr`, `Theil–Sen on residuals (Kendall τ = ${trend.kendall_tau}, ${Format.p(trend.kendall_p)})`],
  ];
  d3.select("#trend-tiles")
    .selectAll("div")
    .data(tiles)
    .join("div")
    .attr("class", "stat")
    .html(([v, l]) => `<div class="stat-value text-2xl">${v}</div><div class="stat-label">${l}</div>`);
}

function fillRoutes() {
  const routes = D.inference.routes;
  const d = coefficient("C(route, Treatment('A'))[T.D]");
  const b = coefficient("C(route, Treatment('A'))[T.B]");
  const distanceSaving = (0.1 / 13.4) * 60;
  d3.select("#routes-lede").html(
    `Route A carries ${Math.round(D.overview.headline.share_primary_route * 100)}% of all trips. On the way to work, Route D averaged <strong>${Format.clock(routes.work_route_d_mean)}</strong> against Route A's ${Format.clock(routes.work_route_a_mean)}, which on its own looks significant (Mann–Whitney ${Format.p(routes.mann_whitney_p)}). ` +
      `But D was ridden only in late summer and autumn, at peak season fitness. In the same autumn-2019 window, A averaged ${Format.clock(routes.autumn_2019_route_a_mean)} vs. D's ${Format.clock(routes.autumn_2019_route_d_mean)} (${Format.p(routes.autumn_2019_mann_whitney_p)}). ` +
      `The adjusted D effect is <strong>${Format.signedSeconds(d.estimate)}</strong>, almost exactly the ${Math.round(distanceSaving * 60)}s you would expect from riding 0.1 mile less. Route B, a mile longer, costs about ${Format.clock(b.estimate)} extra, in line with its distance.`
  );
  const compare = [
    ["Raw mean difference", routes.work_route_d_mean - routes.work_route_a_mean, Palette.sky],
    ["Same-window difference", routes.autumn_2019_route_d_mean - routes.autumn_2019_route_a_mean, Palette.sky],
    ["Regression-adjusted", d.estimate, Palette.orange],
    ["Expected from 0.1 mi shorter", -distanceSaving, Palette.muted],
  ];
  const maxAbs = d3.max(compare, (c) => Math.abs(c[1]));
  d3.select("#route-compare")
    .selectAll("div")
    .data(compare)
    .join("div")
    .html(
      ([label, value, color]) =>
        `<div class="flex items-baseline justify-between text-sm"><span class="text-brand-muted">${label}</span><span class="font-mono font-semibold">${Format.signedSeconds(value)}</span></div>` +
        `<div class="bar-track mt-2"><div class="bar-fill" style="width:${(Math.abs(value) / maxAbs) * 100}%;background:${color}"></div></div>`
    );
}

function fillModels() {
  const cv = D.modelling.cv;
  const best = cv[0];
  const linear = cv.find((r) => r.model === "Linear regression");
  const baseline = cv.find((r) => r.model.includes("baseline"));
  d3.select("#models-lede").html(
    `Seven models, from a direction-only baseline to an ARD Gaussian process, were scored with repeated cross-validation grouped by ride day. An averaging ensemble of GAM (smooth spline curves), Gaussian process and LightGBM (boosted decision trees) wins at <strong>${seconds(best.rmse_mean)}s RMSE</strong> (R² ${best.r2_mean.toFixed(2)}), against ${seconds(baseline.rmse_mean)}s for the baseline. ` +
      `A plain linear model lands within ${seconds(linear.rmse_mean - best.rmse_mean)}s of the winner, which is a result in itself: the flexible learners found <strong>no hidden interactions or thresholds</strong>, only smooth, mostly additive effects plus about a minute of irreducible day-to-day noise. Forward-in-time tests add one caution: splines on "years elapsed" extrapolate badly when only one or two seasons are available (the GAM's 2022–23 errors).`
  );
  Charts.leaderboard("#leaderboard", cv, D.modelling.best_model);
  renderForwardTable();
  renderImportance();
  renderAnomalies();
}

function renderForwardTable() {
  const rows = D.modelling.forward;
  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  const models = D.modelling.cv.map((r) => r.model);
  const lookup = new Map(rows.map((r) => [`${r.model}|${r.season}`, r]));
  const color = d3.scaleSequential().domain([30, 110]).interpolator(d3.interpolateRgb(Palette.brandNavy, Palette.orange)).clamp(true);
  const header = `<tr><th>Model</th>${seasons.map((s) => `<th class="num">${s}<div class="font-normal normal-case tracking-normal">n=${lookup.get(`${models[0]}|${s}`).n}</div></th>`).join("")}</tr>`;
  const body = models
    .map((model) => {
      const cells = seasons
        .map((s) => {
          const mae = lookup.get(`${model}|${s}`).mae * 60;
          const textColor = mae > 80 ? Palette.deep : Palette.ink;
          return `<td class="heat-cell" style="background:${color(mae)};color:${textColor}">${Math.round(mae)}</td>`;
        })
        .join("");
      return `<tr><td class="whitespace-nowrap pr-4">${model}</td>${cells}</tr>`;
    })
    .join("");
  d3.select("#forward").html(`<table class="data-table" style="border-collapse:separate;border-spacing:3px">${header}${body}</table>`);
}

function renderImportance() {
  const shap = D.interpretation.shap.importance;
  const perm = Object.fromEntries(D.interpretation.permutation["Gradient boosting (LightGBM)"].map((d) => [d.feature, d.rmse_increase]));
  const gp = Object.fromEntries(D.interpretation.gp_relevance.filter((d) => d.relevance !== null).map((d) => [d.feature, d.relevance]));
  const maxShap = d3.max(shap, (d) => d.mean_abs_shap);
  const maxPerm = d3.max(Object.values(perm));
  const bar = (value, max, color) => `<div class="bar-track hidden w-10 xl:block"><div class="bar-fill" style="width:${Math.max((value / max) * 100, 2)}%;background:${color}"></div></div>`;
  const rows = shap
    .map(
      (d) =>
        `<tr><td>${d.label}</td>` +
        `<td><div class="flex items-center justify-end gap-2"><span class="font-mono text-xs">${(d.mean_abs_shap * 60).toFixed(0)}s</span>${bar(d.mean_abs_shap, maxShap, Palette.orange)}</div></td>` +
        `<td><div class="flex items-center justify-end gap-2"><span class="font-mono text-xs">${(perm[d.feature] * 60).toFixed(0)}s</span>${bar(perm[d.feature], maxPerm, Palette.sky)}</div></td>` +
        `<td><div class="flex items-center justify-end gap-2"><span class="font-mono text-xs">${gp[d.feature].toFixed(2)}</span>${bar(gp[d.feature], 1, Palette.ink)}</div></td></tr>`
    )
    .join("");
  d3.select("#importance").html(
    `<div class="overflow-x-auto"><table class="data-table"><tr><th>Feature</th><th class="num">SHAP</th><th class="num">Perm.</th><th class="num">GP</th></tr>${rows}</table></div>` +
      `<p class="mt-4 text-xs leading-relaxed text-brand-muted">The three lenses agree on direction and in-season fitness. They split the credit differently among temperature, day of year and ride number, because those three move together through every season.</p>`
  );
}

function renderAnomalies() {
  const rows = D.modelling.anomalies
    .slice(0, 6)
    .map(
      (a) =>
        `<tr><td class="whitespace-nowrap">${Format.date(Format.parseDate(a.date))}</td><td>${a.destination}</td><td class="num">${a.route}</td><td class="num">${a.temperature_f}°</td>` +
        `<td class="num">${Format.clock(a.minutes)}</td><td class="num">${Format.clock(a.predicted)}</td>` +
        `<td class="num" style="color:${a.residual > 0 ? Palette.orange : Palette.sky}">${a.residual > 0 ? "+" : "−"}${Format.clock(Math.abs(a.residual))}</td></tr>`
    )
    .join("");
  d3.select("#anomalies").html(
    `<table class="data-table"><tr><th>Date</th><th>To</th><th class="num">Route</th><th class="num">Temp</th><th class="num">Actual</th><th class="num">Expected</th><th class="num">Surprise</th></tr>${rows}</table>` +
      `<p class="mt-4 text-xs leading-relaxed text-brand-muted">The biggest "surprise" is the only Route B ride home, and it shows the limits of the models: tree models can't learn a distance effect from two trips, yet 0.9 extra miles at evening pace (~4.7 min) explains almost all of it. The fastest outlier, 31 Aug 2022, beat expectations by over 3 minutes, plausibly with help from a tailwind.</p>`
  );
}

function fillPlanner() {
  const conformal = D.modelling.conformal;
  d3.select("#planner-lede").html(
    `The best model, an ensemble of GAM, Gaussian process and LightGBM, is wrapped in <strong>conformal prediction</strong>, a method that turns out-of-fold errors into a distribution-free 90% interval of ±${Format.clock(D.planner.half_width)}. ` +
      `Across ${60} random day-level train/calibrate/test splits, split-conformal intervals achieved <strong>${Math.round(conformal.empirical_coverage * 100)}% coverage</strong> against the 90% target. Set the conditions below to get a leave-by time.`
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
  const cold = D.inference.cold_penalty;
  const items = [
    ["Budget the trip home separately", `Plan on about 33 minutes in and 39 out. Borrow the morning's time for the evening and the commuter comes up ${Format.clock(gap.median_gap)} short, every day.`],
    ["Frequency is the lever the rider controls", "More rides per season keep the rider on the fast, flat part of the fitness curve. The apparent decline since 2019 is a matter of frequency rather than age, so even two rides a week would recover most of the early-season penalty."],
    ["Dress for the cold, don't blame it", `A truly cold morning costs well under a minute once fitness is accounted for (${seconds(cold.steps[cold.steps.length - 1].penalty_minutes)}s at ${cold.cold_f}°F). Heat costs nothing measurable up to 90°F. Weather is a poor reason to skip a ride.`],
    ["Choose routes for reasons other than speed", "Route D's apparent edge is about 25 seconds of distance, not a faster road. Route B costs about 4 minutes. Without a deliberate A/B test on matched days, route choice comes down to safety and enjoyment."],
    ["Log a few more variables", "Departure time, wind speed and direction, and rain would let a model separate route geometry from weather, and could help explain the home-direction gap. A weather API join on the date would add them retroactively."],
    ["The same trap shows up in client work", "Temperature, season and fitness moved together here, just as seasonality, spend and promotions move together in marketing data. Check for confounding before naming a driver, or risk recommending the wrong lever."],
  ];
  d3.select("#implication-list")
    .selectAll("div")
    .data(items)
    .join("div")
    .attr("class", "implication reveal")
    .html(
      ([title, body], i) =>
        `<div class="implication-index">${String(i + 1).padStart(2, "0")}</div><div><h3 class="font-display text-lg font-semibold">${title}</h3><p class="mt-2 text-sm leading-relaxed text-brand-muted">${body}</p></div>`
    );
  const methods = [
    ["Feature engineering", "Minutes, mph, direction, ride number within the season, days since last ride (log), day of year, years elapsed and route distance."],
    ["Paired inference", "One-sample t-test, Wilcoxon signed-rank and 5,000-draw bootstrap on same-day home − work gaps."],
    ["Regression", "OLS with heteroskedasticity-robust errors; linear mixed model with a random intercept per ride day."],
    ["Confounding analysis", "The cold penalty adjusted step by step, with day-level bootstrap intervals. Season effects estimated with and without fitness controls."],
    ["Non-parametric learners", "Penalised-spline GAM, random forest, LightGBM, an ARD Gaussian process and an averaging ensemble."],
    ["Validation", "5×5 repeated cross-validation grouped by ride day, plus forward-chaining season-ahead evaluation."],
    ["Interpretation", "Tree SHAP with interaction values, permutation importance, PDP + ICE, accumulated local effects, GP length-scales."],
    ["Uncertainty", "Split-conformal prediction intervals, with coverage checked over 60 random splits."],
  ];
  d3.select("#method-list")
    .selectAll("li")
    .data(methods)
    .join("li")
    .html(([t, b]) => `<b>${t}</b>${b}`);
  d3.select("#generated").text(`Analysis run ${D.generated}, from ${D.overview.headline.trips} trips`);
}

function renderCharts() {
  Charts.wheel("#wheel", trips);
  Charts.timeline("#timeline", trips, state.timeline);
  Charts.slope("#slope", primaryPairs());
  Charts.gapHistogram("#gap-hist", primaryPairs(), D.inference.direction_gap);
  renderTemperature();
  Charts.coldPenalty("#cold-penalty", D.inference.cold_penalty);
  Charts.learning("#learning", D.interpretation.season_learning, D.interpretation.curves.season_ride_number.ensemble);
  Charts.surface("#surface", D.interpretation.surface, state.surface);
  Charts.frequency("#frequency", D.overview.frequency);
  Charts.seasonEffects("#season-effects", D.inference.trend.season_effects, D.inference.trend.season_effects_fitness_adjusted);
  Charts.routes("#route-strip", trips, state.routes);
  Charts.leaderboard("#leaderboard", D.modelling.cv, D.modelling.best_model);
  Charts.shap("#shap", trips, D.interpretation.shap);
  Charts.rust("#rust", D.interpretation.curves.log_days_since_last_ride.ensemble);
  updatePlanner();
}

function renderTemperature() {
  const destination = state.temperature;
  Charts.temperature("#temp-gam", D.interpretation.gam_temperature[destination], D.overview.lowess_temperature[destination], trips, destination);
  d3.select("#temp-key").attr("class", `key ${destination === "Work" ? "sky" : "orange"} ml-4`);
}

function bindSegments() {
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
      const value = button.dataset.value;
      switch (seg.dataset.target) {
        case "timeline":
          state.timeline = value;
          Charts.timeline("#timeline", trips, value);
          break;
        case "temperature":
          state.temperature = value;
          renderTemperature();
          break;
        case "surface":
          state.surface = value;
          Charts.surface("#surface", D.interpretation.surface, value);
          break;
        case "routes":
          state.routes = value;
          Charts.routes("#route-strip", trips, value);
          break;
        case "planner-direction":
          state.plannerDirection = Number(value);
          document.getElementById("pl-arrive").value = state.plannerDirection ? "18:00" : "08:30";
          updatePlanner();
          break;
      }
    });
  });
}

function bindScroll() {
  const bar = document.getElementById("progress");
  const topbar = document.getElementById("topbar");
  const links = [...document.querySelectorAll(".nav-link")];
  const sections = links.map((link) => document.querySelector(link.getAttribute("href")));
  const onScroll = () => {
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
  fillTemperature();
  fillFitness();
  fillYears();
  fillRoutes();
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
