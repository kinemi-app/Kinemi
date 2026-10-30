// A cinema camera, modeled for the tools page: graphite body with a pearl side panel and the green
// pixel staircase, a film magazine with two turning reels, a long lens with a coated front element,
// a matte box, rods, a follow focus, a top handle and a blinking tally light.
import {
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mats, shadowMaterial } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, '#0d2a20');
  grad.addColorStop(1, '#06120d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = 'rgba(57,216,121,0.35)';
  g.lineWidth = 2;
  for (const x of [85, 171]) g.strokeRect(x, 0, 0.5, 160);
  for (const y of [53, 107]) g.strokeRect(0, y, 256, 0.5);
  g.strokeStyle = '#39d879';
  g.lineWidth = 4;
  g.strokeRect(14, 14, 228, 132);
  g.fillStyle = '#ff4d4d';
  g.fillRect(24, 24, 12, 12);
  g.fillStyle = '#f2f7f4';
  g.font = 'bold 18px monospace';
  g.fillText('REC 01:24', 44, 36);
  g.fillText('35MM F/1.8', 120, 140);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function reel(radius: number, m: ReturnType<typeof mats>) {
  const g = new Group();
  const disc = new Mesh(new CylinderGeometry(radius, radius, 0.42, 48), m.graphite);
  disc.rotation.z = Math.PI / 2;
  const rim = new Mesh(new TorusGeometry(radius, 0.05, 8, 64), m.satin);
  rim.rotation.y = Math.PI / 2;
  const rim2 = rim.clone();
  rim.position.x = 0.22;
  rim2.position.x = -0.22;
  const hub = new Mesh(new CylinderGeometry(radius * 0.28, radius * 0.28, 0.5, 24), m.pearl);
  hub.rotation.z = Math.PI / 2;
  g.add(disc, rim, rim2, hub);
  // five holes on each face, as darker discs
  const hole = new CylinderGeometry(radius * 0.2, radius * 0.2, 0.46, 20);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const h = new Mesh(hole, m.rubber);
    h.rotation.z = Math.PI / 2;
    h.position.set(0, Math.cos(a) * radius * 0.6, Math.sin(a) * radius * 0.6);
    g.add(h);
  }
  return g;
}

