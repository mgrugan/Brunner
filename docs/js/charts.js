const Palette = {
  deep: "#011c23",
  navy: "#022a34",
  panel: "#06323d",
  line: "#1d4b57",
  orange: "#f27b38",
  peach: "#f6a273",
  sky: "#45b4cf",
  ink: "#e8eef0",
  muted: "#8fa7ae",
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
  wheel(selector, trips) {
    const container = d3.select(selector);
    container.selectAll("*").remove();
    const size = container.node().clientWidth;
    const svg = container.append("svg").attr("viewBox", `0 0 ${size} ${size}`).attr("width", size).attr("height", size);
    const g = svg.append("g").attr("transform", `translate(${size / 2},${size / 2})`);
    const outer = size / 2 - 18;
    const inner = outer * 0.38;
    const startAngle = -Math.PI * 0.78;
    const endAngle = Math.PI * 0.78;
    const angle = d3.scaleLinear().domain([30, 305]).range([startAngle, endAngle]);
    const radius = d3.scaleLinear().domain([29.5, 44.5]).range([inner, outer - 26]);

    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "dot-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    glow.append("feGaussianBlur").attr("stdDeviation", 2.5).attr("result", "blur");
    const merge = glow.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    g.append("circle").attr("r", outer).attr("fill", Palette.deep).attr("stroke", Palette.line).attr("stroke-width", 1);
    g.append("path")
      .attr("d", d3.arc()({ innerRadius: outer - 3, outerRadius: outer + 5, startAngle: Math.PI * 0.86, endAngle: Math.PI * 1.98 }))
      .attr("fill", Palette.orange);

    [32, 36, 40, 44].forEach((minute) => {
      g.append("circle").attr("r", radius(minute)).attr("fill", "none").attr("stroke", Palette.line).attr("stroke-opacity", 0.7);
      g.append("text")
        .attr("x", 4)
        .attr("y", -radius(minute) - 3)
        .attr("fill", Palette.muted)
        .attr("font-size", 9.5)
        .attr("font-family", "JetBrains Mono")
        .text(`${minute}m`);
    });

    const months = [
      ["Mar", 60], ["Apr", 91], ["May", 121], ["Jun", 152], ["Jul", 182], ["Aug", 213], ["Sep", 244], ["Oct", 274],
    ];
    months.forEach(([label, day]) => {
      const a = angle(day + 14) - Math.PI / 2;
      const r = outer - 12;
      g.append("line")
        .attr("x1", Math.cos(angle(day) - Math.PI / 2) * inner)
        .attr("y1", Math.sin(angle(day) - Math.PI / 2) * inner)
        .attr("x2", Math.cos(angle(day) - Math.PI / 2) * (outer - 22))
        .attr("y2", Math.sin(angle(day) - Math.PI / 2) * (outer - 22))
        .attr("stroke", Palette.line)
        .attr("stroke-opacity", 0.5);
      g.append("text")
        .attr("x", Math.cos(a) * r)
        .attr("y", Math.sin(a) * r)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", Palette.muted)
        .attr("font-size", 10)
        .attr("font-family", "JetBrains Mono")
        .text(label);
    });

    const dots = g
      .selectAll("circle.trip")
      .data(trips)
      .join("circle")
      .attr("class", "trip")
      .attr("cx", 0)
      .attr("cy", 0)
      .attr("r", 0)
      .attr("fill", (d) => DirectionColor[d.destination])
      .attr("stroke", Palette.deep)
      .attr("stroke-width", 1.5)
      .attr("filter", "url(#dot-glow)")
      .style("cursor", "pointer");

    dots
      .transition()
      .delay((d, i) => 300 + i * 9)
      .duration(900)
      .ease(d3.easeCubicOut)
      .attr("cx", (d) => Math.cos(angle(d.dayOfYear) - Math.PI / 2) * radius(d.minutes))
      .attr("cy", (d) => Math.sin(angle(d.dayOfYear) - Math.PI / 2) * radius(d.minutes))
      .attr("r", 4.5);

    dots
      .on("mouseenter", function (event, d) {
        d3.select(this).attr("r", 7);
        Tooltip.show(event, Format.date(d.dateObj), [
          ["Direction", `To ${d.destination.toLowerCase()}`],
          ["Time", Format.clock(d.minutes)],
          ["Temperature", `${d.temperature_f}°F`],
          ["Route", d.route],
        ]);
      })
      .on("mousemove", Tooltip.move)
      .on("mouseleave", function () {
        d3.select(this).attr("r", 4.5);
        Tooltip.hide();
      });

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", -6)
      .attr("fill", Palette.ink)
      .attr("font-family", "Space Grotesk")
      .attr("font-weight", 700)
      .attr("font-size", Math.max(size * 0.09, 28))
      .text(trips.length);
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", Math.max(size * 0.045, 16))
      .attr("fill", Palette.muted)
      .attr("font-size", 11)
      .attr("letter-spacing", "0.18em")
      .text("RIDES LOGGED");
  },

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

  gapHistogram(selector, pairs, gap) {
    const frame = createFrame(selector, { top: 24, right: 16, bottom: 40, left: 36 });
    const { g, width, height } = frame;
    const x = d3.scaleLinear().domain([2, 10.5]).range([0, width]);
    const bins = d3.bin().domain(x.domain()).thresholds(d3.range(2, 10.5, 0.5))(pairs.map((d) => d.gap_minutes));
    const y = d3.scaleLinear().domain([0, d3.max(bins, (d) => d.length) + 1]).range([height, 0]);
    drawAxes(frame, x, y, { xFormat: (d) => `${d}m`, yTicks: 4, xLabel: "Home minus work" });
    g.selectAll("path.bin")
      .data(bins)
      .join("path")
      .attr("class", "bin")
      .attr("d", (d) => {
        const x0 = x(d.x0) + 1;
        const w = Math.max(x(d.x1) - x(d.x0) - 2, 1);
        const top = y(d.length);
        const r = Math.min(4, w / 2, height - top);
        return `M${x0},${height} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + w - r} Q${x0 + w},${top} ${x0 + w},${top + r} V${height} Z`;
      })
      .attr("fill", Palette.orange)
      .on("mouseenter", (event, d) => Tooltip.show(event, `${d.x0}–${d.x1} minutes`, [["Days", d.length]]))
      .on("mousemove", Tooltip.move)
      .on("mouseleave", Tooltip.hide);
    g.append("rect")
      .attr("x", x(gap.median_gap_ci[0]))
      .attr("width", x(gap.median_gap_ci[1]) - x(gap.median_gap_ci[0]))
      .attr("y", -8)
      .attr("height", 4)
      .attr("rx", 2)
      .attr("fill", Palette.ink);
    g.append("line")
      .attr("x1", x(gap.median_gap))
      .attr("x2", x(gap.median_gap))
      .attr("y1", -12)
      .attr("y2", height)
      .attr("stroke", Palette.ink)
      .attr("stroke-width", 1.5);
    g.append("text")
      .attr("class", "annotation")
      .attr("x", x(gap.median_gap_ci[1]) + 8)
      .attr("y", -2)
      .text(`median +${Format.clock(gap.median_gap)} · 95% CI ${gap.median_gap_ci[0].toFixed(1)}–${gap.median_gap_ci[1].toFixed(1)}m`);
  },

  temperature(selector, band, lowess, trips, destination) {
    const frame = createFrame(selector, { top: 16, right: 16, bottom: 40, left: 44 });
    const { g, width, height } = frame;
    const subset = trips.filter((d) => d.destination === destination && d.route === "A");
    const x = d3.scaleLinear().domain(d3.extent(subset, (d) => d.temperature_f)).nice().range([0, width]);
    const yValues = subset.map((d) => d.minutes).concat(band.low, band.high);
    const y = d3.scaleLinear().domain(d3.extent(yValues)).nice().range([height, 0]);
    drawAxes(frame, x, y, { xFormat: (d) => `${d}°`, yFormat: (d) => `${d}m`, xLabel: "Temperature at departure (°F)" });
    const color = DirectionColor[destination];
    g.selectAll("circle.trip")
      .data(subset)
      .join("circle")
      .attr("cx", (d) => x(d.temperature_f))
      .attr("cy", (d) => y(d.minutes))
      .attr("r", 4)
      .attr("fill", color)
      .attr("fill-opacity", 0.35)
      .on("mouseenter", (event, d) =>
        Tooltip.show(event, Format.date(d.dateObj), [
          ["Time", Format.clock(d.minutes)],
          ["Temperature", `${d.temperature_f}°F`],
          ["Ride # in season", d.season_ride_number],
        ])
      )
      .on("mousemove", Tooltip.move)
      .on("mouseleave", Tooltip.hide);
    const area = d3
      .area()
      .x((d) => x(d.t))
      .y0((d) => y(d.low))
      .y1((d) => y(d.high))
      .curve(d3.curveMonotoneX);
    const rows = band.temperature.map((t, i) => ({ t, fit: band.fit[i], low: band.low[i], high: band.high[i] }));
    g.append("path").datum(rows).attr("d", area).attr("fill", color).attr("fill-opacity", 0.2);
    g.append("path")
      .datum(rows)
      .attr("d", d3.line().x((d) => x(d.t)).y((d) => y(d.fit)).curve(d3.curveMonotoneX))
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 3)
      .attr("stroke-linecap", "round");
    const raw = lowess.x.map((value, i) => ({ x: value, y: lowess.y[i] }));
    g.append("path")
      .datum(raw)
      .attr("d", d3.line().x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX))
      .attr("fill", "none")
      .attr("stroke", Palette.ink)
      .attr("stroke-width", 2)
      .attr("stroke-linecap", "round");
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
        .attr("font-family", "JetBrains Mono")
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
            ["Model R²", step.r_squared.toFixed(2)],
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

  surface(selector, surface, destination) {
    const frame = createFrame(selector, { top: 8, right: 8, bottom: 36, left: 40 });
    const { g, width, height } = frame;
    const values = surface.values[destination];
    const temperatures = surface.temperatures[destination];
    const x = d3.scaleBand().domain(temperatures).range([0, width]).paddingInner(0.06);
    const y = d3.scaleBand().domain(surface.rides).range([height, 0]).paddingInner(0.06);
    const flat = values.flat();
    const color = d3.scaleSequential().domain(d3.extent(flat)).interpolator(d3.interpolateRgb(Palette.deep, Palette.orange));
    const cells = [];
    surface.rides.forEach((ride, i) => temperatures.forEach((t, j) => cells.push({ ride, t, value: values[i][j] })));
    g.selectAll("rect")
      .data(cells)
      .join("rect")
      .attr("x", (d) => x(d.t))
      .attr("y", (d) => y(d.ride))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("rx", 1.5)
      .attr("fill", (d) => color(d.value))
      .on("mouseenter", function (event, d) {
        d3.select(this).attr("stroke", Palette.ink).attr("stroke-width", 1.5);
        Tooltip.show(event, `${d.t}°F · ride #${d.ride}`, [["Predicted", Format.clock(d.value)]]);
      })
      .on("mousemove", Tooltip.move)
      .on("mouseleave", function () {
        d3.select(this).attr("stroke", null);
        Tooltip.hide();
      });
    g.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickValues(temperatures.filter((t) => t % 10 === 0)).tickFormat((d) => `${d}°`).tickSizeOuter(0))
      .call((a) => a.select(".domain").remove());
    g.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).tickValues([1, 5, 10, 15, 20, 25, 30]).tickSizeOuter(0))
      .call((a) => a.select(".domain").remove());
    g.append("text").attr("class", "axis-label").attr("x", width).attr("y", height + 32).attr("text-anchor", "end").text("Temperature (°F)");

    const legend = d3.select("#surface-legend");
    legend.selectAll("*").remove();
    const [lo, hi] = d3.extent(flat);
    legend.html(
      `<div class="flex items-center gap-3 text-xs text-brand-muted"><span class="font-mono">${Format.clock(lo)}</span>` +
        `<div class="h-2 flex-1 rounded-full" style="background:linear-gradient(90deg,${Palette.deep},${Palette.orange})"></div>` +
        `<span class="font-mono">${Format.clock(hi)}</span></div>`
    );
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
      .attr("font-family", "JetBrains Mono")
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

  routes(selector, trips, destination) {
    const frame = createFrame(selector, { top: 8, right: 96, bottom: 36, left: 64 });
    const { g, width, height } = frame;
    const subset = trips.filter((d) => d.destination === destination);
    const groups = d3.groups(subset, (d) => d.route).sort((a, b) => d3.mean(a[1], (d) => d.mph) - d3.mean(b[1], (d) => d.mph));
    const y = d3.scaleBand().domain(groups.map((d) => d[0])).range([height, 0]).padding(0.3);
    const x = d3.scaleLinear().domain(d3.extent(subset, (d) => d.mph)).nice().range([0, width]);
    g.append("g").attr("class", "gridlines").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickSize(-height).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${d} mph`));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickFormat((d) => `Route ${d}`).tickSizeOuter(0)).call((a) => a.select(".domain").remove());
    const random = d3.randomLcg(7);
    groups.forEach(([route, rows]) => {
      const centre = y(route) + y.bandwidth() / 2;
      const highlight = route === "D" || route === "B";
      g.selectAll(null)
        .data(rows)
        .join("circle")
        .attr("cx", (d) => x(d.mph))
        .attr("cy", () => centre + (random() - 0.5) * y.bandwidth() * 0.8)
        .attr("r", 4.5)
        .attr("fill", highlight ? Palette.orange : Palette.sky)
        .attr("fill-opacity", 0.7)
        .on("mouseenter", (event, d) =>
          Tooltip.show(event, `Route ${d.route} · ${Format.date(d.dateObj)}`, [
            ["Speed", `${d.mph.toFixed(2)} mph`],
            ["Time", Format.clock(d.minutes)],
            ["Distance", `${d.distance_miles} mi`],
            ["Ride # in season", d.season_ride_number],
          ])
        )
        .on("mousemove", Tooltip.move)
        .on("mouseleave", Tooltip.hide);
      const mean = d3.mean(rows, (d) => d.mph);
      g.append("line")
        .attr("x1", x(mean))
        .attr("x2", x(mean))
        .attr("y1", y(route) - 2)
        .attr("y2", y(route) + y.bandwidth() + 2)
        .attr("stroke", Palette.ink)
        .attr("stroke-width", 3)
        .attr("stroke-linecap", "round");
      g.append("text")
        .attr("x", width + 10)
        .attr("y", centre)
        .attr("dominant-baseline", "middle")
        .attr("fill", Palette.muted)
        .attr("font-size", 11)
        .attr("font-family", "JetBrains Mono")
        .text(`n=${rows.length} · ${rows[0].distance_miles}mi`);
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
        .attr("font-family", "JetBrains Mono")
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

  shap(selector, trips, shapBlock) {
    const frame = createFrame(selector, { top: 8, right: 16, bottom: 40, left: window.innerWidth < 640 ? 110 : 172 });
    const { g, width, height } = frame;
    const order = shapBlock.importance.map((d) => d.feature);
    const labels = Object.fromEntries(shapBlock.importance.map((d) => [d.feature, d.label]));
    const y = d3.scaleBand().domain(order).range([0, height]).padding(0.12);
    const all = trips.flatMap((t) => t.shap.map((v) => v * 60));
    const limit = d3.max(all, Math.abs);
    const x = d3.scaleLinear().domain([-limit, limit]).nice().range([0, width]);
    g.append("g").attr("class", "gridlines").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(7).tickSize(-height).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(7).tickFormat((d) => `${d > 0 ? "+" : ""}${d}s`));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickFormat((d) => labels[d]).tickSizeOuter(0)).call((a) => a.select(".domain").remove());
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height).attr("stroke", Palette.muted);
    const color = d3.scaleLinear().domain([0, 0.5, 1]).range([Palette.sky, "#c9d6d9", Palette.orange]);
    order.forEach((feature) => {
      const index = shapBlock.features.indexOf(feature);
      const raw = shapBlock.feature_values.map((row) => row[index]);
      const [lo, hi] = d3.extent(raw);
      const points = trips.map((trip, i) => ({ value: trip.shap[index] * 60, raw: raw[i], trip }));
      const binWidth = 3;
      const bins = d3.group(points, (p) => Math.round(x(p.value) / binWidth));
      const centre = y(feature) + y.bandwidth() / 2;
      const step = Math.min(3.2, y.bandwidth() / 2 / 12);
      bins.forEach((members) =>
        members.forEach((p, k) => {
          p.offset = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * step;
        })
      );
      g.selectAll(null)
        .data(points)
        .join("circle")
        .attr("cx", (p) => x(p.value))
        .attr("cy", (p) => centre + Math.max(Math.min(p.offset, y.bandwidth() / 2), -y.bandwidth() / 2))
        .attr("r", 2.6)
        .attr("fill", (p) => color(hi === lo ? 0.5 : (p.raw - lo) / (hi - lo)))
        .on("mouseenter", (event, p) =>
          Tooltip.show(event, `${labels[feature]}`, [
            ["Trip", `${Format.date(p.trip.dateObj)} · ${p.trip.destination}`],
            ["Feature value", feature === "log_days_since_last_ride" ? `${Math.round(Math.expm1(p.raw))} days` : p.raw],
            ["Contribution", `${p.value > 0 ? "+" : ""}${p.value.toFixed(1)}s`],
          ])
        )
        .on("mousemove", Tooltip.move)
        .on("mouseleave", Tooltip.hide);
    });
  },

  rust(selector, curve) {
    const frame = createFrame(selector, { top: 16, right: 16, bottom: 40, left: 48 });
    const { g, width, height } = frame;
    const days = curve.grid.map((v) => Math.expm1(v));
    const rows = days.map((d, i) => ({ d, y: (curve.pdp[i] - curve.pdp[0]) * 60 }));
    const x = d3.scaleLog().domain([Math.max(1, d3.min(days)), d3.max(days)]).range([0, width]);
    const y = d3.scaleLinear().domain([Math.min(-5, d3.min(rows, (r) => r.y)), Math.max(30, d3.max(rows, (r) => r.y) + 5)]).nice().range([height, 0]);
    drawAxes(frame, x, y, { xFormat: (d) => ([1, 3, 7, 14, 30, 90, 365].includes(Math.round(d)) ? `${Math.round(d)}d` : ""), yFormat: (d) => `+${d}s`, xLabel: "Days since previous ride (log scale)" });
    g.selectAll(".axis text").filter((d) => d === 0).text("0s");
    const area = d3.area().x((r) => x(Math.max(1, r.d))).y0(y(0)).y1((r) => y(r.y)).curve(d3.curveMonotoneX);
    g.append("path").datum(rows).attr("d", area).attr("fill", Palette.orange).attr("fill-opacity", 0.15);
    g.append("path")
      .datum(rows)
      .attr("d", d3.line().x((r) => x(Math.max(1, r.d))).y((r) => y(r.y)).curve(d3.curveMonotoneX))
      .attr("fill", "none")
      .attr("stroke", Palette.orange)
      .attr("stroke-width", 3);
    const last = rows[rows.length - 1];
    g.append("text").attr("class", "annotation").attr("x", x(last.d)).attr("y", y(last.y) - 10).attr("text-anchor", "end").text(`${Math.round(last.d)} days off → ${Format.signedSeconds(last.y / 60)}`);
    const focus = g.append("g").style("display", "none");
    focus.append("circle").attr("r", 5).attr("fill", Palette.ink);
    g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        const day = x.invert(mx);
        const nearest = rows.reduce((a, b) => (Math.abs(b.d - day) < Math.abs(a.d - day) ? b : a));
        focus.style("display", null).attr("transform", `translate(${x(Math.max(1, nearest.d))},${y(nearest.y)})`);
        Tooltip.show(event, `${Math.round(nearest.d)} days since last ride`, [["Added time", Format.signedSeconds(nearest.y / 60)]]);
      })
      .on("mouseleave", () => {
        focus.style("display", "none");
        Tooltip.hide();
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
        .attr("font-family", "JetBrains Mono")
        .text(`${label} ${Format.clock(value)}`);
    });
  },
};

function roundedTop(x, y, w, h, base) {
  if (h <= 0) return `M${x},${base} H${x + w} V${base} H${x} Z`;
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`;
}
