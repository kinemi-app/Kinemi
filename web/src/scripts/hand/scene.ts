// Renders the robot hand: studio lighting in Kinemi colours, intro, idle motion and cursor follow.
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
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
import { applyPose, buildHand, disposeHand, mixPose, POSES, type HandRig } from './model';

export interface Tips {
  /** fingertip positions, 0..1 of the canvas box */
  index: [number, number];
  thumb: [number, number];
}

export interface HandOptions {
  /** play the rise-and-open intro */
  intro?: boolean;
  /** device pixel ratio cap */
  maxDpr?: number;
  /** called every frame with fingertip positions */
  onTips?: (tips: Tips) => void;
  /** called once the first frame has been drawn */
  onReady?: () => void;
  /** keep the drawing buffer so the canvas can be read back (poster rendering) */
  preserve?: boolean;
  toneMapping?: 'aces' | 'agx' | 'neutral';
  exposure?: number;
}

/** Fixed framing shared by the live canvas and the pre-rendered poster. */
export const STAGE = {
  aspect: 4 / 5,
  fov: 24,
  camera: new Vector3(0.35, 0.95, 9.4),
  target: new Vector3(-0.32, 0.72, 0),
  rotation: { x: 0.11, y: -0.2, z: 0.19 },
  position: { x: 0.15, y: -0.05, z: 0 },
};

function studioEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  scene.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: new Color('#020407'), side: BackSide })));
  const panel = (w: number, h: number, color: string, intensity: number, pos: [number, number, number]) => {
    const m = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(12, 10, '#ffffff', 1.6, [0, 10, 0]); // overhead softbox: shapes the form
  panel(1.6, 11, '#ffffff', 4.5, [-6, 2, 8]); // key strip, front left
  panel(1, 8, '#ffffff', 2.4, [6, 3, 8]); // second strip, front right
  panel(2.2, 12, '#39d879', 6.5, [8, 1, -4]); // green rim, right
  panel(2.2, 10, '#2ee6c4', 4, [-8, 0, -5]); // teal rim, left
  panel(14, 4, '#0d5f86', 1.4, [0, -8, 2]); // sea-blue floor bounce
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  });
  return env;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export function mountHand(host: HTMLElement, opts: HandOptions = {}) {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: !!opts.preserve,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = { aces: ACESFilmicToneMapping, agx: AgXToneMapping, neutral: NeutralToneMapping }[opts.toneMapping ?? 'neutral'];
  renderer.toneMappingExposure = opts.exposure ?? 1;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new Scene();
  scene.environment = studioEnvironment(renderer);

  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new DirectionalLight(new Color('#39d879'), 2.4);
  rim.position.set(5, 2, -4);
  scene.add(rim);

  const camera = new PerspectiveCamera(STAGE.fov, STAGE.aspect, 0.1, 60);
  camera.position.copy(STAGE.camera);
  camera.lookAt(STAGE.target);

  const rig: HandRig = buildHand();
  scene.add(rig.root);

  const base = STAGE.rotation;
  const state = {
    t0: performance.now(),
    pointer: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    visible: true,
    raf: 0,
    intro: opts.intro !== false,
    ready: false,
  };

  const tmp = new Vector3();
  const project = (o: { getWorldPosition: (v: Vector3) => Vector3 }): [number, number] => {
    o.getWorldPosition(tmp);
    tmp.project(camera);
    return [(tmp.x + 1) / 2, (1 - tmp.y) / 2];
  };

  const getTips = (): Tips => ({ index: project(rig.fingers.index.tip), thumb: project(rig.fingers.thumb.tip) });

  /** Place the hand for time t (seconds since mount). */
  const pose = (t: number, idle = true) => {
    const rise = state.intro ? easeOutCubic(clamp01(t / 1.5)) : 1;
    const open = state.intro ? easeOutBack(clamp01((t - 0.75) / 1.1)) : 1;
    const curl = state.intro ? clamp01(t / 0.9) : 1;
    const p = open > 0 ? mixPose(mixPose(POSES.fist, POSES.rest, curl), POSES.frame, open) : mixPose(POSES.fist, POSES.rest, curl);
    applyPose(rig, p);

    const s = idle ? 1 : 0;
    const sway = Math.sin(t * 0.7) * 0.018 * s;
    const bob = Math.sin(t * 0.9) * 0.025 * s;
    rig.root.rotation.set(
      base.x + Math.sin(t * 0.5) * 0.015 * s + state.look.y * 0.16,
      base.y + state.look.x * 0.32,
      base.z + sway + (1 - rise) * 0.35,
    );
    rig.root.position.set(STAGE.position.x, STAGE.position.y + bob - (1 - rise) * 2.6, STAGE.position.z);
    // a breath of life in the index finger
    rig.fingers.index.joints[1].rotation.x -= Math.sin(t * 1.3) * 0.02 * s;
  };

  const resize = () => {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  let last = performance.now();
  const frame = (now: number) => {
    state.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 3.2);
    state.look.x += (state.pointer.x - state.look.x) * k;
    state.look.y += (state.pointer.y - state.look.y) * k;
    pose((now - state.t0) / 1000);
    renderer.render(scene, camera);
    opts.onTips?.(getTips());
    if (!state.ready) {
      state.ready = true;
      opts.onReady?.();
    }
  };

  const start = () => {
    if (!state.raf && state.visible && !document.hidden) {
      last = performance.now();
      state.raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  };

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const io = new IntersectionObserver(([e]) => {
    state.visible = e.isIntersecting;
    if (state.visible) start();
    else stop();
  });
  io.observe(host);

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  const onPointer = (e: PointerEvent) => {
    state.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  return {
    canvas,
    start,
    stop,
    getTips,
    /** Draw the finished pose at an exact size (used for the poster). */
    renderStill(width: number, height: number) {
      stop();
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      state.intro = false;
      state.look.x = state.look.y = 0;
      pose(0, false);
      renderer.render(scene, camera);
      return getTips();
    },
    rig,
    scene,
    dispose() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      disposeHand(rig);
      scene.environment?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export type HandControls = ReturnType<typeof mountHand>;
