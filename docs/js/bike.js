import * as THREE from "https://esm.sh/three@0.169.0";
import { GLTFLoader } from "https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "https://esm.sh/three@0.169.0/examples/jsm/environments/RoomEnvironment.js";

const MODEL_URL = "assets/bike.glb";
const FACING = -1;
const BIKE_LENGTH = 4;
const IDLE_YAW = -0.42;
const EXIT_YAW = 0;
const DEBUG = new URLSearchParams(window.location.search).has("still");

const container = document.getElementById("bike");
const hero = document.getElementById("hero");
const stage = hero?.querySelector(".hero-stage");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollProgress() {
  const total = hero.offsetHeight - window.innerHeight;
  if (total <= 0) return 0;
  return Math.min(Math.max(window.scrollY / total, 0), 1);
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function announceReady() {
  window.dispatchEvent(new Event("bike:ready"));
}

function showPoster() {
  container.classList.add("is-poster");
  const poster = container.querySelector(".bike-poster");
  if (poster && !poster.complete) poster.addEventListener("load", announceReady, { once: true });
  else announceReady();
  const update = () => {
    const progress = scrollProgress();
    const travel = easeInOut(Math.min(progress / 0.88, 1));
    container.style.transform = `translate3d(${(travel * window.innerWidth * 1.1).toFixed(1)}px,0,0)`;
    stage.style.setProperty("--hero-progress", progress.toFixed(4));
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdfe8ea, 0x050607, 0.22));

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-2, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.radius = 10;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xe9eef0, 0.35);
  fill.position.set(3, 1.5, 6);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x3a9db5, 2.2);
  rim.position.set(-3, 4, -6);
  scene.add(rim);

  const kicker = new THREE.DirectionalLight(0xf2a070, 0.45);
  kicker.position.set(6, 3, -3);
  scene.add(kicker);
}

function mattePaint(material) {
  material.emissiveMap = null;
  material.emissive?.setRGB(0, 0, 0);
  material.envMapIntensity = 0.35;
  if (material.map) material.map.anisotropy = 8;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor, 0.48, 1.0);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= 0.45;");
  };
  material.needsUpdate = true;
}

function findMesh(root) {
  let found = null;
  root.traverse((node) => {
    if (!found && node.isMesh) found = node;
  });
  return found;
}

function modelSpacePositions(mesh) {
  const attribute = mesh.geometry.attributes.position;
  const points = new Float32Array(attribute.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < attribute.count; i++) {
    v.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrix);
    points[i * 3] = v.x;
    points[i * 3 + 1] = v.y;
    points[i * 3 + 2] = v.z;
  }
  return points;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function locateWheels(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  const contactBand = minY + (maxY - minY) * 0.01;
  const midX = (minX + maxX) / 2;
  const rearContacts = [];
  const frontContacts = [];
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 1] > contactBand) continue;
    (points[i] < midX ? rearContacts : frontContacts).push(points[i]);
  }
  const guessRadius = ((median(rearContacts) - minX) + (maxX - median(frontContacts))) / 2;

  const fitted = [median(rearContacts), median(frontContacts)].map((startX) => {
    let cx = startX;
    let cy = minY + guessRadius;
    let radius = guessRadius;
    for (let iteration = 0; iteration < 6; iteration++) {
      let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxb = 0, syb = 0, sb = 0;
      for (let i = 0; i < points.length; i += 3) {
        const px = points[i];
        const py = points[i + 1];
        const d = Math.hypot(px - cx, py - cy);
        if (d < guessRadius * 0.85 || d > guessRadius * 1.08 || Math.abs(points[i + 2]) > guessRadius * 0.13) continue;
        const b = px * px + py * py;
        sxx += 4 * px * px; sxy += 4 * px * py; sx += 2 * px; syy += 4 * py * py; sy += 2 * py; n += 1;
        sxb += 2 * px * b; syb += 2 * py * b; sb += b;
      }
      const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
      const v = [sxb, syb, sb];
      const solution = solve3(m, v);
      if (!solution) break;
      cx = solution[0];
      cy = solution[1];
      radius = Math.sqrt(solution[2] + cx * cx + cy * cy);
    }
    return { x: cx, radius };
  });

  const tyreRadius = (fitted[0].radius + fitted[1].radius) / 2 + guessRadius * 0.03;
  return fitted.map(({ x }) => ({ x, y: minY + tyreRadius, z: 0, radius: tyreRadius }));
}

