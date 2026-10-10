const Palette = {
  deep: "#070b0c",
  navy: "#0b1416",
  panel: "#0b1416",
  line: "#1f3339",
  orange: "#f27b38",
  peach: "#f6a273",
  sky: "#45b4cf",
  ink: "#ece9e4",
  muted: "#8b9497",
  brandNavy: "#022a34",
};

const DirectionColor = { Work: Palette.sky, Home: Palette.orange };

const Format = {
  clock(minutes) {
    const total = Math.round(minutes * 60);
    const m = Math.floor(total / 60);
    const s = String(Math.abs(total % 60)).padStart(2, "0");
    return `${m}:${s}`;
  },
  signedSeconds(minutes) {
    const seconds = Math.round(minutes * 60);
    return `${seconds > 0 ? "+" : seconds < 0 ? "−" : "±"}${Math.abs(seconds)}s`;
  },
  date: d3.timeFormat("%b %-d, %Y"),
  parseDate: d3.timeParse("%Y-%m-%d"),
  p(value) {
    if (value < 0.001) return "p < 0.001";
    return `p = ${value.toFixed(3)}`;
  },
};

const Tooltip = (() => {
  const node = document.getElementById("tooltip");
  return {
    show(event, title, rows) {
      node.innerHTML =
        `<div class="tt-title">${title}</div>` +
        rows.map(([label, value]) => `<div class="tt-row"><span>${label}</span><b>${value}</b></div>`).join("");
      node.style.opacity = 1;
      Tooltip.move(event);
    },
    move(event) {
      const x = Math.min(Math.max(event.clientX, 110), window.innerWidth - 110);
      node.style.left = `${x}px`;
      node.style.top = `${event.clientY}px`;
    },
    hide() {
      node.style.opacity = 0;
    },
  };
})();

function createFrame(selector, margin = { top: 16, right: 20, bottom: 40, left: 48 }) {
  const container = d3.select(selector);
  container.selectAll("*").remove();
  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;
  const svg = container.append("svg").attr("width", width).attr("height", height).attr("role", "img");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  return {
    svg,
    g,
    width: Math.max(width - margin.left - margin.right, 50),
    height: Math.max(height - margin.top - margin.bottom, 50),
    margin,
  };
}

function drawAxes(frame, x, y, options = {}) {
  const { g, width, height } = frame;
  g.append("g")
    .attr("class", "gridlines")
    .call(d3.axisLeft(y).ticks(options.yTicks || 5).tickSize(-width).tickFormat(""));
  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(options.xTicks || 6).tickFormat(options.xFormat || null).tickSizeOuter(0));
  g.append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(options.yTicks || 5).tickFormat(options.yFormat || null).tickSizeOuter(0))
    .call((axis) => axis.select(".domain").remove());
  if (options.xLabel) {
    g.append("text").attr("class", "axis-label").attr("x", width).attr("y", height + 34).attr("text-anchor", "end").text(options.xLabel);
  }
  if (options.yLabel) {
    g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", -6).attr("text-anchor", "start").text(options.yLabel);
  }
}

