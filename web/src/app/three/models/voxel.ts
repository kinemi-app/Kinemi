// A tool's 9 x 9 pixel icon as voxels: pearl cubes, Kinemi-green accents pushed forward.
// At rest it sits at a three-quarter angle; on hover the voxels breathe apart and it turns.
import { Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ICONS, type IconName } from '../../../lib/pixel-icons';
import { mats } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

let cube: RoundedBoxGeometry | null = null;
const geo = () => (cube ??= new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.12));

const PALETTE: Record<string, string> = { '1': '#39d879', '2': '#2ee6c4', '3': '#f2f7f4', '4': '#0d5f86', '5': '#145a37' };
let paletteMat: MeshStandardMaterial | null = null;

interface Cell {
  x: number;
  y: number;
  z: number;
  /** a per-voxel phase for the breathing */
  r: number;
}

export function create(opts: ModelOptions): Built {
  const root = new Group();
  const pivot = new Group();
  root.add(pivot);
  const m = mats();
  paletteMat ??= new MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });

  let layers: Array<{ mesh: InstancedMesh; cells: Cell[] }> = [];

  const build = (name: IconName) => {
    for (const l of layers) {
      pivot.remove(l.mesh);
      l.mesh.dispose();
    }
    layers = [];
    const grid = ICONS[name] ?? ICONS.cinematic;
    const by: Record<string, Cell[]> = { main: [], accent: [], palette: [] };
    const colors: string[] = [];
    grid.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '.' || x > 8) return;
        const cell = { x: x - 4, y: 4 - y, z: 0, r: Math.sin(x * 12.9898 + y * 78.233) * 0.5 + 0.5 };
        if (c === '#') by.main.push(cell);
        else if (c === '+') by.accent.push({ ...cell, z: 0.45 });
        else {
          by.palette.push({ ...cell, z: 0.3 });
          colors.push(PALETTE[c] ?? '#39d879');
        }
      }),
    );
    const add = (cells: Cell[], material: MeshStandardMaterial, tint?: string[]) => {
      if (!cells.length) return;
      const mesh = new InstancedMesh(geo(), material, cells.length);
      mesh.userData.shared = true;
      if (tint) cells.forEach((_, i) => mesh.setColorAt(i, new Color(tint[i])));
      pivot.add(mesh);
      layers.push({ mesh, cells });
    };
    add(by.main, m.bright as unknown as MeshStandardMaterial);
    add(by.accent, m.green);
    add(by.palette, paletteMat!, colors);
    place(0, 0);
  };

  const mat = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3(1, 1, 1);
  const p = new Vector3();
  const place = (spread: number, t: number) => {
    for (const { mesh, cells } of layers) {
      cells.forEach((c, i) => {
        const wave = spread * (0.5 + 0.5 * Math.sin(t * 3 + c.r * 6.28));
        p.set(c.x * (1 + spread * 0.08), c.y * (1 + spread * 0.08), c.z + wave * 1.2);
        mat.compose(p, q, s);
        mesh.setMatrixAt(i, mat);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  build(opts.icon ?? 'cinematic');
  let icon = opts.icon;
  let active = !!opts.active;
  let spin = !!opts.spin;
  let spread = 0;
  const rest = { x: 0.32, y: -0.48 };
  pivot.rotation.set(rest.x, rest.y, 0);

  return {
    root,
    view: { fov: 26, distance: 25, dir: [0, 0.05, 1] },
    setOptions(o) {
      if (o.icon && o.icon !== icon) {
        icon = o.icon;
        build(o.icon);
      }
      active = !!o.active;
      spin = !!o.spin;
    },
    update(t, dt, st) {
      const k = 1 - Math.exp(-dt * 6);
      const hot = active || st.hover;
      const target = hot ? 0.28 : 0;
      spread += (target - spread) * k;
      const yaw = spin ? rest.y + Math.sin(t * 0.8) * 0.45 : hot ? rest.y + Math.sin(t * 1.4) * 0.55 : rest.y + st.pointer.x * 0.08;
      const pitch = rest.x + (hot ? Math.cos(t * 1.1) * 0.12 : st.pointer.y * 0.06);
      pivot.rotation.y += (yaw - pivot.rotation.y) * k;
      pivot.rotation.x += (pitch - pivot.rotation.x) * k;
      place(spread, t);
      return hot || spin || spread > 0.002 || Math.abs(yaw - pivot.rotation.y) > 0.002;
    },
    dispose() {
      for (const l of layers) l.mesh.dispose();
    },
  };
}