function solve3(m, v) {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < 4; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

function belongsToWheel(cx, cy, cz, wheel) {
  const d = Math.hypot(cx - wheel.x, cy - wheel.y);
  const r = wheel.radius;
  if (d > r * 1.14) return false;
  const depth = Math.abs(cz - wheel.z);
  if (d < r * 0.12) return depth < r * 0.12;
  if (d < r * 0.55) return depth < r * 0.05;
  return depth < r * 0.095;
}

const WHEEL_MATERIALS = {
  tyre: new THREE.MeshStandardMaterial({ color: 0x060707, roughness: 0.72, metalness: 0, envMapIntensity: 0.4 }),
  rim: new THREE.MeshPhysicalMaterial({ color: 0x0b0c0d, roughness: 0.4, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.35, envMapIntensity: 0.5 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xf27b38, roughness: 0.5, metalness: 0.1, emissive: 0x3a1404 }),
  spoke: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.45, metalness: 0.6 }),
  hub: new THREE.MeshStandardMaterial({ color: 0x1a1d1f, roughness: 0.5, metalness: 0.4 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8d9398, roughness: 0.38, metalness: 0.85 }),
};

function ringGeometry(outer, inner, depth, segments = 160) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: segments,
    bevelEnabled: true,
    bevelThickness: depth * 0.18,
    bevelSize: depth * 0.12,
    bevelSegments: 3,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function rimDecalTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const centre = size / 2;
  const outer = centre;
  const inner = outer * (0.765 / 0.918);
  const mid = (outer + inner) / 2;

  ctx.translate(centre, centre);
  ctx.strokeStyle = "rgba(242,123,56,0.95)";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, mid, Math.PI * 0.62, Math.PI * 0.88);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, mid, Math.PI * 1.62, Math.PI * 1.88);
  ctx.stroke();

  ctx.fillStyle = "rgba(236,233,228,0.92)";
  ctx.font = "500 46px Jost, Futura, 'Helvetica Neue', Arial, sans-serif";
  ctx.textBaseline = "middle";
  const word = "BRUNNER";
  const spacing = 0.085;
  [Math.PI * 1.25, Math.PI * 0.25].forEach((start) => {
    for (let i = 0; i < word.length; i++) {
      const angle = start - ((word.length - 1) / 2 - i) * spacing;
      ctx.save();
      ctx.rotate(angle);
      ctx.translate(0, -mid);
      ctx.textAlign = "center";
      ctx.fillText(word[i], 0, 0);
      ctx.restore();
    }
  });

  ctx.strokeStyle = "rgba(236,233,228,0.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 48; i++) {
    const angle = (i / 48) * Math.PI * 2;
    if (i % 12 > 3 && i % 12 < 9) continue;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * (inner + 6), Math.sin(angle) * (inner + 6));
    ctx.lineTo(Math.cos(angle) * (inner + 16), Math.sin(angle) * (inner + 16));
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

let sharedDecal = null;

