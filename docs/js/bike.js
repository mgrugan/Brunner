const Bike = (() => {
  const VIEW_WIDTH = 1000;
  const TIRE_RADIUS = 168;
  const REAR = { x: 250, y: 400 };
  const FRONT = { x: 740, y: 400 };
  const BB = { x: 455, y: 435 };
  const SEAT_CLUSTER = { x: 380, y: 186 };
  const HEAD_TOP = { x: 650, y: 158 };
  const HEAD_BOTTOM = { x: 672, y: 230 };
  const CRANK_LENGTH = 86;

  function spokes(count, inner, outer, crossed) {
    const lines = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const offset = crossed ? (i % 2 ? 0.18 : -0.18) : 0;
      const x1 = Math.cos(a + offset) * inner;
      const y1 = Math.sin(a + offset) * inner;
      const x2 = Math.cos(a) * outer;
      const y2 = Math.sin(a) * outer;
      lines.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`);
    }
    return lines.join("");
  }

  function wheel(id, center, crossed) {
    return `
      <g transform="translate(${center.x} ${center.y})">
        <circle r="${TIRE_RADIUS + 22}" fill="url(#wheel-halo)" />
        <g id="${id}">
          <circle r="${TIRE_RADIUS - 6}" fill="none" stroke="#0a0b0c" stroke-width="13" />
          <circle r="${TIRE_RADIUS - 6}" fill="none" stroke="url(#tire-sheen)" stroke-width="13" opacity="0.55" />
          <circle r="${TIRE_RADIUS - 1}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
          <circle r="${TIRE_RADIUS - 34}" fill="none" stroke="url(#rim-face)" stroke-width="40" />
          <circle r="${TIRE_RADIUS - 14}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.2" />
          <circle r="${TIRE_RADIUS - 54}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <path id="${id}-arc" d="M ${-(TIRE_RADIUS - 34)} 0 A ${TIRE_RADIUS - 34} ${TIRE_RADIUS - 34} 0 0 1 ${TIRE_RADIUS - 34} 0" fill="none" />
          <text class="rim-type" dy="4"><textPath href="#${id}-arc" startOffset="50%" text-anchor="middle">BRUNNER</textPath></text>
          <g stroke="#3b4246" stroke-width="1.6" stroke-linecap="round">${spokes(crossed ? 24 : 20, 16, TIRE_RADIUS - 54, crossed)}</g>
          <circle r="22" fill="#121416" stroke="#2c3236" stroke-width="2" />
          <circle r="9" fill="#1d2124" />
          <circle r="3.5" fill="#f27b38" />
        </g>
      </g>`;
  }

  function tube(from, to, width, highlightOffset = -0.32) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * width * highlightOffset;
    const ny = (dx / length) * width * highlightOffset;
    return `
      <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="url(#frame-paint)" stroke-width="${width}" stroke-linecap="round" />
      <line x1="${from.x + nx}" y1="${from.y + ny}" x2="${to.x + nx}" y2="${to.y + ny}" stroke="rgba(255,255,255,0.14)" stroke-width="1.6" stroke-linecap="round" />`;
  }

  function cassette() {
    return [24, 20, 17, 14]
      .map((r, i) => `<circle r="${r}" fill="none" stroke="${i % 2 ? "#2a2f33" : "#3a4146"}" stroke-width="2.4" />`)
      .join("");
  }

  function chainring() {
    const teeth = [];
    for (let i = 0; i < 52; i++) {
      const a = (i / 52) * Math.PI * 2;
      teeth.push(`<line x1="${(Math.cos(a) * 50).toFixed(2)}" y1="${(Math.sin(a) * 50).toFixed(2)}" x2="${(Math.cos(a) * 54).toFixed(2)}" y2="${(Math.sin(a) * 54).toFixed(2)}" />`);
    }
    const arms = [0, 72, 144, 216, 288]
      .map((d) => `<path d="M0 0 L${(Math.cos((d * Math.PI) / 180) * 44).toFixed(1)} ${(Math.sin((d * Math.PI) / 180) * 44).toFixed(1)}" stroke="#23282b" stroke-width="9" stroke-linecap="round" />`)
      .join("");
    return `
      <circle r="52" fill="none" stroke="#2f363a" stroke-width="5" />
      <g stroke="#3d454a" stroke-width="2.2">${teeth.join("")}</g>
      <circle r="36" fill="none" stroke="#1d2226" stroke-width="4" />
      ${arms}`;
  }

  function markup() {
    const seatPostTop = { x: 361, y: 120 };
    return `
    <svg viewBox="0 0 ${VIEW_WIDTH} 620" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Road bike">
      <defs>
        <linearGradient id="frame-paint" gradientUnits="userSpaceOnUse" x1="0" y1="120" x2="0" y2="460">
          <stop offset="0" stop-color="#2a2f33" />
          <stop offset="0.45" stop-color="#15181a" />
          <stop offset="1" stop-color="#090a0b" />
        </linearGradient>
        <linearGradient id="rim-face" x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0" stop-color="#22272a" />
          <stop offset="0.5" stop-color="#0e1012" />
          <stop offset="1" stop-color="#1a1e21" />
        </linearGradient>
        <linearGradient id="tire-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3a4044" />
          <stop offset="0.5" stop-color="#0a0b0c" stop-opacity="0" />
          <stop offset="1" stop-color="#2a3034" />
        </linearGradient>
        <radialGradient id="wheel-halo">
          <stop offset="0.82" stop-color="#022a34" stop-opacity="0" />
          <stop offset="0.95" stop-color="#022a34" stop-opacity="0.35" />
          <stop offset="1" stop-color="#022a34" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ground-shadow">
          <stop offset="0" stop-color="#000" stop-opacity="0.85" />
          <stop offset="1" stop-color="#000" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="saddle-paint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2b3034" />
          <stop offset="1" stop-color="#0b0c0d" />
        </linearGradient>
      </defs>

      <ellipse cx="495" cy="572" rx="420" ry="20" fill="url(#ground-shadow)" />

      ${wheel("bike-wheel-rear", REAR, true)}
      ${wheel("bike-wheel-front", FRONT, false)}

      <g>
        ${tube(BB, REAR, 12)}
        ${tube({ x: SEAT_CLUSTER.x + 4, y: SEAT_CLUSTER.y + 10 }, REAR, 10)}
        <g transform="translate(${REAR.x} ${REAR.y})">${cassette()}</g>
        <path d="M ${BB.x} ${BB.y - 52} L ${REAR.x} ${REAR.y - 24} M ${BB.x} ${BB.y + 52} L ${REAR.x + 8} ${REAR.y + 46} L ${REAR.x} ${REAR.y + 24}" fill="none" stroke="#3a4146" stroke-width="3" stroke-dasharray="4 2" />
        <g transform="translate(${REAR.x + 8} ${REAR.y + 30})">
          <rect x="-6" y="0" width="12" height="30" rx="5" fill="#1a1e21" stroke="#2f363a" />
          <circle cy="6" r="5" fill="#2f363a" />
          <circle cy="26" r="5" fill="#2f363a" />
        </g>

        ${tube(BB, SEAT_CLUSTER, 20)}
        ${tube(BB, HEAD_BOTTOM, 26)}
        ${tube({ x: SEAT_CLUSTER.x - 2, y: SEAT_CLUSTER.y }, { x: HEAD_TOP.x, y: HEAD_TOP.y + 10 }, 17)}
        <line x1="${BB.x + 40}" y1="${BB.y - 30}" x2="${HEAD_BOTTOM.x - 40}" y2="${HEAD_BOTTOM.y + 34}" stroke="#f27b38" stroke-width="2" stroke-linecap="round" opacity="0.9" />
        <text x="0" y="0" class="frame-type" transform="translate(${BB.x + 70} ${BB.y - 58}) rotate(-41)">BRUNNER</text>

        <path d="M ${HEAD_TOP.x - 6} ${HEAD_TOP.y - 4} L ${HEAD_TOP.x + 12} ${HEAD_TOP.y - 4} L ${HEAD_BOTTOM.x + 14} ${HEAD_BOTTOM.y + 6} L ${HEAD_BOTTOM.x - 12} ${HEAD_BOTTOM.y + 6} Z" fill="url(#frame-paint)" />
        <path d="M ${HEAD_TOP.x - 4} ${HEAD_TOP.y} L ${HEAD_BOTTOM.x - 8} ${HEAD_BOTTOM.y}" stroke="rgba(255,255,255,0.16)" stroke-width="1.6" />
        <circle cx="${(HEAD_TOP.x + HEAD_BOTTOM.x) / 2 + 2}" cy="${(HEAD_TOP.y + HEAD_BOTTOM.y) / 2}" r="7" fill="none" stroke="#f27b38" stroke-width="1.6" />

        <path d="M ${HEAD_BOTTOM.x - 2} ${HEAD_BOTTOM.y + 4} C ${HEAD_BOTTOM.x + 22} ${HEAD_BOTTOM.y + 90}, ${FRONT.x - 22} ${FRONT.y - 70}, ${FRONT.x} ${FRONT.y}" fill="none" stroke="url(#frame-paint)" stroke-width="15" stroke-linecap="round" />
        <path d="M ${HEAD_BOTTOM.x - 6} ${HEAD_BOTTOM.y + 8} C ${HEAD_BOTTOM.x + 16} ${HEAD_BOTTOM.y + 90}, ${FRONT.x - 28} ${FRONT.y - 70}, ${FRONT.x - 6} ${FRONT.y - 4}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.4" />

        ${tube({ x: SEAT_CLUSTER.x, y: SEAT_CLUSTER.y }, seatPostTop, 11)}
        <path d="M ${seatPostTop.x - 78} ${seatPostTop.y - 6} C ${seatPostTop.x - 40} ${seatPostTop.y - 22}, ${seatPostTop.x + 20} ${seatPostTop.y - 20}, ${seatPostTop.x + 62} ${seatPostTop.y - 4} C ${seatPostTop.x + 30} ${seatPostTop.y + 8}, ${seatPostTop.x - 40} ${seatPostTop.y + 10}, ${seatPostTop.x - 78} ${seatPostTop.y - 6} Z" fill="url(#saddle-paint)" />
        <path d="M ${seatPostTop.x - 70} ${seatPostTop.y - 10} C ${seatPostTop.x - 30} ${seatPostTop.y - 22}, ${seatPostTop.x + 20} ${seatPostTop.y - 20}, ${seatPostTop.x + 56} ${seatPostTop.y - 6}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.4" />

        <path d="M ${HEAD_TOP.x} ${HEAD_TOP.y - 2} L ${HEAD_TOP.x + 74} ${HEAD_TOP.y - 14}" stroke="url(#frame-paint)" stroke-width="13" stroke-linecap="round" />
        <path d="M ${HEAD_TOP.x + 70} ${HEAD_TOP.y - 14} C ${HEAD_TOP.x + 112} ${HEAD_TOP.y - 18}, ${HEAD_TOP.x + 124} ${HEAD_TOP.y + 4}, ${HEAD_TOP.x + 116} ${HEAD_TOP.y + 36} C ${HEAD_TOP.x + 110} ${HEAD_TOP.y + 66}, ${HEAD_TOP.x + 96} ${HEAD_TOP.y + 82}, ${HEAD_TOP.x + 72} ${HEAD_TOP.y + 78}" fill="none" stroke="#141719" stroke-width="10" stroke-linecap="round" />
        <path d="M ${HEAD_TOP.x + 96} ${HEAD_TOP.y - 16} C ${HEAD_TOP.x + 108} ${HEAD_TOP.y - 30}, ${HEAD_TOP.x + 122} ${HEAD_TOP.y - 26}, ${HEAD_TOP.x + 118} ${HEAD_TOP.y - 8} L ${HEAD_TOP.x + 112} ${HEAD_TOP.y + 30}" fill="none" stroke="#1f2427" stroke-width="12" stroke-linecap="round" />
        <path d="M ${HEAD_TOP.x + 74} ${HEAD_TOP.y - 18} C ${HEAD_TOP.x + 108} ${HEAD_TOP.y - 22}, ${HEAD_TOP.x + 122} ${HEAD_TOP.y}, ${HEAD_TOP.x + 114} ${HEAD_TOP.y + 34}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.4" />
      </g>

      <g transform="translate(${BB.x} ${BB.y})">
        <g id="bike-chainring">${chainring()}</g>
        <g id="bike-crank">
          <line x1="0" y1="0" x2="0" y2="${CRANK_LENGTH}" stroke="#1c2023" stroke-width="12" stroke-linecap="round" />
          <line x1="-3" y1="4" x2="-3" y2="${CRANK_LENGTH - 6}" stroke="rgba(255,255,255,0.14)" stroke-width="1.4" />
          <rect x="-22" y="${CRANK_LENGTH - 5}" width="44" height="10" rx="4" fill="#15181a" stroke="#2c3236" />
        </g>
        <circle r="14" fill="#16191b" stroke="#2f363a" stroke-width="2" />
        <circle r="4" fill="#f27b38" />
      </g>
    </svg>`;
  }

  let rearWheel;
  let frontWheel;
  let crankNode;
  let chainringNode;
  let wrap;
  let hero;
  let stage;
  let entrance = 1;
  let entranceStart = null;
  let lastScroll = -1;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function scrollProgress() {
    const total = hero.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    return Math.min(Math.max(window.scrollY / total, 0), 1);
  }

  function render() {
    const progress = scrollProgress();
    const scale = wrap.clientWidth / VIEW_WIDTH;
    const travel = Math.min(progress / 0.88, 1);
    const eased = travel < 0.5 ? 2 * travel * travel : 1 - Math.pow(-2 * travel + 2, 2) / 2;
    const exitDistance = window.innerWidth - wrap.offsetLeft + 40;
    const startOffset = -(wrap.offsetLeft + wrap.clientWidth + 40) * entrance;
    const x = startOffset + eased * exitDistance;
    wrap.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    const travelled = x / scale;
    const wheelDegrees = (travelled / (TIRE_RADIUS - 2)) * (180 / Math.PI);
    rearWheel.setAttribute("transform", `rotate(${wheelDegrees.toFixed(2)})`);
    frontWheel.setAttribute("transform", `rotate(${wheelDegrees.toFixed(2)})`);
    const crankDegrees = wheelDegrees / 2.6;
    crankNode.setAttribute("transform", `rotate(${crankDegrees.toFixed(2)})`);
    chainringNode.setAttribute("transform", `rotate(${crankDegrees.toFixed(2)})`);
    stage.style.setProperty("--hero-progress", progress.toFixed(4));
  }

  function tick(time) {
    if (entranceStart === null) entranceStart = time;
    const t = Math.min((time - entranceStart) / 2200, 1);
    entrance = 1 - (1 - Math.pow(1 - t, 3));
    const scroll = window.scrollY;
    if (entrance > 0 || scroll !== lastScroll) {
      render();
      lastScroll = scroll;
    }
    requestAnimationFrame(tick);
  }

  function init() {
    wrap = document.getElementById("bike");
    hero = document.getElementById("hero");
    if (!wrap || !hero) return;
    stage = hero.querySelector(".hero-stage");
    wrap.innerHTML = markup();
    rearWheel = document.getElementById("bike-wheel-rear");
    frontWheel = document.getElementById("bike-wheel-front");
    crankNode = document.getElementById("bike-crank");
    chainringNode = document.getElementById("bike-chainring");
    if (reduceMotion) {
      entrance = 0;
      render();
      window.addEventListener("scroll", render, { passive: true });
      return;
    }
    requestAnimationFrame(tick);
    window.addEventListener("resize", render);
  }

  return { init };
})();

Bike.init();
