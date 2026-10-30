// The clapperboard of the render queue. The slate is lettered in the Kinemi pixel alphabet;
// every new render snaps the sticks shut.
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { layout } from '../../../lib/pixel-font';
import { mats, shadowMaterial } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

function pixelText(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string) {
  const { cells } = layout(text);
  g.fillStyle = color;
  for (const c of cells) g.fillRect(x + c.x * px, y + c.y * px, px - 0.5, px - 0.5);
}

function slateTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 360;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1219';
  g.fillRect(0, 0, 512, 360);
  g.strokeStyle = 'rgba(242,247,244,0.55)';
  g.lineWidth = 3;
  g.strokeRect(14, 14, 484, 332);
  for (const y of [120, 200, 280]) {
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(498, y);
    g.stroke();
  }
  for (const x of [176, 340]) {
    g.beginPath();
    g.moveTo(x, 120);
    g.lineTo(x, 200);
    g.stroke();
  }
  pixelText(g, 'KINEMI', 34, 34, 8, '#f2f7f4');
  g.fillStyle = '#39d879';
  for (let r = 0; r < 3; r++) for (let j = 0; j < 2; j++) g.fillRect(400 + (r + j) * 14, 34 + r * 14, 13, 13);
  pixelText(g, 'SCENE', 30, 132, 3, '#a7b4c0');
  pixelText(g, '01', 30, 160, 4, '#f2f7f4');
  pixelText(g, 'TAKE', 194, 132, 3, '#a7b4c0');
  pixelText(g, '03', 194, 160, 4, '#f2f7f4');
  pixelText(g, 'ROLL', 358, 132, 3, '#a7b4c0');
  pixelText(g, 'A', 358, 160, 4, '#39d879');
  pixelText(g, 'DIR. YOU', 30, 224, 4, '#f2f7f4');
  pixelText(g, 'A-CAM 35MM F/1.8', 30, 304, 3, '#a7b4c0');
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stripeTexture(phase: number) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1219';
  g.fillRect(0, 0, 512, 64);
  for (let i = -2; i < 12; i++) {
    g.fillStyle = i % 4 === 1 ? '#39d879' : '#f2f7f4';
    g.beginPath();
    const x = i * 56 + phase;
    g.moveTo(x, 64);
    g.lineTo(x + 28, 64);
    g.lineTo(x + 56, 0);
    g.lineTo(x + 28, 0);
    g.closePath();
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function create(opts: ModelOptions): Built {
  const m = mats();
  const root = new Group();
  const board = new Group();
  root.add(board);

  const slateMat = new MeshStandardMaterial({ map: slateTexture(), roughness: 0.85, metalness: 0 });
  const slate = new Mesh(new BoxGeometry(3.2, 2.3, 0.1), [m.graphite, m.graphite, m.graphite, m.graphite, slateMat, m.graphite]);
  board.add(slate);

  const stickGeo = new BoxGeometry(3.25, 0.36, 0.12);
  const lowMat = new MeshStandardMaterial({ map: stripeTexture(0), roughness: 0.6 });
  const highMat = new MeshStandardMaterial({ map: stripeTexture(28), roughness: 0.6 });
  const low = new Mesh(stickGeo, [m.graphite, m.graphite, m.graphite, m.graphite, lowMat, m.graphite]);
  low.position.set(0, 1.35, 0);
  board.add(low);

  // the top stick turns on a hinge at its left end
  const hinge = new Group();
  hinge.position.set(-1.62, 1.55, 0);
  const high = new Mesh(stickGeo, [m.graphite, m.graphite, m.graphite, m.graphite, highMat, m.graphite]);
  high.position.set(1.62, 0.2, 0);
  hinge.add(high);
  const pin = new Mesh(new CylinderGeometry(0.09, 0.09, 0.2, 16), m.chrome);
  pin.rotation.x = Math.PI / 2;
  pin.position.set(-1.6, 1.55, 0.05);
  board.add(hinge, pin);

  const shadow = new Mesh(new PlaneGeometry(6, 6), shadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.7;
  root.add(shadow);

  board.rotation.set(-0.12, 0.38, 0.04);
  let clap = opts.clap ?? 0;
  let since = 99;
  const OPEN = 0.5;

  return {
    root,
    view: { fov: 28, distance: 10.5, target: [0, 0.2, 0], dir: [0, 0.15, 1] },
    setOptions(o) {
      if ((o.clap ?? 0) !== clap) {
        if ((o.clap ?? 0) > clap) since = 0;
        clap = o.clap ?? 0;
      }
    },
    update(t, dt, s) {
      since += dt;
      // open in 0.25 s, hold, snap shut in 0.08 s, then a little bounce
      let a = 0;
      if (since < 0.25) a = OPEN * (1 - (1 - since / 0.25) ** 3);
      else if (since < 0.4) a = OPEN;
      else if (since < 0.48) a = OPEN * (1 - ((since - 0.4) / 0.08) ** 2);
      else if (since < 0.7) a = Math.sin(((since - 0.48) / 0.22) * Math.PI) * 0.06;
      else a = s.hover ? 0.18 + Math.sin(t * 3) * 0.04 : 0;
      hinge.rotation.z = a;
      const hit = since > 0.48 && since < 0.62 ? 1 - (since - 0.48) / 0.14 : 0;
      board.position.y = Math.sin(t * 1.2) * 0.08 - hit * 0.08;
      board.rotation.y = 0.38 + Math.sin(t * 0.5) * 0.12 + s.pointer.x * 0.15;
      return true;
    },
    dispose() {
      for (const mt of [slateMat, lowMat, highMat]) {
        mt.map?.dispose();
        mt.dispose();
      }
    },
  };
}