function buildWheel(R, withCassette) {
  const wheel = new THREE.Group();

  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.955, R * 0.045, 28, 180), WHEEL_MATERIALS.tyre));
  wheel.add(new THREE.Mesh(ringGeometry(R * 0.918, R * 0.765, R * 0.05), WHEEL_MATERIALS.rim));
  [-1, 1].forEach((side) => {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * 0.842, R * 0.0032, 8, 180), WHEEL_MATERIALS.accent);
    stripe.position.z = side * R * 0.036;
    wheel.add(stripe);
  });

  sharedDecal = sharedDecal || rimDecalTexture();
  const decalMaterial = new THREE.MeshStandardMaterial({ map: sharedDecal, transparent: true, roughness: 0.55, metalness: 0, depthWrite: false });
  [-1, 1].forEach((side) => {
    const decal = new THREE.Mesh(new THREE.RingGeometry(R * 0.765, R * 0.918, 160, 1), decalMaterial);
    decal.position.z = side * R * 0.0375;
    if (side < 0) decal.rotation.y = Math.PI;
    wheel.add(decal);
  });

  const valve = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.009, R * 0.009, R * 0.09, 12), WHEEL_MATERIALS.steel);
  valve.position.y = R * 0.72;
  wheel.add(valve);
  const valveCap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.03, 12), WHEEL_MATERIALS.accent);
  valveCap.position.y = R * 0.67;
  wheel.add(valveCap);

  const spokeCount = 24;
  const spokes = new THREE.InstancedMesh(new THREE.CylinderGeometry(R * 0.0035, R * 0.0035, 1, 6), WHEEL_MATERIALS.spoke, spokeCount);
  const up = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI * 2;
    const side = i % 2 === 0 ? 1 : -1;
    const hubAngle = angle + side * 0.22;
    const hubEnd = new THREE.Vector3(Math.cos(hubAngle) * R * 0.06, Math.sin(hubAngle) * R * 0.06, side * R * 0.045);
    const rimEnd = new THREE.Vector3(Math.cos(angle) * R * 0.768, Math.sin(angle) * R * 0.768, 0);
    const direction = rimEnd.clone().sub(hubEnd);
    const length = direction.length();
    quaternion.setFromUnitVectors(up, direction.normalize());
    matrix.compose(hubEnd.clone().add(rimEnd).multiplyScalar(0.5), quaternion, new THREE.Vector3(1, length, 1));
    spokes.setMatrixAt(i, matrix);
  }
  wheel.add(spokes);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.05, R * 0.05, R * 0.16, 32), WHEEL_MATERIALS.hub);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.022, R * 0.022, R * 0.18, 24), WHEEL_MATERIALS.accent);
  cap.rotation.x = Math.PI / 2;
  wheel.add(cap);

  const rotor = new THREE.Mesh(ringGeometry(R * 0.215, R * 0.165, R * 0.006, 96), WHEEL_MATERIALS.steel);
  rotor.position.z = R * 0.075;
  wheel.add(rotor);
  const carrier = new THREE.Mesh(ringGeometry(R * 0.165, R * 0.05, R * 0.008, 64), WHEEL_MATERIALS.hub);
  carrier.position.z = R * 0.075;
  wheel.add(carrier);

  if (withCassette) {
    for (let i = 0; i < 7; i++) {
      const cog = new THREE.Mesh(new THREE.CylinderGeometry(R * (0.17 - i * 0.014), R * (0.17 - i * 0.014), R * 0.006, 48), WHEEL_MATERIALS.steel);
      cog.rotation.x = Math.PI / 2;
      cog.position.z = -R * (0.06 + i * 0.011);
      wheel.add(cog);
    }
  }

  wheel.traverse((node) => {
    if (node.isMesh) node.castShadow = true;
  });
  return wheel;
}

function splitWheels(mesh) {
  const points = modelSpacePositions(mesh);
  const wheels = locateWheels(points);
  const index = mesh.geometry.index.array;
  const kept = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const cx = (points[a] + points[b] + points[c]) / 3;
    const cy = (points[a + 1] + points[b + 1] + points[c + 1]) / 3;
    const cz = (points[a + 2] + points[b + 2] + points[c + 2]) / 3;
    if (wheels.some((wheel) => belongsToWheel(cx, cy, cz, wheel))) continue;
    kept.push(index[t], index[t + 1], index[t + 2]);
  }

  const geometry = new THREE.BufferGeometry();
  Object.entries(mesh.geometry.attributes).forEach(([name, attribute]) => geometry.setAttribute(name, attribute));
  geometry.setIndex(new THREE.BufferAttribute(new index.constructor(kept), 1));
  geometry.computeBoundingSphere();

  const container = new THREE.Group();
  const frame = new THREE.Mesh(geometry, mesh.material);
  frame.applyMatrix4(mesh.matrix);
  container.add(frame);

  const spinners = wheels.map((wheel, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(wheel.x, wheel.y, wheel.z);
    pivot.add(buildWheel(wheel.radius, i === 0));
    container.add(pivot);
    return pivot;
  });

  return { container, spinners, radius: wheels[0].radius };
}

