// One WebGL renderer for every 3D slot in the studio. Each slot keeps its own scene and a 2D canvas
// in the page; the renderer draws the slot off-screen and copies the pixels across. Browsers cap
// WebGL contexts, so twenty slots cost one context, and every slot still layers like normal DOM.
import {
  BackSide,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import type { ModelName, ModelOptions } from './types';
import { reducedMotion } from '../lib/util';
import { disposeMaterial } from './materials';

export interface SlotState {
  /** pointer relative to the slot centre, about -1..1 */
  pointer: { x: number; y: number };
  /** pointer is over the slot itself */
  hover: boolean;
  opts: ModelOptions;
  reduced: boolean;
  w: number;
  h: number;
  camera: PerspectiveCamera;
}

export interface Built {
  root: Object3D;
  /** camera: field of view, distance and where it looks */
  view: { fov: number; distance: number; target?: [number, number, number]; dir?: [number, number, number] };
  /** advance the animation; return true to keep getting frames */
  update(t: number, dt: number, s: SlotState): boolean;
  setOptions?(o: ModelOptions, s: SlotState): void;
  /** the model handles its own pointer drags (previz) */
  bind?(el: HTMLElement, s: SlotState, redraw: () => void): () => void;
  dispose?(): void;
}

type Factory = (opts: ModelOptions) => Built | Promise<Built>;

const FACTORIES: Record<ModelName, () => Promise<{ create: Factory }>> = {
  orb: () => import('./models/orb'),
  camera: () => import('./models/camera'),
  voxel: () => import('./models/voxel'),
  gpu: () => import('./models/gpu'),
  clapper: () => import('./models/clapper'),
  reel: () => import('./models/reel'),
  previz: () => import('./models/previz'),
};

interface Slot {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scene: Scene;
  built: Built;
  state: SlotState;
  visible: boolean;
  dirty: boolean;
  dpr: number;
  ready?: () => void;
  unbind?: () => void;
}

let renderer: WebGLRenderer | null = null;
let env: Texture | null = null;
const slots = new Set<Slot>();
let raf = 0;
let last = 0;
// the device's reduce-motion setting, or Settings → Interface → Motion
const reduced = reducedMotion();

function studioEnvironment(r: WebGLRenderer): Texture {
  const scene = new Scene();
  scene.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: new Color('#020407'), side: BackSide })));
  const panel = (w: number, h: number, color: string, k: number, pos: [number, number, number]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k), side: DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(12, 10, '#ffffff', 1.5, [0, 10, 0]);
  panel(1.6, 11, '#ffffff', 4.2, [-6, 2, 8]);
  panel(1, 8, '#ffffff', 2.2, [6, 3, 8]);
  panel(2.2, 12, '#39d879', 6, [8, 1, -4]);
  panel(2.2, 10, '#2ee6c4', 3.6, [-8, 0, -5]);
  panel(14, 4, '#0d5f86', 1.3, [0, -8, 2]);
  const pmrem = new PMREMGenerator(r);
  const tex = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });
  return tex;
}

function getRenderer() {
  if (renderer) return renderer;
  renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setScissorTest(true);
  env = studioEnvironment(renderer);
  return renderer;
}

function lights(scene: Scene) {
  const key = new DirectionalLight(0xffffff, 1.5);
  key.position.set(-3, 5, 6);
  const rim = new DirectionalLight(new Color('#39d879'), 2.2);
  rim.position.set(5, 2, -4);
  const fill = new DirectionalLight(new Color('#2ee6c4'), 0.6);
  fill.position.set(-5, -2, 2);
  scene.add(key, rim, fill);
}

const tmp = new Vector3();

function placeCamera(slot: Slot) {
  const { view } = slot.built;
  const cam = slot.state.camera;
  cam.fov = view.fov;
  cam.aspect = Math.max(0.1, slot.state.w / Math.max(1, slot.state.h));
  // keep the model inside narrow slots: back the camera off when the slot is taller than wide
  const fit = cam.aspect < 1 ? 1 / cam.aspect : 1;
  const dir = tmp.set(...(view.dir ?? [0, 0.18, 1])).normalize();
  const target = view.target ?? [0, 0, 0];
  cam.position.set(target[0] + dir.x * view.distance * fit, target[1] + dir.y * view.distance * fit, target[2] + dir.z * view.distance * fit);
  cam.lookAt(target[0], target[1], target[2]);
  cam.updateProjectionMatrix();
}

