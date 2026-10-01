/**
 * The welcome animation, as a pure module (no React). A small private network:
 * a few glowing nodes joined by threads, with encrypted messages gliding
 * between them. Depth and a gentle, cursor-following parallax — it reads as a
 * small, closed network of people, not a molecule or a plant. Nodes are plain
 * (no names or avatars) by design.
 *
 * `createPrivateNetwork(canvas)` mounts it and returns a dispose function that
 * cancels the loop, drops listeners and frees GPU resources. Respects
 * prefers-reduced-motion (renders a still frame) and pauses on a hidden tab.
 */

import * as THREE from 'three';

type Dispose = () => void;

const NODE_COLORS = [0x3c7d5d, 0x56a781, 0x2f6b4f, 0x8fbf9e, 0x4c9a74, 0xc08a3a];
const POS: [number, number, number][] = [
  [0, 0, 0], [-1.95, 0.9, -0.3], [1.95, 0.8, 0.4], [-1.5, -1.05, 0.5], [1.55, -1.0, -0.4], [0.1, 1.85, 0.1],
];
const EDGES: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 5], [2, 4], [3, 4]];

function dotTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function createPrivateNetwork(canvas: HTMLCanvasElement): Dispose {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(42, 1.8, 0.1, 100);
  cam.position.set(0, 0, 6.6);
  scene.add(new THREE.HemisphereLight(0xeaf5e6, 0x16301d, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(4, 6, 8);
  scene.add(key);

  const dot = dotTexture();
  const net = new THREE.Group();
  scene.add(net);

  // Each node is a solid coloured sphere wrapped in a soft translucent halo.
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const nodes: THREE.Vector3[] = [];
  POS.forEach((p, i) => {
    const color = NODE_COLORS[i % NODE_COLORS.length]!;
    const r = i === 0 ? 0.26 : 0.17 + (i % 3) * 0.02;

    const coreGeo = new THREE.SphereGeometry(r, 24, 24);
    const coreMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(p[0], p[1], p[2]);
    net.add(core);

    const haloGeo = new THREE.SphereGeometry(r * 2.6, 16, 16);
    const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(core.position);
    net.add(halo);

    geometries.push(coreGeo, haloGeo);
    materials.push(coreMat, haloMat);
    nodes.push(new THREE.Vector3(p[0], p[1], p[2]));
  });

  const lp = new Float32Array(EDGES.length * 6);
  EDGES.forEach((e, i) => {
    const a = nodes[e[0]]!, b = nodes[e[1]]!;
    lp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5fa07f, transparent: true, opacity: 0.28 });
  net.add(new THREE.LineSegments(lg, lineMat));
  geometries.push(lg);
  materials.push(lineMat);

  const pulses = EDGES.map((e, i) => {
    const col = i % 3 === 0 ? 0xf0c45a : 0x9ff0b8;
    const mat = new THREE.SpriteMaterial({ map: dot, color: col, transparent: true, opacity: 0.95, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(0.22);
    net.add(sp);
    materials.push(mat);
    return { a: nodes[e[0]]!, b: nodes[e[1]]!, off: Math.random(), spd: 0.16 + Math.random() * 0.12, sp };
  });

  let tx = 0, ty = 0, px = 0, py = 0;
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMove);

  let cw = 0, ch = 0;
  const resize = () => {
    const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
    if (!w || !h || (w === cw && h === ch)) return;
    cw = w; ch = h;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };

  const tmp = new THREE.Vector3();
  let raf = 0;
  let last = performance.now();
  let t = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (document.hidden) return;
    resize();
    if (!reduce) {
      t += dt;
      px += (tx - px) * 0.05;
      py += (ty - py) * 0.05;
      net.rotation.y = Math.sin(t * 0.15) * 0.26 + px * 0.35;
      net.rotation.x = Math.sin(t * 0.22) * 0.05 - py * 0.2;
      cam.position.x = px * 0.6;
      cam.position.y = -py * 0.45;
      cam.lookAt(0, 0, 0);
      for (const p of pulses) {
        const f = (t * p.spd + p.off) % 1;
        tmp.copy(p.a).lerp(p.b, f);
        p.sp.position.copy(tmp);
        p.sp.scale.setScalar(0.18 + 0.12 * Math.sin(f * Math.PI));
      }
    }
    renderer.render(scene, cam);
  };

  resize();
  renderer.render(scene, cam);
  if (!reduce) raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    dot.dispose();
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    renderer.dispose();
  };
}
