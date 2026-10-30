// The Kinemi robot hand, modeled in code.
// A right hand seen from the back, fingers up (+Y), thumb to the left (-X), palm facing away (-Z).
// Units: 1 = palm width. Every finger is a chain of joints, so the pose can be animated.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
  type Material,
} from 'three';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface PillOpts {
  length: number;
  /** width (x) and thickness (z) at the base and at the top */
  w0: number;
  w1?: number;
  t0: number;
  t1?: number;
  /** length of the rounded end caps */
  cap0?: number;
  cap1?: number;
  /** superellipse exponent of the cross-section: 2 = ellipse, higher = boxier */
  n?: number;
  radial?: number;
  /** swell in the middle of the length, 0.05 = 5% */
  bulge?: number;
  /** push the back (+z) side out, for a domed top */
  dome?: number;
}

/** A tapered capsule with a squircle cross-section: the building block of every shell. */
export function pill(o: PillOpts): BufferGeometry {
  const { length, w0, t0, n = 2.6, radial = 40, bulge = 0, dome = 0 } = o;
  const w1 = o.w1 ?? w0;
  const t1 = o.t1 ?? t0;
  const cap0 = Math.min(o.cap0 ?? Math.min(w0, t0) * 0.5, length * 0.5);
  const cap1 = Math.min(o.cap1 ?? Math.min(w1, t1) * 0.5, length * 0.5);
  const capN = 9;
  const bodyN = Math.max(2, Math.round((length - cap0 - cap1) / 0.06));

  // rings: [y, scale]
  const rings: Array<[number, number]> = [];
  for (let k = 1; k <= capN; k++) {
    const p = (k / capN) * (Math.PI / 2);
    rings.push([cap0 * (1 - Math.cos(p)), Math.sin(p)]);
  }
  for (let k = 1; k < bodyN; k++) rings.push([cap0 + ((length - cap0 - cap1) * k) / bodyN, 1]);
  for (let k = capN; k >= 1; k--) {
    const p = (k / capN) * (Math.PI / 2);
    rings.push([length - cap1 * (1 - Math.cos(p)), Math.sin(p)]);
  }

  const pos: number[] = [0, 0, 0];
  for (const [y, s] of rings) {
    const f = y / length;
    const k = 1 + bulge * Math.sin(Math.PI * f);
    const a = ((w0 + (w1 - w0) * f) / 2) * s * k;
    const b = ((t0 + (t1 - t0) * f) / 2) * s * k;
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const x = a * Math.sign(c) * Math.abs(c) ** (2 / n);
      let z = b * Math.sign(sn) * Math.abs(sn) ** (2 / n);
      if (dome && z > 0) z += dome * s * (1 - (x / Math.max(a, 1e-6)) ** 2) * b;
      pos.push(x, y, z);
    }
  }
  pos.push(0, length, 0);

  const idx: number[] = [];
  const R = radial;
  const ring = (i: number, j: number) => 1 + i * R + (j % R);
  for (let j = 0; j < R; j++) idx.push(ring(0, j), ring(0, j + 1), 0);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = ring(i, j);
      const b = ring(i + 1, j);
      const a1 = ring(i, j + 1);
      const b1 = ring(i + 1, j + 1);
      idx.push(a, b, a1, b, b1, a1);
    }
  }
  const top = pos.length / 3 - 1;
  for (let j = 0; j < R; j++) idx.push(ring(rings.length - 1, j), top, ring(rings.length - 1, j + 1));

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

export function makeMaterials() {
  const pearl = new MeshPhysicalMaterial({
    name: 'Pearl shell',
    color: new Color('#e4ebe9'),
    roughness: 0.34,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    iridescence: 1,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [320, 820],
    envMapIntensity: 1.1,
  });
  const joint = new MeshStandardMaterial({
    name: 'Satin titanium',
    color: new Color('#8d9aa3'),
    roughness: 0.3,
    metalness: 1,
  });
  const graphite = new MeshStandardMaterial({
    name: 'Graphite',
    color: new Color('#10161d'),
    roughness: 0.4,
    metalness: 0.85,
  });
  const chrome = new MeshStandardMaterial({
    name: 'Chrome',
    color: new Color('#dfe7ea'),
    roughness: 0.1,
    metalness: 1,
  });
  const glow = new MeshBasicMaterial({ name: 'Kinemi green', color: new Color('#39d879'), toneMapped: false });
  const seam = new MeshBasicMaterial({ name: 'Seam', color: new Color('#145a37') });
  return { pearl, joint, graphite, chrome, glow, seam };
}