export function create(_opts: ModelOptions): Built {
  const m = mats();
  const root = new Group();
  const cam = new Group();
  root.add(cam);

  // body and panels
  const body = new Mesh(new RoundedBoxGeometry(2.2, 2.0, 3.4, 4, 0.2), m.graphite);
  const side = new Mesh(new RoundedBoxGeometry(0.14, 1.6, 2.8, 3, 0.06), m.pearl);
  side.position.set(1.13, 0.05, -0.1);
  const base = new Mesh(new RoundedBoxGeometry(1.7, 0.2, 3.0, 2, 0.06), m.rubber);
  base.position.set(0, -1.12, 0);
  cam.add(body, side, base);

  // the Kinemi staircase on the side panel
  const step = new RoundedBoxGeometry(0.24, 0.24, 0.24, 2, 0.04);
  for (let r = 0; r < 3; r++)
    for (let j = 0; j < 2; j++) {
      const s = new Mesh(step, m.green);
      s.position.set(1.24, 0.55 - r * 0.25, -0.95 + (r + j) * 0.25);
      cam.add(s);
    }

  // a monitor on the left
  const screenMat = new MeshStandardMaterial({ map: screenTexture(), emissive: 0xffffff, emissiveMap: null, roughness: 0.2, metalness: 0.2 });
  screenMat.emissiveMap = screenMat.map;
  screenMat.emissiveIntensity = 0.65;
  const monitor = new Mesh(new RoundedBoxGeometry(0.12, 1.0, 1.55, 2, 0.04), m.graphite);
  monitor.position.set(-1.2, 0.35, 0.2);
  const screen = new Mesh(new PlaneGeometry(1.4, 0.88), screenMat);
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(-1.27, 0.35, 0.2);
  cam.add(monitor, screen);

  // the lens
  const along = (geo: CylinderGeometry, mat: Material, z: number) => {
    const mesh = new Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 0.05, z);
    cam.add(mesh);
    return mesh;
  };
  along(new CylinderGeometry(0.72, 0.72, 0.28, 48), m.satin, 1.82);
  along(new CylinderGeometry(0.62, 0.66, 2.1, 48), m.graphite, 2.95);
  along(new CylinderGeometry(0.69, 0.69, 0.42, 48), m.pearl, 2.45);
  along(new CylinderGeometry(0.68, 0.68, 0.3, 48), m.satin, 3.25);
  along(new CylinderGeometry(0.72, 0.64, 0.24, 48), m.graphite, 4.05);
  along(new CylinderGeometry(0.56, 0.56, 0.04, 48), m.glass, 4.17);
  const coat = new Mesh(new TorusGeometry(0.36, 0.04, 8, 48), m.teal);
  coat.position.set(0, 0.05, 4.2);
  const ring = new Mesh(new TorusGeometry(0.69, 0.025, 8, 64), m.glow);
  ring.position.set(0, 0.05, 2.7);
  cam.add(coat, ring);

  // matte box: a frame with flags
  const mb = new Group();
  const bar = (w: number, h: number, x: number, y: number) => {
    const b = new Mesh(new RoundedBoxGeometry(w, h, 0.7, 2, 0.03), m.graphite);
    b.position.set(x, y, 0);
    mb.add(b);
  };
  bar(2.0, 0.1, 0, 0.78);
  bar(2.0, 0.1, 0, -0.78);
  bar(0.1, 1.66, 0.98, 0);
  bar(0.1, 1.66, -0.98, 0);
  const flag = new Mesh(new RoundedBoxGeometry(2.0, 0.04, 0.9, 2, 0.02), m.soft);
  flag.position.set(0, 0.9, 0.45);
  flag.rotation.x = -0.35;
  const flag2 = flag.clone();
  flag2.position.set(0, -0.9, 0.45);
  flag2.rotation.x = 0.35;
  mb.add(flag, flag2);
  mb.position.set(0, 0.05, 4.6);
  cam.add(mb);

  // rods and the follow focus
  for (const x of [-0.35, 0.35]) {
    const rod = new Mesh(new CylinderGeometry(0.06, 0.06, 4.4, 12), m.satin);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(x, -0.95, 2.1);
    cam.add(rod);
  }
  const gear = new Mesh(new CylinderGeometry(0.32, 0.32, 0.22, 20), m.satin);
  gear.rotation.z = Math.PI / 2;
  gear.position.set(-0.85, -0.45, 2.45);
  const knob = new Mesh(new CylinderGeometry(0.18, 0.18, 0.4, 16), m.pearl);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(-1.12, -0.45, 2.45);
  cam.add(gear, knob);

  // top handle
  const handle = new Mesh(
    new TubeGeometry(new CatmullRomCurve3([new Vector3(0, 1.0, -1.3), new Vector3(0, 1.62, -1.0), new Vector3(0, 1.66, 0.6), new Vector3(0, 1.0, 1.1)]), 40, 0.09, 10),
    m.satin,
  );
  cam.add(handle);

  // the film magazine: two reels on top
  const mag = new Mesh(new RoundedBoxGeometry(0.62, 0.9, 2.4, 3, 0.12), m.graphite);
  mag.position.set(0, 1.55, -1.55);
  const front = reel(1.0, m);
  front.position.set(0, 2.45, -0.75);
  const back = reel(0.88, m);
  back.position.set(0, 2.25, -2.55);
  cam.add(mag, front, back);

  // viewfinder and eyecup
  const vf = new Mesh(new CylinderGeometry(0.22, 0.24, 1.3, 20), m.graphite);
  vf.rotation.x = Math.PI / 2;
  vf.position.set(-0.85, 0.75, -2.15);
  const cup = new Mesh(new TorusGeometry(0.24, 0.09, 10, 24), m.rubber);
  cup.position.set(-0.85, 0.75, -2.82);
  cam.add(vf, cup);

  // tally light
  const tally = new Mesh(new SphereGeometry(0.09, 16, 12), m.red);
  tally.position.set(0.7, 0.92, 1.72);
  cam.add(tally);

  // contact shadow
  const shadow = new Mesh(new PlaneGeometry(9, 9), shadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.9;
  root.add(shadow);

  cam.position.set(0, 0, -0.6);
  root.rotation.y = -0.85;
  const look = { x: 0, y: 0 };

  return {
    root,
    view: { fov: 26, distance: 17, target: [0, 0.5, 0.2], dir: [0, 0.3, 1] },
    update(t, dt, s) {
      const k = 1 - Math.exp(-dt * 2.5);
      look.x += (s.pointer.x - look.x) * k;
      look.y += (s.pointer.y - look.y) * k;
      root.rotation.y = -0.85 + Math.sin(t * 0.3) * 0.5 + look.x * 0.3;
      cam.rotation.x = look.y * 0.08 + Math.sin(t * 0.6) * 0.02;
      cam.position.y = Math.sin(t * 0.9) * 0.08;
      front.rotation.x = -t * 1.6;
      back.rotation.x = -t * 1.9;
      tally.visible = Math.sin(t * 4) > -0.2;
      return true;
    },
    dispose() {
      screenMat.map?.dispose();
      screenMat.dispose();
    },
  };
}
