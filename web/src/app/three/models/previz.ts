// 3D Previz: a grey block-out set with a stand-in actor, and a little camera flying the chosen move
// along a dashed path. Drag to orbit the view. The set exports as GLB.
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
  Scene,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { moveById, type MoveFx } from '../../data/moves';
import { mats } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

const SUBJECT = new Vector3(0, 1.6, 0);

function box(w: number, h: number, d: number, x: number, z: number, mat: Material, y = 0) {
  const b = new Mesh(new BoxGeometry(w, h, d), mat);
  b.position.set(x, y + h / 2, z);
  return b;
}

/** The set, without helpers: this is what the GLB export contains. */
export function buildSet(set: string) {
  const m = mats();
  const g = new Group();
  g.name = `Kinemi previz · ${set}`;
  const floor = new Mesh(new PlaneGeometry(40, 40), m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'Floor';
  g.add(floor);
  const actor = new Group();
  actor.name = 'Actor';
  const torso = new Mesh(new CapsuleGeometry(0.42, 1.2, 6, 16), m.pearl);
  torso.position.y = 1.05;
  const head = new Mesh(new CapsuleGeometry(0.26, 0.12, 6, 16), m.pearl);
  head.position.y = 2.1;
  const mark = new Mesh(new TorusGeometry(0.7, 0.04, 8, 48), m.green);
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.02;
  actor.add(torso, head, mark);
  g.add(actor);

  if (set === 'Desert motel') {
    g.add(box(10, 2.6, 2.4, 4, -6, m.block));
    g.add(box(10.4, 0.3, 3.2, 4, -6, m.blockLight, 2.6));
    for (let i = 0; i < 5; i++) g.add(box(0.9, 1.6, 0.1, 0.4 + i * 1.8, -4.75, m.blockLight));
    g.add(box(0.2, 5.5, 0.2, -3.5, -3.5, m.blockLight));
    const sign = box(2.4, 1.0, 0.2, -3.5, -3.5, m.green, 5.5);
    g.add(sign);
    for (const [x, z, s] of [
      [-14, -16, 4],
      [10, -18, 5],
      [-2, -20, 3],
    ] as const) {
      const mesa = new Mesh(new CylinderGeometry(s * 0.8, s * 1.2, s, 6), m.block);
      mesa.position.set(x, s / 2, z);
      g.add(mesa);
    }
    g.add(box(4, 0.02, 40, -1, 0, m.soft));
  } else if (set === 'Interior') {
    g.add(box(12, 4, 0.3, 0, -5, m.block));
    g.add(box(0.3, 4, 10, -6, 0, m.blockLight));
    g.add(box(0.3, 4, 10, 6, 0, m.block));
    const win = new Mesh(new PlaneGeometry(3, 2), m.glow);
    win.position.set(2, 2.4, -4.8);
    g.add(win);
    g.add(box(2.4, 0.9, 1.2, -2.5, -2.4, m.blockLight));
    g.add(box(0.8, 0.9, 0.8, -4.2, -2.4, m.block));
    const lamp = new Mesh(new ConeGeometry(0.4, 0.5, 16), m.green);
    lamp.position.set(-2.5, 1.6, -2.4);
    g.add(lamp);
  } else if (set === 'Rooftop') {
    g.add(box(16, 0.4, 16, 0, 0, m.block, -0.4));
    const tank = new Mesh(new CylinderGeometry(1.2, 1.2, 2.4, 20), m.blockLight);
    tank.position.set(-4, 2.6, -4);
    g.add(tank, box(0.2, 1.4, 0.2, -4.6, -4.6, m.block), box(0.2, 1.4, 0.2, -3.4, -3.4, m.block));
    g.add(box(1.6, 1, 1.2, 3.5, -3, m.block), box(1.6, 1, 1.2, 5.4, -3, m.block));
    for (let i = 0; i < 9; i++) g.add(box(2.4, 4 + ((i * 7) % 9), 2.4, -12 + i * 3, -16, i % 2 ? m.block : m.blockLight, -6));
  } else {
    // neon street: two rows of buildings and signs
    for (let i = 0; i < 6; i++) {
      const h = 4 + ((i * 5) % 7);
      g.add(box(3, h, 3.4, -5.5, -14 + i * 3.6, i % 2 ? m.block : m.blockLight));
      g.add(box(3, h + 1, 3.4, 5.5, -13 + i * 3.6, i % 2 ? m.blockLight : m.block));
    }
    g.add(box(0.2, 2.6, 1.0, -3.9, -6, m.green, 2.4));
    g.add(box(0.2, 2.2, 1.0, 3.9, -2, m.teal, 2.8));
    g.add(box(6, 0.02, 40, 0, 0, m.soft));
  }
  return g;
}

function camRig() {
  const m = mats();
  const rig = new Group();
  const body = new Mesh(new RoundedBoxGeometry(0.7, 0.55, 1.0, 2, 0.08), m.pearl);
  // the lens faces +z, the way Object3D.lookAt turns an object
  const lens = new Mesh(new CylinderGeometry(0.2, 0.22, 0.5, 20), m.graphite);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.7;
  const tally = new Mesh(new BoxGeometry(0.12, 0.12, 0.12), m.glow);
  tally.position.set(0.22, 0.32, 0.3);
  rig.add(body, lens, tally);
  const f = 4;
  const w = 1.4;
  const h = 0.8;
  const pts = [0, 0, 0, -w, -h, f, 0, 0, 0, w, -h, f, 0, 0, 0, -w, h, f, 0, 0, 0, w, h, f, -w, -h, f, w, -h, f, w, -h, f, w, h, f, w, h, f, -w, h, f, -w, h, f, -w, -h, f];
  const fg = new BufferGeometry();
  fg.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const frustum = new LineSegments(fg, new LineBasicMaterial({ color: 0x39d879, transparent: true, opacity: 0.8 }));
  frustum.position.z = 0.9;
  rig.add(frustum);
  return { rig, frustum };
}

/** Where the camera is and what it looks at, t from 0 to 1. */
function pose(fx: MoveFx, t: number, out: { pos: Vector3; look: Vector3; roll: number }) {
  const e = t * t * (3 - 2 * t);
  out.roll = 0;
  out.look.copy(SUBJECT);
  switch (fx) {
    case 'in':
    case 'zoom-in':
      out.pos.set(0, 1.8, 10 - 6 * e);
      break;
    case 'out':
    case 'zoom-out':
      out.pos.set(0, 1.8, 4 + 6 * e);
      break;
    case 'left':
    case 'right': {
      const x = (fx === 'left' ? 4 : -4) * (1 - 2 * e);
      out.pos.set(x, 1.8, 7);
      out.look.set(x * 0.6, 1.6, 0);
      break;
    }
    case 'up':
    case 'down': {
      const y = fx === 'up' ? 1 + 6 * e : 7 - 6 * e;
      out.pos.set(0, y, 7);
      break;
    }
    case 'pan-l':
    case 'pan-r':
      out.pos.set(0, 1.8, 8);
      out.look.set((fx === 'pan-l' ? 1 : -1) * (5 - 10 * e), 1.6, 0);
      break;
    case 'tilt-u':
    case 'tilt-d':
      out.pos.set(0, 1.4, 7);
      out.look.set(0, fx === 'tilt-u' ? 0 + 5 * e : 5 - 5 * e, 0);
      break;
    case 'orbit-l':
    case 'orbit-r': {
      const a = (fx === 'orbit-r' ? 1 : -1) * (-1.1 + 2.2 * e);
      out.pos.set(Math.sin(a) * 7, 2.2, Math.cos(a) * 7);
      break;
    }
    case 'roll':
      out.pos.set(0, 2, 8);
      out.roll = (e - 0.5) * 0.8;
      break;
    case 'shake':
      out.pos.set(Math.sin(t * 60) * 0.08, 1.8 + Math.cos(t * 47) * 0.06, 7);
      break;
    default:
      out.pos.set(0, 1.8, 8);
  }
}

function pathLine(fx: MoveFx) {
  const pts: number[] = [];
  const o = { pos: new Vector3(), look: new Vector3(), roll: 0 };
  for (let i = 0; i <= 48; i++) {
    pose(fx, i / 48, o);
    pts.push(o.pos.x, o.pos.y, o.pos.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const line = new Line(g, new LineDashedMaterial({ color: 0x39d879, dashSize: 0.3, gapSize: 0.18 }));
  line.computeLineDistances();
  return line;
}

export function create(opts: ModelOptions): Built {
  const root = new Group();
  let setName = opts.set ?? 'Neon street';
  let fx: MoveFx = moveById(opts.move ?? 'orbit-right')?.fx ?? 'orbit-r';
  let set = buildSet(setName);
  const grid = new GridHelper(40, 20, 0x1a8f4d, 0x1a324c);
  (grid.material as Material).transparent = true;
  (grid.material as Material).opacity = 0.35;
  grid.position.y = 0.01;
  const { rig, frustum } = camRig();
  let path = pathLine(fx);
  root.add(set, grid, rig, path);

  const lensScale = (lens?: string) => 35 / Math.max(14, parseInt(lens ?? '35', 10) || 35);
  frustum.scale.set(lensScale(opts.lens), lensScale(opts.lens), 1);

  // looking down the street from behind the action, a little to the side
  const view = { yaw: 0.32, pitch: 0.48, dist: 25, dragging: false };
  const o = { pos: new Vector3(), look: new Vector3(), roll: 0 };
  let phase = 0;

  return {
    root,
    view: { fov: 34, distance: 25, target: [0, 1.5, 0] },
    setOptions(next) {
      if (next.set && next.set !== setName) {
        root.remove(set);
        set.traverse((x) => (x as Mesh).geometry?.dispose());
        setName = next.set;
        set = buildSet(setName);
        root.add(set);
      }
      const nfx = moveById(next.move ?? '')?.fx;
      if (nfx && nfx !== fx) {
        fx = nfx;
        root.remove(path);
        path.geometry.dispose();
        path = pathLine(fx);
        root.add(path);
      }
      frustum.scale.set(lensScale(next.lens), lensScale(next.lens), 1);
    },
    bind(el, _s, redraw) {
      let lx = 0;
      let ly = 0;
      const down = (e: PointerEvent) => {
        view.dragging = true;
        lx = e.clientX;
        ly = e.clientY;
        el.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!view.dragging) return;
        view.yaw -= (e.clientX - lx) * 0.008;
        view.pitch = Math.max(0.05, Math.min(1.3, view.pitch + (e.clientY - ly) * 0.006));
        lx = e.clientX;
        ly = e.clientY;
        redraw();
      };
      const up = () => (view.dragging = false);
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        view.dist = Math.max(12, Math.min(44, view.dist + e.deltaY * 0.02));
        redraw();
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('wheel', wheel, { passive: false });
      return () => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('wheel', wheel);
      };
    },
    update(_t, dt, s) {
      // the camera flies the move, back and forth
      phase = (phase + dt / 3.2) % 2;
      pose(fx, phase < 1 ? phase : 2 - phase, o);
      rig.position.copy(o.pos);
      rig.lookAt(o.look);
      rig.rotateZ(o.roll);
      // the viewer's orbit
      const cam = s.camera;
      const fit = s.w / s.h < 1 ? (s.h / s.w) * 1.1 : 1;
      cam.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist * fit, 1.5 + Math.sin(view.pitch) * view.dist * fit, Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist * fit);
      cam.lookAt(0, 1.5, -1);
      return true;
    },
    dispose() {
      path.geometry.dispose();
      (path.material as Material).dispose();
      (frustum.material as Material).dispose();
      frustum.geometry.dispose();
      grid.dispose();
    },
  };
}

/** The set as a binary GLB, for Blender or After Effects. */
export async function exportSetGLB(set: string): Promise<Blob | null> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const scene = new Scene();
  scene.add(buildSet(set));
  const { rig } = camRig();
  rig.name = 'Camera';
  rig.position.set(0, 1.8, 8);
  rig.lookAt(SUBJECT);
  scene.add(rig);
  const data = await new GLTFExporter().parseAsync(scene, { binary: true });
  return data instanceof ArrayBuffer ? new Blob([data], { type: 'model/gltf-binary' }) : null;
}
