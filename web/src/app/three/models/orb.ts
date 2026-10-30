// The chat's avatar: the Kinemi K as pearl voxels with the green pixel staircase and its dashed seam,
// floating in a glass orb with two light rings. It turns to the cursor, perks up while you type and
// spins while it thinks.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mats } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

// the K, 7 x 9 voxels, traced from the logo (stem two wide, arm and leg two wide)
const K = ['##...##', '##..##.', '##.##..', '####...', '###....', '####...', '##.##..', '##..##.', '##...##'];

function fresnel(color: string, power: number, intensity: number) {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color(color) }, power: { value: power }, intensity: { value: intensity } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float power;
      uniform float intensity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), power) * intensity;
        gl_FragColor = vec4(color * f, f);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

export function create(opts: ModelOptions): Built {
  const m = mats();
  const root = new Group();
  const k = new Group();
  root.add(k);

  // centre of the mark: K spans x 0..7, the staircase reaches x 11.4; y from -0.75 to 9
  const cx = 5.7;
  const cy = 4.1;
  const cube = new RoundedBoxGeometry(0.92, 0.92, 0.92, 2, 0.12);
  const kCells: Array<[number, number]> = [];
  K.forEach((row, y) => [...row].forEach((c, x) => c === '#' && kCells.push([x + 0.5, y + 0.5])));
  const kMesh = new InstancedMesh(cube, m.bright, kCells.length);
  const mat = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  kCells.forEach(([x, y], i) => {
    mat.compose(new Vector3(x - cx, cy - y, 0), q, one);
    kMesh.setMatrixAt(i, mat);
  });
  k.add(kMesh);

  // the staircase: three rows of two, stepping down to the right, a touch proud of the K
  const green = (m.green as MeshStandardMaterial).clone();
  const steps: Array<[number, number]> = [];
  for (let r = 0; r < 3; r++) for (let j = 0; j < 2; j++) steps.push([7.36 + r + j + 0.5, -0.75 + r + 0.5]);
  const stepMesh = new InstancedMesh(cube, green, steps.length);
  steps.forEach(([x, y], i) => {
    mat.compose(new Vector3(x - cx, cy - y, 0.22), q, one);
    stepMesh.setMatrixAt(i, mat);
  });
  k.add(stepMesh);

  // the dashed seam through the staircase, on its front face
  const seamPts: Array<[number, number, number, number]> = [
    [8.36, -0.75, 8.36, 0.25],
    [8.36, 0.25, 9.36, 0.25],
    [9.36, 0.25, 9.36, 1.25],
    [9.36, 1.25, 10.36, 1.25],
    [10.36, 1.25, 10.36, 2.25],
  ];
  const dash = new BoxGeometry(1, 1, 1);
  const seam = new Group();
  for (const [x0, y0, x1, y1] of seamPts) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.round(len / 0.26);
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.15) / n;
      const t1 = (i + 0.75) / n;
      const d = new Mesh(dash, m.seam);
      const vx = x0 + (x1 - x0) * ((t0 + t1) / 2);
      const vy = y0 + (y1 - y0) * ((t0 + t1) / 2);
      const horizontal = y0 === y1;
      d.scale.set(horizontal ? len * (t1 - t0) : 0.09, horizontal ? 0.09 : len * (t1 - t0), 0.05);
      d.position.set(vx - cx, cy - vy, 0.72);
      seam.add(d);
    }
  }
  k.add(seam);
  k.scale.setScalar(0.82);

  // the orb: a fresnel shell, an inner glow and two rings of light
  const shell = new Mesh(new SphereGeometry(7.6, 48, 32), fresnel('#39d879', 2.4, 1.1));
  const inner = new Mesh(new SphereGeometry(7.4, 48, 32), fresnel('#2ee6c4', 5, 0.5));
  root.add(shell, inner);
  const ringA = new Mesh(new TorusGeometry(8.4, 0.05, 8, 180), m.glow);
  const ringB = new Mesh(new TorusGeometry(9.1, 0.035, 8, 180), m.teal);
  ringA.rotation.set(1.25, 0.2, 0);
  ringB.rotation.set(1.05, -0.5, 0.3);
  const rings = new Group();
  rings.add(ringA, ringB);
  root.add(rings);

  // pixels orbiting on the rings
  const bits = new Group();
  const bit = new BoxGeometry(0.42, 0.42, 0.42);
  const bitMeshes = Array.from({ length: 9 }, (_, i) => {
    const b = new Mesh(bit, i % 3 === 0 ? m.pearl : m.glow);
    bits.add(b);
    return { mesh: b, r: i % 2 ? 8.4 : 9.1, phase: (i / 9) * Math.PI * 2, speed: 0.35 + (i % 3) * 0.12, ring: i % 2 ? ringA : ringB };
  });
  root.add(bits);

  let mood = opts.mood ?? 'idle';
  let spin = 0;
  let energy = 0;
  const look = { x: 0, y: 0 };
  const v = new Vector3();

  return {
    root,
    view: { fov: 30, distance: 33, dir: [0, 0.06, 1] },
    setOptions(o) {
      if (o.mood === 'thinking' && mood !== 'thinking') spin = Math.PI * 2;
      mood = o.mood ?? 'idle';
    },
    update(t, dt, s) {
      const kk = 1 - Math.exp(-dt * 3);
      look.x += (s.pointer.x - look.x) * kk;
      look.y += (s.pointer.y - look.y) * kk;
      const target = mood === 'listening' ? 1 : mood === 'thinking' ? 1.4 : 0;
      energy += (target - energy) * (1 - Math.exp(-dt * 4));
      if (spin > 0) spin = Math.max(0, spin - dt * 7);
      k.rotation.y = Math.sin(t * 0.6) * 0.32 * (1 - energy * 0.6) + look.x * 0.45 + spin;
      k.rotation.x = look.y * 0.25 + Math.sin(t * 0.8) * 0.05;
      k.position.y = Math.sin(t * 1.1) * 0.3;
      rings.rotation.y = t * (0.25 + energy * 0.6);
      rings.rotation.z = Math.sin(t * 0.3) * 0.2;
      green.emissiveIntensity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3)) * (0.4 + energy);
      (shell.material as ShaderMaterial).uniforms.intensity.value = 1.0 + energy * 0.6 + Math.sin(t * 2) * 0.08;
      for (const b of bitMeshes) {
        const a = b.phase + t * b.speed * (1 + energy * 1.5);
        v.set(Math.cos(a) * b.r, Math.sin(a) * b.r, 0).applyEuler(b.ring.rotation);
        b.mesh.position.copy(v);
        b.mesh.rotation.set(a, a * 0.7, 0);
      }
      return true;
    },
    dispose() {
      green.dispose();
      (shell.material as ShaderMaterial).dispose();
      (inner.material as ShaderMaterial).dispose();
    },
  };
}
