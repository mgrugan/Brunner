import * as THREE from "https://esm.sh/three@0.169.0";
import { GLTFLoader } from "https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "https://esm.sh/three@0.169.0/examples/jsm/environments/RoomEnvironment.js";

const MODEL_URL = "assets/bike.glb";
const FACING = 1;
const BIKE_LENGTH = 4;
const IDLE_YAW = -0.42;
const EXIT_YAW = 0;

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

function showPoster() {
  container.classList.add("is-poster");
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
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0x9fb6bd, 0x050607, 0.35));

  const key = new THREE.DirectionalLight(0xfff1e6, 2.6);
  key.position.set(2.5, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x2f8fa6, 3.2);
  rim.position.set(-4, 3, -5);
  scene.add(rim);

  const warm = new THREE.PointLight(0xf27b38, 6, 9, 2);
  warm.position.set(1.8, 0.4, 2.4);
  scene.add(warm);
}

function normaliseModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.z > size.x) root.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);

  const turned = new THREE.Box3().setFromObject(root);
  const scale = BIKE_LENGTH / turned.getSize(new THREE.Vector3()).x;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(root);
  const centre = fitted.getCenter(new THREE.Vector3());
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= fitted.min.y;

  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if ("envMapIntensity" in material) material.envMapIntensity = 0.9;
      if (material.map) material.map.anisotropy = 8;
    });
  });

  const pivot = new THREE.Group();
  const facing = new THREE.Group();
  facing.rotation.y = FACING === 1 ? 0 : Math.PI;
  facing.add(root);
  pivot.add(facing);
  return pivot;
}

function addGround(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.55 }));
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

  let bike = null;
  let loadedAt = 0;
  const cameraTarget = new THREE.Vector3(0, 0.95, 0);

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const narrow = camera.aspect < 0.9;
    camera.fov = narrow ? 42 : 28;
    camera.position.set(0, narrow ? 1.6 : 1.55, narrow ? 9.5 : 9.2);
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
    if (bike) {
      const since = (time - loadedAt) / 1000;
      const entrance = reduceMotion ? 1 : 1 - Math.pow(1 - Math.min(Math.max(since, 0) / 2.2, 1), 3);
      const travel = easeInOut(Math.min(progress / 0.88, 1));
      const halfWidth = frustumHalfWidth();
      const restX = camera.aspect < 0.9 ? 0 : halfWidth * 0.22;
      const startX = -halfWidth - BIKE_LENGTH;
      const exitX = halfWidth + BIKE_LENGTH * 1.2;
      bike.position.x = startX + (restX - startX) * entrance + (exitX - restX) * travel;
      const idleSway = reduceMotion ? 0 : Math.sin(since * 0.45) * 0.06 * (1 - travel);
      const turn = Math.min(progress / 0.25, 1);
      bike.rotation.y = IDLE_YAW + (EXIT_YAW - IDLE_YAW) * easeInOut(turn) + idleSway;
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
      bike = normaliseModel(gltf.scene);
      scene.add(bike);
      loadedAt = performance.now();
      container.classList.add("is-ready");
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
