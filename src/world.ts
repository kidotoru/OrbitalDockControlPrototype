import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | null;
  render(realDt: number): void;
}

// ---------- 惑星テクスチャ（球面上の3Dバリューノイズ） ----------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function makePlanetTextures(): { surface: THREE.CanvasTexture; clouds: THREE.CanvasTexture } {
  const W = 768, H = 384;
  const sc = document.createElement('canvas');
  sc.width = W; sc.height = H;
  const cc = document.createElement('canvas');
  cc.width = W; cc.height = H;
  const sctx = sc.getContext('2d')!;
  const cctx = cc.getContext('2d')!;
  const simg = sctx.createImageData(W, H);
  const cimg = cctx.createImageData(W, H);

  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
  const deep = [8, 32, 74], shallow = [28, 104, 158];
  const green = [58, 98, 52], brown = [128, 112, 76], rock = [150, 140, 125], ice = [230, 238, 245];

  for (let j = 0; j < H; j++) {
    const lat = (0.5 - j / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
      const h = fbm(x * 2.2 + 5, y * 2.2, z * 2.2, 1, 6);
      const m = fbm(x * 4 + 11, y * 4, z * 4, 7, 4);
      let col: number[];
      if (h < 0.52) {
        col = mix(deep, shallow, (h - 0.38) / 0.14);
      } else {
        col = mix(green, brown, (m - 0.4) / 0.25);
        col = mix(col, rock, (h - 0.6) / 0.1);
      }
      const polar = Math.abs(lat) / (Math.PI / 2) + (m - 0.5) * 0.25;
      if (polar > 0.82) col = mix(col, ice, (polar - 0.82) / 0.05);
      const k = (j * W + i) * 4;
      simg.data[k] = col[0]; simg.data[k + 1] = col[1]; simg.data[k + 2] = col[2]; simg.data[k + 3] = 255;

      const cn = fbm(x * 3 + 31, y * 6, z * 3, 23, 5);
      const a = Math.min(1, Math.max(0, (cn - 0.5) / 0.2));
      cimg.data[k] = 255; cimg.data[k + 1] = 255; cimg.data[k + 2] = 255; cimg.data[k + 3] = Math.round(a * 220);
    }
  }
  sctx.putImageData(simg, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  const surface = new THREE.CanvasTexture(sc);
  const clouds = new THREE.CanvasTexture(cc);
  surface.colorSpace = THREE.SRGBColorSpace;
  clouds.colorSpace = THREE.SRGBColorSpace;
  return { surface, clouds };
}

// ---------- ワールド構築 ----------

export function createWorld(container: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);

  const portrait = () => window.innerWidth / window.innerHeight < 0.8;
  const camera = new THREE.PerspectiveCamera(portrait() ? 65 : 50, window.innerWidth / window.innerHeight, 0.1, 8000);
  // 縦長画面では待機中の機体まで入るよう引きで始める
  camera.position.set(80, 44, 92).setLength(portrait() ? 175 : 130);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 25;
  controls.maxDistance = 320;
  controls.enablePan = false;

  // 光源
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
  sun.position.set(120, 60, 40);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa6d6, 0x1a2238, 0.45));

  // 星
  const starGeo = new THREE.BufferGeometry();
  const N = 3500;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(3500);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));

  // 惑星（ステーション下方。赤道付近が見えるよう自転軸を傾ける）
  const R = 600;
  const { surface, clouds } = makePlanetTextures();
  const tilt = new THREE.Group();
  tilt.position.set(0, -R - 70, 0);
  tilt.rotation.z = Math.PI * 0.45;
  tilt.rotation.x = 0.3;
  scene.add(tilt);
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    new THREE.MeshStandardMaterial({ map: surface, roughness: 0.9, metalness: 0 }),
  );
  tilt.add(planet);
  const cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.008, 96, 64),
    new THREE.MeshStandardMaterial({ map: clouds, transparent: true, depthWrite: false, roughness: 1 }),
  );
  tilt.add(cloudMesh);
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vP = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP;
        void main() {
          float f = 1.0 - abs(dot(normalize(-vP), vN));
          f = pow(f, 4.0);
          gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * f * 1.4;
        }`,
    }),
  );
  tilt.add(atmo);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // 縦長画面では下部パネルぶん、描画の中心を上にずらす
  const applyView = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = portrait() ? 65 : 50;
    if (portrait()) camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  applyView();
  window.addEventListener('resize', () => {
    applyView();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene, camera, renderer, labelRenderer, controls,
    pick(clientX, clientY, objects) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(objects, false);
      return hits[0] ?? null;
    },
    render(realDt) {
      planet.rotation.y += realDt * 0.004;
      cloudMesh.rotation.y += realDt * 0.0055;
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
  };
}