export type HandMaterials = ReturnType<typeof makeMaterials>;

/* ------------------------------------------------------------------ */
/* Rig                                                                 */
/* ------------------------------------------------------------------ */

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

interface SegmentSpec {
  len: number;
  w: number;
  t: number;
}

interface FingerSpec {
  base: [number, number, number];
  /** sideways spread in degrees, positive leans toward the thumb */
  splay: number;
  segments: SegmentSpec[];
  led?: boolean;
}

const FINGERS: Record<Exclude<FingerName, 'thumb'>, FingerSpec> = {
  index: {
    base: [-0.34, 0.9, 0.0],
    splay: 3,
    led: true,
    segments: [
      { len: 0.56, w: 0.232, t: 0.212 },
      { len: 0.35, w: 0.216, t: 0.198 },
      { len: 0.28, w: 0.204, t: 0.186 },
    ],
  },
  middle: {
    base: [-0.112, 0.94, 0.0],
    splay: 0,
    segments: [
      { len: 0.61, w: 0.238, t: 0.216 },
      { len: 0.38, w: 0.222, t: 0.202 },
      { len: 0.29, w: 0.208, t: 0.19 },
    ],
  },
  ring: {
    base: [0.114, 0.9, -0.01],
    splay: -3,
    segments: [
      { len: 0.57, w: 0.224, t: 0.206 },
      { len: 0.36, w: 0.21, t: 0.194 },
      { len: 0.275, w: 0.198, t: 0.182 },
    ],
  },
  pinky: {
    base: [0.322, 0.83, -0.02],
    splay: -8,
    segments: [
      { len: 0.46, w: 0.196, t: 0.182 },
      { len: 0.29, w: 0.184, t: 0.172 },
      { len: 0.235, w: 0.172, t: 0.162 },
    ],
  },
};

const THUMB: FingerSpec = {
  base: [-0.31, 0.12, -0.03],
  splay: 0,
  led: true,
  segments: [
    { len: 0.42, w: 0.29, t: 0.26 },
    { len: 0.36, w: 0.256, t: 0.236 },
    { len: 0.31, w: 0.24, t: 0.22 },
  ],
};

export interface Finger {
  root: Object3D;
  joints: Object3D[];
  tip: Object3D;
}

export interface HandRig {
  root: Group;
  wrist: Object3D;
  fingers: Record<FingerName, Finger>;
  materials: HandMaterials;
}

/** A rounded barrel across the joint (x axis): the knuckle. */
function barrel(radius: number, width: number): BufferGeometry {
  const g = pill({ length: width, w0: radius * 2, t0: radius * 2, cap0: radius * 0.55, cap1: radius * 0.55, n: 2, radial: 32 });
  g.translate(0, -width / 2, 0);
  g.rotateZ(Math.PI / 2);
  return g;
}

function buildFinger(spec: FingerSpec, m: HandMaterials, isThumb = false): Finger {
  const root = new Object3D();
  root.position.set(...spec.base);
  root.rotation.z = (spec.splay * Math.PI) / 180;
  const joints: Object3D[] = [];
  let parent: Object3D = root;
  spec.segments.forEach((seg, i) => {
    const joint = new Object3D();
    if (i > 0) joint.position.y = spec.segments[i - 1].len;
    parent.add(joint);
    joints.push(joint);

    // knuckle: a pearl barrel inside a smoked-chrome collar
    const r = seg.t * 0.5;
    joint.add(new Mesh(barrel(r * 0.9, seg.w * 0.7), m.pearl));
    joint.add(new Mesh(barrel(r * 0.76, seg.w * 0.96), m.joint));

    const last = i === spec.segments.length - 1;
    const next = spec.segments[i + 1];
    const start = r * 0.5;
    const end = last ? 0 : next.t * 0.5 * 0.5;
    const shell = new Mesh(
      pill({
        length: seg.len - start - end,
        w0: seg.w * 0.97,
        w1: next ? next.w * 1.01 : seg.w * 0.9,
        t0: seg.t * 0.94,
        t1: next ? next.t * 0.98 : seg.t * 0.86,
        cap0: seg.w * 0.13,
        cap1: last ? seg.w * 0.5 : seg.w * 0.13,
        n: isThumb ? 2.5 : 2.8,
        bulge: 0.03,
        dome: 0.14,
      }),
      m.pearl,
    );
    shell.position.y = start;
    joint.add(shell);

    if (last) {
      // sensor window on the back of the fingertip
      const nail = new Mesh(
        pill({ length: seg.len * 0.42, w0: seg.w * 0.48, t0: 0.03, cap0: 0.04, cap1: 0.05, n: 3 }),
        m.graphite,
      );
      nail.position.set(0, seg.len * 0.4, seg.t * 0.43);
      nail.rotation.x = -0.1;
      joint.add(nail);
      if (spec.led) {
        const led = new Mesh(new BoxGeometry(seg.w * 0.14, seg.w * 0.14, 0.02), m.glow);
        led.position.set(0, seg.len * 0.74, seg.t * 0.43);
        led.rotation.x = -0.1;
        joint.add(led);
      }
    }
    parent = joint;
  });
  const tip = new Object3D();
  tip.position.y = spec.segments[spec.segments.length - 1].len + 0.01;
  parent.add(tip);
  return { root, joints, tip };
}