function buildBike(root) {
  root.updateMatrixWorld(true);
  const mesh = findMesh(root);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach(mattePaint);
  const { container: model, spinners, radius } = splitWheels(mesh);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = BIKE_LENGTH / size.x;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const centre = fitted.getCenter(new THREE.Vector3());
  model.position.set(-centre.x, -fitted.min.y, -centre.z);

  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });

  const facing = new THREE.Group();
  facing.rotation.y = FACING === 1 ? 0 : Math.PI;
  facing.add(model);
  const pivot = new THREE.Group();
  pivot.add(facing);
  return { bike: pivot, spinners, wheelRadius: radius * scale };
}

function addGround(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.6 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function init() {
  if (!container || !hero) return;
  let renderer;
  try {
    renderer = createRenderer();
  } catch {
    showPoster();
    return;
  }

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  addLights(scene);
  addGround(scene);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  container.appendChild(renderer.domElement);

  let rig = null;
  let loadedAt = 0;
  let revealed = document.documentElement.classList.contains("is-loaded");
  window.addEventListener("app:revealed", () => {
    revealed = true;
    loadedAt = performance.now();
  });
  let restOrigin = null;
  const cameraTarget = new THREE.Vector3(0, 1.2, 0);

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const narrow = camera.aspect < 0.9;
    camera.fov = narrow ? 42 : 28;
    camera.position.set(0, narrow ? 1.6 : 1.55, narrow ? 11.5 : 9.2);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
  }

  function frustumHalfWidth() {
    const distance = camera.position.distanceTo(cameraTarget);
    return Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance * camera.aspect;
  }

  function render(time) {
    const progress = scrollProgress();
    stage.style.setProperty("--hero-progress", progress.toFixed(4));
    if (rig) {
      const { bike, spinners, wheelRadius } = rig;
      const since = revealed ? (time - loadedAt) / 1000 : 0;
      const entrance = reduceMotion || DEBUG ? 1 : revealed ? 1 - Math.pow(1 - Math.min(Math.max(since, 0) / 2.4, 1), 3) : 0;
      const travel = easeInOut(Math.min(progress / 0.88, 1));
      const halfWidth = frustumHalfWidth();
      const restX = camera.aspect < 0.9 ? 0 : halfWidth * 0.22;
      const startX = -halfWidth - BIKE_LENGTH;
      const exitX = halfWidth + BIKE_LENGTH * 1.2;
      bike.position.x = startX + (restX - startX) * entrance + (exitX - restX) * travel;
      if (restOrigin === null) restOrigin = startX;
      const rolled = (bike.position.x - restOrigin) / wheelRadius;
      spinners.forEach((wheel) => {
        wheel.rotation.z = rolled * FACING * -1;
      });
      const idleSway = reduceMotion || DEBUG ? 0 : Math.sin(since * 0.45) * 0.06 * (1 - travel);
      const turn = Math.min(progress / 0.25, 1);
      bike.rotation.y = DEBUG ? 0 : IDLE_YAW + (EXIT_YAW - IDLE_YAW) * easeInOut(turn) + idleSway;
    }
    renderer.render(scene, camera);
  }

  let running = true;
  new IntersectionObserver(([entry]) => {
    const wasRunning = running;
    running = entry.isIntersecting;
    if (running && !wasRunning) requestAnimationFrame(loop);
  }).observe(hero);

  function loop(time) {
    if (!running) return;
    render(time);
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize);

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      rig = buildBike(gltf.scene);
      scene.add(rig.bike);
      if (revealed) loadedAt = performance.now();
      container.classList.add("is-ready");
      renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
        render(performance.now());
        announceReady();
      });
    },
    undefined,
    () => {
      renderer.domElement.remove();
      showPoster();
    }
  );
  requestAnimationFrame(loop);
}

init();
