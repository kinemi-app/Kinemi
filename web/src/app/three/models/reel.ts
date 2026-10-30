// The asset store's film reel: two flanges with round cut-outs, a pearl hub, wound film, and a
// strip of film running off it with sprocket holes and little green frames.
import {
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Vector3,
  CatmullRomCurve3,
} from 'three';
import { mats, shadowMaterial } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

function flangeGeometry(r: number) {
  const shape = new Shape();
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hole = new Path();
    hole.absarc(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.22, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const centre = new Path();
  centre.absarc(0, 0, r * 0.1, 0, Math.PI * 2, true);
  shape.holes.push(centre);
  return new ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 40 });
}

function filmTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c1116';
  g.fillRect(0, 0, 64, 256);
  const tints = ['#1a8f4d', '#0d5f86', '#2ee6c4', '#39d879'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = tints[i];
    g.globalAlpha = 0.85;
    g.fillRect(12, 6 + i * 64, 40, 52);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#e8eef0';
  for (let i = 0; i < 16; i++) {
    g.fillRect(2, 4 + i * 16, 6, 8);
    g.fillRect(56, 4 + i * 16, 6, 8);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapT = RepeatWrapping;
  return tex;
}

/** A ribbon along a curve: the film leaving the reel. */
function ribbon(curve: CatmullRomCurve3, width: number, segments = 60) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const len = curve.getLength();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    pos.push(p.x, p.y, -width / 2, p.x, p.y, width / 2);
    uv.push(0, (t * len) / width, 1, (t * len) / width);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function create(_opts: ModelOptions): Built {
  const m = mats();
  const root = new Group();
  const reel = new Group();
  root.add(reel);

  const R = 1.7;
  const fg = flangeGeometry(R);
  const front = new Mesh(fg, m.satin);
  front.position.z = 0.34;
  const back = new Mesh(fg, m.satin);
  back.position.z = -0.41;
  const wound = new Mesh(new CylinderGeometry(1.2, 1.2, 0.66, 64), m.soft);
  wound.rotation.x = Math.PI / 2;
  const hub = new Mesh(new CylinderGeometry(0.34, 0.34, 0.86, 32), m.pearl);
  hub.rotation.x = Math.PI / 2;
  const ring = new Mesh(new CylinderGeometry(0.36, 0.36, 0.06, 32), m.green);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.44;
  const spin = new Group();
  spin.add(front, back, wound, hub, ring);
  reel.add(spin);

  const filmMat = new MeshStandardMaterial({ map: filmTexture(), roughness: 0.45, metalness: 0.1, side: DoubleSide });
  const curve = new CatmullRomCurve3([
    new Vector3(1.2, -0.2, 0),
    new Vector3(1.3, -1.0, 0),
    new Vector3(1.9, -1.6, 0),
    new Vector3(3.0, -1.75, 0),
    new Vector3(4.2, -1.5, 0),
  ]);
  const film = new Mesh(ribbon(curve, 0.5), filmMat);
  reel.add(film);

  const shadow = new Mesh(new PlaneGeometry(8, 5), shadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.8, -1.95, 0);
  root.add(shadow);

  reel.rotation.set(0.12, -0.55, 0);
  reel.position.x = -0.7;

  return {
    root,
    view: { fov: 28, distance: 13, target: [0.4, -0.2, 0], dir: [0, 0.18, 1] },
    update(t, dt, s) {
      spin.rotation.z -= dt * (s.hover ? 2.4 : 0.7);
      reel.rotation.y = -0.55 + Math.sin(t * 0.5) * 0.18 + s.pointer.x * 0.12;
      reel.position.y = Math.sin(t * 1.1) * 0.06;
      (filmMat.map as CanvasTexture).offset.y = -t * 0.25;
      return true;
    },
    dispose() {
      filmMat.map?.dispose();
      filmMat.dispose();
    },
  };
}
