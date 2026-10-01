/**
 * The welcome animation, as a pure module (no React). A small private network:
 * a few people (avatar chips) joined by message threads, with encrypted messages
 * gliding between them. Depth and a gentle, cursor-following parallax. It reads as
 * a social circle, not a molecule or a plant.
 *
 * `createPrivateNetwork(canvas)` mounts it and returns a dispose function that
 * cancels the loop, drops listeners and frees GPU resources. Respects
 * prefers-reduced-motion (renders a still frame) and pauses on a hidden tab.
 */

import * as THREE from 'three';

type Dispose = () => void;

const PEOPLE = [
  { c: '#3c7d5d', l: 'M' }, { c: '#8fbf9e', l: 'P' }, { c: '#2f6b4f', l: 'I' },
  { c: '#4c9a74', l: 'R' }, { c: '#c79a4a', l: 'A' }, { c: '#56a781', l: 'J' },
];
const POS: [number, number, number][] = [
  [0, 0, 0], [-1.95, 0.9, -0.3], [1.95, 0.8, 0.4], [-1.5, -1.05, 0.5], [1.55, -1.0, -0.4], [0.1, 1.85, 0.1],
];
const EDGES: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 5], [2, 4], [3, 4]];

function avatarTexture(color: string, letter: string): THREE.CanvasTexture {
  const s = 160;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = '600 74px "Schibsted Grotesk", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, s / 2, s / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

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
  const avatarTextures: THREE.Texture[] = [];
  const net = new THREE.Group();
  scene.add(net);

  const nodes: THREE.Vector3[] = [];
  PEOPLE.forEach((pe, i) => {
    const tex = avatarTexture(pe.c, pe.l);
    avatarTextures.push(tex);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.setScalar(i === 0 ? 1.05 : 0.86);
    spr.position.set(POS[i]![0], POS[i]![1], POS[i]![2]);
    net.add(spr);
    nodes.push(new THREE.Vector3(POS[i]![0], POS[i]![1], POS[i]![2]));
  });

  const lp = new Float32Array(EDGES.length * 6);
  EDGES.forEach((e, i) => {
    const a = nodes[e[0]]!, b = nodes[e[1]]!;
    lp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x5fa07f, transparent: true, opacity: 0.28 }));
  net.add(lines);

  const pulses = EDGES.map((e, i) => {
    const col = i % 3 === 0 ? 0xf0c45a : 0x9ff0b8;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: col, transparent: true, opacity: 0.95, depthWrite: false }));
    sp.scale.setScalar(0.22);
    net.add(sp);
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
    avatarTextures.forEach((t) => t.dispose());
    dot.dispose();
    lg.dispose();
    renderer.dispose();
  };
}