function draw(slot: Slot) {
  const r = getRenderer();
  const W = slot.canvas.width;
  const H = slot.canvas.height;
  if (!W || !H) return;
  const gl = r.domElement;
  if (gl.width < W || gl.height < H) r.setSize(Math.max(W, gl.width), Math.max(H, gl.height), false);
  const top = gl.height - H;
  r.setViewport(0, 0, W, H);
  r.setScissor(0, 0, W, H);
  r.clear();
  r.render(slot.scene, slot.state.camera);
  slot.ctx.clearRect(0, 0, W, H);
  slot.ctx.drawImage(gl, 0, top, W, H, 0, 0, W, H);
  if (slot.ready) {
    slot.ready();
    slot.ready = undefined;
  }
}

let lastDraw = 0;

function frame(now: number) {
  raf = 0;
  // idle loops run at 30 fps; anything under the pointer gets every frame
  const busy = [...slots].some((s) => s.visible && (s.state.hover || s.dirty));
  if (!busy && now - lastDraw < 30) {
    raf = requestAnimationFrame(frame);
    return;
  }
  lastDraw = now;
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  const t = now / 1000;
  let again = false;
  for (const slot of slots) {
    if (!slot.visible) continue;
    const moving = !reduced && slot.built.update(t, dt, slot.state);
    if (moving || slot.dirty) {
      draw(slot);
      slot.dirty = false;
    }
    if (moving) again = true;
  }
  if (again && !document.hidden) raf = requestAnimationFrame(frame);
}

function kick() {
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

document.addEventListener('visibilitychange', () => !document.hidden && kick());

let pointerBound = false;
function bindPointer() {
  if (pointerBound) return;
  pointerBound = true;
  window.addEventListener(
    'pointermove',
    (e) => {
      for (const slot of slots) {
        const r = slot.el.getBoundingClientRect();
        slot.state.pointer.x = Math.max(-1.5, Math.min(1.5, (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)));
        slot.state.pointer.y = Math.max(-1.5, Math.min(1.5, (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2)));
      }
      kick();
    },
    { passive: true },
  );
}

export function mountModel(el: HTMLElement, name: ModelName, opts: ModelOptions, onReady: () => void) {
  let slot: Slot | null = null;
  let disposed = false;
  let ro: ResizeObserver | null = null;
  let io: IntersectionObserver | null = null;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d')!;

  FACTORIES[name]()
    .then((m) => m.create(opts))
    .then((built) => {
      if (disposed) {
        built.dispose?.();
        return;
      }
      getRenderer();
      const scene = new Scene();
      scene.environment = env;
      lights(scene);
      scene.add(built.root);
      const state: SlotState = { pointer: { x: 0, y: 0 }, hover: false, opts, reduced, w: 1, h: 1, camera: new PerspectiveCamera(30, 1, 0.1, 200) };
      slot = { el, canvas, ctx, scene, built, state, visible: true, dirty: true, dpr: 1, ready: onReady };
      el.appendChild(canvas);
      slots.add(slot);

      const size = () => {
        if (!slot) return;
        const r = el.getBoundingClientRect();
        slot.dpr = Math.min(2, window.devicePixelRatio || 1);
        slot.state.w = Math.max(1, r.width);
        slot.state.h = Math.max(1, r.height);
        canvas.width = Math.round(slot.state.w * slot.dpr);
        canvas.height = Math.round(slot.state.h * slot.dpr);
        placeCamera(slot);
        slot.dirty = true;
        kick();
      };
      ro = new ResizeObserver(size);
      ro.observe(el);
      size();
      io = new IntersectionObserver(([e]) => {
        if (!slot) return;
        slot.visible = e.isIntersecting;
        if (slot.visible) {
          slot.dirty = true;
          kick();
        }
      });
      io.observe(el);
      el.addEventListener('pointerenter', onEnter);
      el.addEventListener('pointerleave', onLeave);
      if (built.bind) slot.unbind = built.bind(el, state, () => {
        if (slot) slot.dirty = true;
        kick();
      });
      bindPointer();
      kick();
    })
    .catch(() => {});

  function onEnter() {
    if (slot) {
      slot.state.hover = true;
      kick();
    }
  }
  function onLeave() {
    if (slot) {
      slot.state.hover = false;
      kick();
    }
  }

  return {
    update(o: ModelOptions) {
      opts = o;
      if (!slot) return;
      slot.state.opts = o;
      slot.built.setOptions?.(o, slot.state);
      slot.dirty = true;
      kick();
    },
    dispose() {
      disposed = true;
      ro?.disconnect();
      io?.disconnect();
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      if (!slot) return;
      slot.unbind?.();
      slots.delete(slot);
      slot.built.dispose?.();
      slot.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          if (!m.userData.shared) m.geometry.dispose();
          disposeMaterial(m.material);
        }
      });
      canvas.remove();
      slot = null;
    },
  };
}