const Charts = {

  timeline(selector, trips, filter) {
    const frame = createFrame(selector, { top: 20, right: 16, bottom: 36, left: 44 });
    const { g, width, height } = frame;
    const x = d3.scaleTime().domain([new Date(2019, 1, 1), new Date(2026, 6, 1)]).range([0, width]);
    const y = d3.scaleLinear().domain([29.5, 44.5]).range([height, 0]);
    g.append("rect")
      .attr("x", x(new Date(2019, 10, 15)))
      .attr("width", x(new Date(2021, 3, 1)) - x(new Date(2019, 10, 15)))
      .attr("y", 0)
      .attr("height", height)
      .attr("fill", Palette.line)
      .attr("opacity", 0.28)
      .attr("rx", 8);
    g.append("text")
      .attr("class", "annotation")
      .attr("x", (x(new Date(2019, 10, 15)) + x(new Date(2021, 3, 1))) / 2)
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .attr("fill", Palette.muted)
      .style("fill", Palette.muted)
      .text("No rides · 2020");
    drawAxes(frame, x, y, { yFormat: (d) => `${d}m`, xTicks: 8 });

    const visible = trips.filter((d) => filter === "all" || d.destination === filter);
    const bySeason = d3.groups(visible, (d) => `${d.season}-${d.destination}`);
    bySeason.forEach(([, rows]) => {
      if (rows.length < 3) return;
      const median = d3.median(rows, (d) => d.minutes);
      const extent = d3.extent(rows, (d) => d.dateObj);
      g.append("line")
        .attr("x1", x(extent[0]))
        .attr("x2", x(extent[1]))
        .attr("y1", y(median))
        .attr("y2", y(median))
        .attr("stroke", DirectionColor[rows[0].destination])
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.55)
        .attr("stroke-linecap", "round");
    });

    g.selectAll("circle.trip")
      .data(visible, (d) => d.trip_id)
      .join("circle")
      .attr("class", "trip")
      .attr("cx", (d) => x(d.dateObj))
      .attr("cy", (d) => y(d.minutes))
      .attr("r", 5)
      .attr("fill", (d) => DirectionColor[d.destination])
      .attr("stroke", Palette.navy)
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        d3.select(this).attr("r", 8);
        Tooltip.show(event, `${Format.date(d.dateObj)} · to ${d.destination.toLowerCase()}`, [
          ["Time", Format.clock(d.minutes)],
          ["Speed", `${d.mph.toFixed(1)} mph`],
          ["Temperature", `${d.temperature_f}°F`],
          ["Route", `${d.route} · ${d.distance_miles} mi`],
          ["Ride # in season", d.season_ride_number],
          ["Model expected", Format.clock(d.predicted)],
        ]);
      })
      .on("mousemove", Tooltip.move)
      .on("mouseleave", function () {
        d3.select(this).attr("r", 5);
        Tooltip.hide();
      });
  },

  slope(selector, pairs) {
    const frame = createFrame(selector, { top: 20, right: 56, bottom: 34, left: 56 });
    const { g, width, height } = frame;
    const x = d3.scalePoint().domain(["Work", "Home"]).range([0, width]);
    const y = d3.scaleLinear().domain([30.5, 42.5]).range([height, 0]);
    g.append("g").attr("class", "gridlines").call(d3.axisLeft(y).ticks(6).tickSize(-width).tickFormat(""));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((d) => `${d}m`)).call((a) => a.select(".domain").remove());
    const lines = g
      .selectAll("line.pair")
      .data(pairs)
      .join("line")
      .attr("class", "pair")
      .attr("x1", x("Work"))
      .attr("x2", x("Home"))
      .attr("y1", (d) => y(d.minutes_work))
      .attr("y2", (d) => y(d.minutes_home))
      .attr("stroke", Palette.muted)
      .attr("stroke-opacity", 0.28)
      .attr("stroke-width", 1.2);
    ["Work", "Home"].forEach((side) => {
      g.selectAll(`circle.${side}`)
        .data(pairs)
        .join("circle")
        .attr("cx", x(side))
        .attr("cy", (d) => y(side === "Work" ? d.minutes_work : d.minutes_home))
        .attr("r", 4.5)
        .attr("fill", DirectionColor[side])
        .attr("stroke", Palette.navy)
        .attr("stroke-width", 1.5);
      g.append("text")
        .attr("x", x(side))
        .attr("y", height + 24)
        .attr("text-anchor", "middle")
        .attr("fill", Palette.ink)
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .text(side === "Work" ? "Morning → work" : "Evening → home");
    });
    const hit = g
      .selectAll("line.hit")
      .data(pairs)
      .join("line")
      .attr("x1", x("Work"))
      .attr("x2", x("Home"))
      .attr("y1", (d) => y(d.minutes_work))
      .attr("y2", (d) => y(d.minutes_home))
      .attr("stroke", "transparent")
      .attr("stroke-width", 8)
      .style("cursor", "pointer");
    hit
      .on("mouseenter", function (event, d) {
        lines.filter((p) => p === d).attr("stroke", Palette.orange).attr("stroke-opacity", 1).attr("stroke-width", 2.5).raise();
        Tooltip.show(event, Format.date(Format.parseDate(d.date)), [
          ["To work", Format.clock(d.minutes_work)],
          ["To home", Format.clock(d.minutes_home)],
          ["Gap", `+${Format.clock(d.gap_minutes)}`],
          ["Warmer by", `${d.temp_rise}°F`],
        ]);
      })
      .on("mousemove", Tooltip.move)
      .on("mouseleave", function () {
        lines.attr("stroke", Palette.muted).attr("stroke-opacity", 0.28).attr("stroke-width", 1.2);
        Tooltip.hide();
      });
  },



  coldPenalty(selector, block) {
    const frame = createFrame(selector, { top: 8, right: 24, bottom: 36, left: 12 });
    const { g, width, height } = frame;
    const steps = block.steps;
    const y = d3.scaleBand().domain(steps.map((d) => d.model)).range([0, height]).padding(0.45);
    const x = d3.scaleLinear().domain([0, d3.max(steps, (d) => d.ci_high) * 60]).nice().range([0, width]);
    g.append("g").attr("class", "gridlines").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickSize(-height).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat((d) => `${d}s`));
    steps.forEach((step, i) => {
      const top = y(step.model);
      const color = i === steps.length - 1 ? Palette.orange : Palette.sky;
      g.append("text").attr("x", 0).attr("y", top - 6).attr("fill", Palette.ink).attr("font-size", 12).attr("font-weight", 600).text(step.model);
      g.append("rect")
        .attr("x", 0)
        .attr("y", top)
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", color)
        .attr("width", 0)
        .transition()
        .duration(900)
        .delay(i * 150)
        .attr("width", x(step.penalty_minutes * 60));
      g.append("line")
        .attr("x1", x(step.ci_low * 60))
        .attr("x2", x(step.ci_high * 60))
        .attr("y1", top + y.bandwidth() / 2)
        .attr("y2", top + y.bandwidth() / 2)
        .attr("stroke", Palette.ink)
        .attr("stroke-width", 1.5);
      g.append("text")
        .attr("x", x(step.ci_high * 60) + 6)
        .attr("y", top + y.bandwidth() / 2)
        .attr("dominant-baseline", "middle")
        .attr("fill", Palette.ink)
        .attr("font-family", "Jost")
        .attr("font-size", 11)
        .text(`${Math.round(step.penalty_minutes * 60)}s`);
      g.append("rect")
        .attr("x", 0)
        .attr("y", top - 16)
        .attr("width", width)
        .attr("height", y.bandwidth() + 18)
        .attr("fill", "transparent")
        .on("mouseenter", (event) =>
          Tooltip.show(event, step.model, [
            ["Cold penalty", `${Math.round(step.penalty_minutes * 60)}s`],
            ["90% interval", `${Math.round(step.ci_low * 60)}–${Math.round(step.ci_high * 60)}s`],
            ["Out-of-sample R²", step.cv_r_squared.toFixed(2)],
          ])
        )
        .on("mousemove", Tooltip.move)
        .on("mouseleave", Tooltip.hide);
    });
  },

  learning(selector, learning, curve) {
    const frame = createFrame(selector, { top: 16, right: 16, bottom: 40, left: 44 });
    const { g, width, height } = frame;
    const x = d3.scaleLinear().domain([0, 30]).range([0, width]);
    const y = d3.scaleLinear().domain([-3.2, 3.6]).range([height, 0]);
    drawAxes(frame, x, y, { yFormat: (d) => `${d > 0 ? "+" : ""}${d}m`, xLabel: "Ride number within the season" });
    g.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", Palette.muted).attr("stroke-opacity", 0.6);
    g.selectAll("circle.pt")
      .data(learning.points)
      .join("circle")
      .attr("cx", (d) => x(d.season_ride_number))
      .attr("cy", (d) => y(d.adjusted))
      .attr("r", 4)
      .attr("fill", (d) => DirectionColor[d.destination])
      .attr("fill-opacity", 0.5)
      .on("mouseenter", (event, d) =>
        Tooltip.show(event, `${d.season} season · ride #${d.season_ride_number}`, [
          ["Direction", `To ${d.destination.toLowerCase()}`],
          ["vs. typical", Format.signedSeconds(d.adjusted)],
        ])
      )
      .on("mousemove", Tooltip.move)
      .on("mouseleave", Tooltip.hide);
    const mean = d3.mean(learning.points, (d) => d.adjusted);
    const pdpMean = d3.mean(curve.pdp);
    const rows = curve.grid.map((value, i) => ({ x: value, y: curve.pdp[i] - pdpMean + mean }));
    const path = g
      .append("path")
      .datum(rows)
      .attr("d", d3.line().x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX))
      .attr("fill", "none")
      .attr("stroke", Palette.ink)
      .attr("stroke-width", 3)
      .attr("stroke-linecap", "round");
    const length = path.node().getTotalLength();
    path.attr("stroke-dasharray", `${length} ${length}`).attr("stroke-dashoffset", length).transition().duration(1600).attr("stroke-dashoffset", 0);
    g.selectAll("circle.bucket")
      .data(learning.buckets)
      .join("circle")
      .attr("cx", (d) => x(d.ride))
      .attr("cy", (d) => y(d.adjusted))
      .attr("r", 8)
      .attr("fill", Palette.ink)
      .attr("stroke", Palette.navy)
      .attr("stroke-width", 3)
      .on("mouseenter", (event, d) =>
        Tooltip.show(event, `Rides around #${Math.round(d.ride)}`, [
          ["Mean vs. typical", Format.signedSeconds(d.adjusted)],
          ["Trips", d.n],
        ])
      )
      .on("mousemove", Tooltip.move)
      .on("mouseleave", Tooltip.hide);
    const first = learning.buckets[0];
    const last = learning.buckets[learning.buckets.length - 1];
    g.append("text")
      .attr("class", "annotation")
      .attr("x", x(first.ride) + 14)
      .attr("y", y(first.adjusted) - 14)
      .text(`Early season ${Format.signedSeconds(first.adjusted)}`);
    g.append("text")
      .attr("class", "annotation")
      .attr("x", x(last.ride))
      .attr("y", y(last.adjusted) + 26)
      .attr("text-anchor", "middle")
      .text(`Peak form ${Format.signedSeconds(last.adjusted)}`);
  },


  frequency(selector, frequency) {
    const frame = createFrame(selector, { top: 24, right: 8, bottom: 32, left: 36 });
    const { g, width, height } = frame;
    const x = d3.scaleBand().domain(frequency.map((d) => d.season)).range([0, width]).padding(0.3);
    const y = d3.scaleLinear().domain([0, 60]).range([height, 0]);
    g.append("g").attr("class", "gridlines").call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(""));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4)).call((a) => a.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickSizeOuter(0));
    const bars = g
      .selectAll("path.bar")
      .data(frequency)
      .join("path")
      .attr("class", "bar")
      .attr("fill", (d) => (d.season === 2019 ? Palette.orange : Palette.sky))
      .attr("d", (d) => roundedTop(x(d.season), height, x.bandwidth(), 0, height));
    bars
      .transition()
      .duration(900)
      .delay((d, i) => i * 80)
      .attr("d", (d) => roundedTop(x(d.season), y(d.trips), x.bandwidth(), height - y(d.trips), height));
    bars
      .on("mouseenter", (event, d) =>
        Tooltip.show(event, `${d.season} season`, [
          ["Trips", d.trips],
          ["Ride days", d.ride_days],
          ["Miles", d.miles.toFixed(1)],
        ])
      )
      .on("mousemove", Tooltip.move)
      .on("mouseleave", Tooltip.hide);
    g.selectAll("text.value")
      .data(frequency)
      .join("text")
      .attr("x", (d) => x(d.season) + x.bandwidth() / 2)
      .attr("y", (d) => y(d.trips) - 7)
      .attr("text-anchor", "middle")
      .attr("fill", Palette.ink)
      .attr("font-family", "Jost")
      .attr("font-size", 11)
      .text((d) => (d.trips === 0 ? "–" : d.trips));
  },

  seasonEffects(selector, plain, adjusted) {
    const frame = createFrame(selector, { top: 16, right: 12, bottom: 32, left: 48 });
    const { g, width, height } = frame;
    const seasons = plain.map((d) => d.season);
    const x = d3.scaleBand().domain(seasons).range([0, width]).padding(0.25);
    const y = d3.scaleLinear().domain([-150, 150]).range([height, 0]).clamp(true);
    g.append("g").attr("class", "gridlines").call(d3.axisLeft(y).ticks(6).tickSize(-width).tickFormat(""));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((d) => `${d > 0 ? "+" : ""}${d}s`)).call((a) => a.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickSizeOuter(0));
    g.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", Palette.muted);
    [
      [plain, -x.bandwidth() * 0.18, Palette.sky, "Direction + temperature adjusted"],
      [adjusted, x.bandwidth() * 0.18, Palette.orange, "+ ride number & layoff adjusted"],
    ].forEach(([rows, offset, color, label]) => {
      const cx = (d) => x(d.season) + x.bandwidth() / 2 + offset;
      g.selectAll(null)
        .data(rows)
        .join("line")
        .attr("x1", cx)
        .attr("x2", cx)
        .attr("y1", (d) => y(d.ci_low * 60))
        .attr("y2", (d) => y(d.ci_high * 60))
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round");
      g.selectAll(null)
        .data(rows)
        .join("circle")
        .attr("cx", cx)
        .attr("cy", (d) => y(d.estimate * 60))
        .attr("r", 6)
        .attr("fill", color)
        .attr("stroke", Palette.navy)
        .attr("stroke-width", 2)
        .on("mouseenter", (event, d) =>
          Tooltip.show(event, `${d.season} · ${label}`, [
            ["vs. 2019", Format.signedSeconds(d.estimate)],
            ["95% interval", `${Math.round(d.ci_low * 60)} to ${Math.round(d.ci_high * 60)}s`],
          ])
        )
        .on("mousemove", Tooltip.move)
        .on("mouseleave", Tooltip.hide);
    });
  },


  leaderboard(selector, cv, best) {
    const compact = window.innerWidth < 640;
    const labelWidth = compact ? 128 : 190;
    const frame = createFrame(selector, { top: 4, right: compact ? 76 : 92, bottom: 32, left: labelWidth });
    const { g, width, height } = frame;
    const rows = [...cv].sort((a, b) => a.rmse_mean - b.rmse_mean);
    const y = d3.scaleBand().domain(rows.map((d) => d.model)).range([0, height]).padding(0.32);
    const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.rmse_mean * 60)]).nice().range([0, width]);
    g.append("g").attr("class", "gridlines").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickSize(-height).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat((d) => `${d}s`));
    rows.forEach((row, i) => {
      const top = y(row.model);
      const isBest = row.model === best;
      const isBaseline = row.model.includes("baseline");
      g.append("text")
        .attr("x", -12)
        .attr("y", top + y.bandwidth() / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("fill", isBest ? Palette.orange : Palette.ink)
        .attr("font-size", compact ? 10 : 12)
        .attr("font-weight", isBest ? 700 : 500)
        .text(compact ? row.model.replace(/ \(.*\)/, "") : row.model);
      g.append("rect")
        .attr("x", 0)
        .attr("y", top)
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", isBest ? Palette.orange : isBaseline ? Palette.line : Palette.sky)
        .attr("width", 0)
        .transition()
        .duration(900)
        .delay(i * 90)
        .attr("width", x(row.rmse_mean * 60));
      g.append("text")
        .attr("x", x(row.rmse_mean * 60) + 8)
        .attr("y", top + y.bandwidth() / 2)
        .attr("dominant-baseline", "middle")
        .attr("fill", Palette.ink)
        .attr("font-size", 11)
        .attr("font-family", "Jost")
        .text(`${Math.round(row.rmse_mean * 60)}s · R² ${row.r2_mean.toFixed(2)}`);
      g.append("rect")
        .attr("x", -labelWidth)
        .attr("y", top - 4)
        .attr("width", width + labelWidth)
        .attr("height", y.bandwidth() + 8)
        .attr("fill", "transparent")
        .on("mouseenter", (event) =>
          Tooltip.show(event, row.model, [
            ["RMSE", `${(row.rmse_mean * 60).toFixed(1)} ± ${(row.rmse_std * 60).toFixed(1)}s`],
            ["MAE", `${(row.mae_mean * 60).toFixed(1)}s`],
            ["R²", row.r2_mean.toFixed(3)],
          ])
        )
        .on("mousemove", Tooltip.move)
        .on("mouseleave", Tooltip.hide);
    });
  },



  plannerBar(selector, prediction, halfWidth, destination) {
    const frame = createFrame(selector, { top: 30, right: 16, bottom: 30, left: 16 });
    const { g, width, height } = frame;
    const x = d3.scaleLinear().domain([28, 46]).range([0, width]);
    const color = DirectionColor[destination];
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(9).tickFormat((d) => `${d}m`)).call((a) => a.select(".domain").remove());
    g.append("rect").attr("x", 0).attr("y", height / 2 - 3).attr("width", width).attr("height", 6).attr("rx", 3).attr("fill", Palette.line);
    g.append("rect")
      .attr("x", x(prediction - halfWidth))
      .attr("y", height / 2 - 9)
      .attr("width", x(prediction + halfWidth) - x(prediction - halfWidth))
      .attr("height", 18)
      .attr("rx", 9)
      .attr("fill", color)
      .attr("fill-opacity", 0.3);
    g.append("circle").attr("cx", x(prediction)).attr("cy", height / 2).attr("r", 10).attr("fill", color).attr("stroke", Palette.ink).attr("stroke-width", 3);
    [
      [prediction - halfWidth, "5th pct", "end"],
      [prediction + halfWidth, "95th pct", "start"],
    ].forEach(([value, label, anchor]) => {
      g.append("text")
        .attr("x", x(value))
        .attr("y", height / 2 - 18)
        .attr("text-anchor", anchor)
        .attr("fill", Palette.muted)
        .attr("font-size", 10.5)
        .attr("font-family", "Jost")
        .text(`${label} ${Format.clock(value)}`);
    });
  },

  windCompass(selector, weather) {
    const container = d3.select(selector);
    container.selectAll("*").remove();
    const width = container.node().clientWidth;
    const height = container.node().clientHeight;
    const size = Math.min(width, height);
    const svg = container.append("svg").attr("width", width).attr("height", height);
    const g = svg.append("g").attr("transform", `translate(${width / 2},${height / 2})`);
    const outer = size / 2 - 30;
    const inner = outer * 0.28;
    const fits = weather.bearing_profile.cv_r_squared;
    const bearings = weather.bearing_profile.bearings;
    const radius = d3.scaleLinear().domain(d3.extent(fits)).range([inner, outer]);
    const toXY = (deg, r) => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r];
    [inner, (inner + outer) / 2, outer].forEach((r) => g.append("circle").attr("r", r).attr("fill", "none").attr("stroke", "rgba(255,255,255,0.07)"));
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([label, deg]) => {
      const [x, y] = toXY(deg, outer + 16);
      g.append("text").attr("x", x).attr("y", y).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("fill", Palette.muted).attr("font-size", 11).attr("letter-spacing", "0.15em").text(label);
    });
    const line = d3.lineRadial().angle((d) => (d.b * Math.PI) / 180).radius((d) => radius(d.r)).curve(d3.curveCardinalClosed);
    const rows = bearings.map((b, i) => ({ b, r: fits[i] }));
    g.append("path").datum(rows).attr("d", line).attr("fill", "rgba(69,180,207,0.12)").attr("stroke", Palette.sky).attr("stroke-width", 2);
    const arrow = (deg, length, color, label, dy) => {
      const [x, y] = toXY(deg, length);
      g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", x).attr("y2", y).attr("stroke", color).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
      const head = toXY(deg, length + 1);
      g.append("circle").attr("cx", head[0]).attr("cy", head[1]).attr("r", 4).attr("fill", color);
      const [lx, ly] = toXY(deg, length + 14);
      g.append("text").attr("x", lx).attr("y", ly + dy).attr("text-anchor", lx < 0 ? "end" : "start").attr("fill", Palette.ink).attr("font-size", 11).text(label);
    };
    arrow(weather.work_bearing_deg, outer * 0.92, Palette.orange, `to work · ${Math.round(weather.work_bearing_deg)}°`, -6);
    const evening = (weather.by_direction.Home.wind_from_deg + 180) % 360;
    arrow(evening, outer * 0.55, Palette.sky, "evening wind blows", 12);
    g.append("circle").attr("r", 3).attr("fill", Palette.ink);
  },

  ablation(selector, steps) {
    const frame = createFrame(selector, { top: 8, right: 56, bottom: 36, left: 12 });
    const { g, width, height } = frame;
    const y = d3.scaleBand().domain(steps.map((d) => d.step)).range([0, height]).padding(0.45);
    const low = Math.floor(d3.min(steps, (d) => d.cv_r_squared) * 20) / 20 - 0.05;
    const x = d3.scaleLinear().domain([low, 1]).range([0, width]);
    g.append("g").attr("class", "gridlines").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickSize(-height).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".2f")));
    steps.forEach((step, i) => {
      const top = y(step.step);
      const gain = step.rmse_change_s === null ? 0 : -step.rmse_change_s;
      const color = gain >= 3 ? Palette.orange : i === 0 ? Palette.sky : Palette.muted;
      g.append("text").attr("x", 0).attr("y", top - 6).attr("fill", Palette.ink).attr("font-size", 12).attr("font-weight", 600).text(step.step);
      g.append("rect")
        .attr("x", 0)
        .attr("y", top)
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", color)
        .attr("width", 0)
        .on("mouseenter", (event) => Tooltip.show(event, step.step, [
          ["Out-of-sample R²", step.cv_r_squared.toFixed(3)],
          ["Held-out error", `${Math.round(step.cv_rmse_s)}s`],
          ["Training error", `${Math.round(step.train_rmse_s)}s`],
        ]))
        .on("mousemove", Tooltip.move)
        .on("mouseleave", Tooltip.hide)
        .transition()
        .duration(900)
        .delay(i * 120)
        .attr("width", x(step.cv_r_squared));
      const change = step.rmse_change_s === null ? "" : `   error ${step.rmse_change_s > 0 ? "+" : "−"}${Math.abs(step.rmse_change_s).toFixed(1)}s`;
      g.append("text")
        .attr("x", x(step.cv_r_squared) + 6)
        .attr("y", top + y.bandwidth() / 2)
        .attr("dominant-baseline", "middle")
        .attr("fill", Palette.ink)
        .attr("font-family", "Jost")
        .attr("font-size", 11)
        .text(`${step.cv_r_squared.toFixed(3)}${change}`);
    });
  },

  windScatter(selector, weather) {
    const frame = createFrame(selector, { top: 16, right: 16, bottom: 40, left: 48 });
    const { g, width, height } = frame;
    const points = weather.points;
    const x = d3.scaleLinear().domain(d3.extent(points, (d) => d.headwind)).nice().range([0, width]);
    const y = d3.scaleLinear().domain(d3.extent(points, (d) => d.adjusted_seconds)).nice().range([height, 0]);
    drawAxes(frame, x, y, { xFormat: (d) => `${d} mph`, yFormat: (d) => `${d > 0 ? "+" : ""}${d}s`, xLabel: "Headwind (negative = tailwind)" });
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height).attr("stroke", Palette.muted).attr("stroke-opacity", 0.4);
    g.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", Palette.muted).attr("stroke-opacity", 0.4);
    const meanX = d3.mean(points, (d) => d.headwind);
    const meanY = d3.mean(points, (d) => d.adjusted_seconds);
    const slope = weather.headwind_seconds_per_mph;
    const [x0, x1] = x.domain();
    g.append("line")
      .attr("x1", x(x0)).attr("y1", y(meanY + slope * (x0 - meanX)))
      .attr("x2", x(x1)).attr("y2", y(meanY + slope * (x1 - meanX)))
      .attr("stroke", Palette.ink).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
    g.selectAll("circle.pt").data(points).join("circle")
      .attr("cx", (d) => x(d.headwind)).attr("cy", (d) => y(d.adjusted_seconds)).attr("r", 4.5)
      .attr("fill", (d) => DirectionColor[d.destination]).attr("fill-opacity", 0.75)
      .on("mouseenter", (event, d) => Tooltip.show(event, `${Format.date(Format.parseDate(d.date))} · to ${d.destination.toLowerCase()}`, [
        ["Wind", `${d.wind_speed_10m.toFixed(1)} mph from ${Math.round(d.wind_direction_10m)}°`],
        ["Headwind", `${d.headwind.toFixed(1)} mph`],
        ["vs. expected", `${d.adjusted_seconds > 0 ? "+" : ""}${Math.round(d.adjusted_seconds)}s`],
      ]))
      .on("mousemove", Tooltip.move).on("mouseleave", Tooltip.hide);
    g.append("text").attr("class", "annotation").attr("x", width).attr("y", 12).attr("text-anchor", "end").text(`${slope.toFixed(1)} s per mph of headwind`);
  },

};

function roundedTop(x, y, w, h, base) {
  if (h <= 0) return `M${x},${base} H${x + w} V${base} H${x} Z`;
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`;
}