function buildPalm(m: HandMaterials): Object3D {
  const palm = new Object3D();

  // graphite chassis on the palm side
  const core = new Mesh(pill({ length: 0.9, w0: 0.64, w1: 0.88, t0: 0.2, t1: 0.19, cap0: 0.1, cap1: 0.1, n: 2.6 }), m.graphite);
  core.position.set(0, 0.02, -0.02);
  palm.add(core);

  // the dorsal shell: one sculpted piece, domed, wider at the knuckles
  const shell = new Mesh(
    pill({ length: 0.86, w0: 0.62, w1: 0.94, t0: 0.2, t1: 0.2, cap0: 0.13, cap1: 0.1, n: 2.4, dome: 0.36, bulge: 0.07 }),
    m.pearl,
  );
  shell.position.set(0, 0.03, 0.012);
  palm.add(shell);

  // knuckle caps over each finger base
  const caps: Array<[number, number, number]> = [
    [-0.34, 0.86, 0.11],
    [-0.112, 0.9, 0.105],
    [0.114, 0.86, 0.1],
    [0.322, 0.79, 0.085],
  ];
  caps.forEach(([x, y, r]) => {
    const cap = new Mesh(pill({ length: r * 1.7, w0: r * 2.05, t0: r * 1.5, cap0: r * 0.7, cap1: r * 0.7, n: 2.2 }), m.pearl);
    cap.position.set(x, y - r * 0.85, 0.07);
    palm.add(cap);
  });

  // thenar: the heel of the thumb
  const thenar = new Mesh(pill({ length: 0.42, w0: 0.24, w1: 0.31, t0: 0.22, t1: 0.25, cap0: 0.11, cap1: 0.14, n: 2.3 }), m.pearl);
  thenar.position.set(-0.3, 0.0, -0.035);
  thenar.rotation.z = 0.38;
  palm.add(thenar);

  // the Kinemi pixel staircase, with its dashed seam
  const px = 0.056;
  const emblem = new Object3D();
  emblem.position.set(0.04, 0.38, 0.17);
  const rows = [
    [0, 0],
    [1, -1],
    [2, -2],
  ];
  for (const [cx, cy] of rows) {
    const cell = new Mesh(new BoxGeometry(px * 2, px, 0.012), m.glow);
    cell.position.set((cx + 1) * px, cy * px, 0);
    emblem.add(cell);
    const seamCut = new Mesh(new BoxGeometry(0.006, px * 0.92, 0.014), m.seam);
    seamCut.position.set((cx + 1) * px, cy * px, 0.001);
    emblem.add(seamCut);
  }
  emblem.rotation.x = -0.08;
  palm.add(emblem);
  return palm;
}

function buildForearm(m: HandMaterials): Object3D {
  const arm = new Object3D();
  const oval = 0.8; // forearm cross-section: wider than deep

  // inner core, seen through the gaps between the rings
  const core = new Mesh(new CylinderGeometry(0.22, 0.27, 3.8, 40), m.joint);
  core.scale.z = oval;
  core.position.y = -1.9;
  arm.add(core);

  // corrugated wrist: four rings, the top one carries the green light
  for (let i = 0; i < 4; i++) {
    const r = 0.25 + i * 0.008;
    const ring = new Mesh(pill({ length: 0.07, w0: r * 2, t0: r * 2 * oval, cap0: 0.03, cap1: 0.03, n: 2.2, radial: 48 }), m.pearl);
    ring.position.y = -0.06 - i * 0.085 - 0.07;
    arm.add(ring);
  }
  const light = new Mesh(new TorusGeometry(0.236, 0.009, 10, 72), m.glow);
  light.rotation.x = Math.PI / 2;
  light.scale.y = oval;
  light.position.y = -0.06;
  arm.add(light);

  // long forearm shell, slightly swelling toward the elbow
  const g = pill({ length: 2.9, w0: 0.6, w1: 0.56, t0: 0.6 * oval, t1: 0.56 * oval, cap0: 0.14, cap1: 0.16, n: 2.3, bulge: 0.06 });
  g.translate(0, -2.9, 0);
  const shell = new Mesh(g, m.pearl);
  shell.position.y = -0.43;
  arm.add(shell);
  const band = new Mesh(new CylinderGeometry(0.302, 0.306, 0.035, 56), m.joint);
  band.scale.z = oval;
  band.position.y = -1.32;
  arm.add(band);

  // a pair of chrome tendons on the inside of the wrist
  for (const x of [-0.14, 0.14]) {
    const rod = new Mesh(new CylinderGeometry(0.016, 0.016, 0.5, 16), m.chrome);
    rod.position.set(x, -0.22, -0.2);
    arm.add(rod);
  }
  return arm;
}

export function buildHand(materials: HandMaterials = makeMaterials()): HandRig {
  const root = new Group();
  root.name = 'Kinemi robot hand';
  const wrist = new Object3D();
  root.add(wrist);

  const hand = new Object3D();
  wrist.add(hand);
  hand.add(buildPalm(materials));

  const fingers = {} as Record<FingerName, Finger>;
  for (const name of ['index', 'middle', 'ring', 'pinky'] as const) {
    const f = buildFinger(FINGERS[name], materials);
    hand.add(f.root);
    fingers[name] = f;
  }
  const thumb = buildFinger(THUMB, materials, true);
  hand.add(thumb.root);
  fingers.thumb = thumb;

  root.add(buildForearm(materials));
  return { root, wrist, fingers, materials };
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

/** Flex per joint in degrees (base to tip). The thumb also gets a base orientation. */
export interface Pose {
  index: number[];
  middle: number[];
  ring: number[];
  pinky: number[];
  thumb: number[];
  /** thumb base orientation: [x, y, z] in degrees */
  thumbBase: number[];
  /** wrist bend [x, z] in degrees */
  wrist: number[];
}

export const POSES: Record<'fist' | 'rest' | 'frame', Pose> = {
  fist: {
    index: [78, 96, 58],
    middle: [84, 100, 60],
    ring: [88, 102, 60],
    pinky: [90, 100, 58],
    thumb: [20, 40, 30],
    thumbBase: [-30, -40, 40],
    wrist: [8, 0],
  },
  rest: {
    index: [26, 34, 20],
    middle: [32, 42, 26],
    ring: [38, 46, 28],
    pinky: [44, 50, 30],
    thumb: [10, 18, 14],
    thumbBase: [-18, -30, 52],
    wrist: [4, 0],
  },
  frame: {
    index: [2, 3, 2],
    middle: [86, 104, 64],
    ring: [90, 106, 64],
    pinky: [92, 104, 60],
    thumb: [2, 4, 4],
    thumbBase: [-8, -16, 84],
    wrist: [-4, -12],
  },
};

const D = Math.PI / 180;

export function applyPose(rig: HandRig, p: Pose) {
  for (const name of ['index', 'middle', 'ring', 'pinky'] as const) {
    rig.fingers[name].joints.forEach((j, i) => (j.rotation.x = -p[name][i] * D));
  }
  const t = rig.fingers.thumb;
  t.root.rotation.set(p.thumbBase[0] * D, p.thumbBase[1] * D, p.thumbBase[2] * D, 'ZYX');
  t.joints.forEach((j, i) => (j.rotation.x = -p.thumb[i] * D));
  rig.wrist.rotation.set(-p.wrist[0] * D, 0, p.wrist[1] * D);
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const k of Object.keys(a) as Array<keyof Pose>) {
    out[k] = a[k].map((v, i) => v + (b[k][i] - v) * t);
  }
  return out;
}

export function disposeHand(rig: HandRig) {
  rig.root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  for (const mat of Object.values(rig.materials) as Material[]) mat.dispose();
}
