// The studio's 3D materials, made once and shared by every model: the same pearl shell, graphite
// and Kinemi green as the robot hand on the landing page.
import { CanvasTexture, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace, type Material } from 'three';

function make() {
  return {
    pearl: new MeshPhysicalMaterial({
      color: new Color('#e6ece9'),
      roughness: 0.32,
      metalness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      iridescence: 0.7,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [300, 760],
    }),
    // a brighter pearl for small voxels, which would read grey with the plain shell
    bright: new MeshPhysicalMaterial({
      color: new Color('#f4f8f6'),
      roughness: 0.28,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: new Color('#d9efe4'),
      emissiveIntensity: 0.22,
    }),
    graphite: new MeshStandardMaterial({ color: new Color('#121a22'), roughness: 0.42, metalness: 0.8 }),
    soft: new MeshStandardMaterial({ color: new Color('#1b2631'), roughness: 0.7, metalness: 0.3 }),
    satin: new MeshStandardMaterial({ color: new Color('#8f9ca5'), roughness: 0.28, metalness: 1 }),
    chrome: new MeshStandardMaterial({ color: new Color('#e2e9ec'), roughness: 0.08, metalness: 1 }),
    rubber: new MeshStandardMaterial({ color: new Color('#161b21'), roughness: 0.9, metalness: 0 }),
    green: new MeshStandardMaterial({ color: new Color('#39d879'), emissive: new Color('#39d879'), emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1 }),
    glow: new MeshBasicMaterial({ color: new Color('#5cf09a'), toneMapped: false }),
    teal: new MeshStandardMaterial({ color: new Color('#2ee6c4'), emissive: new Color('#2ee6c4'), emissiveIntensity: 0.5, roughness: 0.3 }),
    seam: new MeshStandardMaterial({ color: new Color('#145a37'), roughness: 0.6, metalness: 0.1 }),
    glass: new MeshPhysicalMaterial({ color: new Color('#071219'), roughness: 0.04, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    gold: new MeshStandardMaterial({ color: new Color('#d8aa52'), roughness: 0.28, metalness: 1 }),
    copper: new MeshStandardMaterial({ color: new Color('#c47a4a'), roughness: 0.3, metalness: 1 }),
    red: new MeshBasicMaterial({ color: new Color('#ff4d4d'), toneMapped: false }),
    pcb: new MeshStandardMaterial({ color: new Color('#0c2a1d'), roughness: 0.55, metalness: 0.2 }),
    block: new MeshStandardMaterial({ color: new Color('#5b6876'), roughness: 0.75, metalness: 0.05 }),
    blockLight: new MeshStandardMaterial({ color: new Color('#8995a1'), roughness: 0.7, metalness: 0.05 }),
    floor: new MeshStandardMaterial({ color: new Color('#0f1822'), roughness: 0.95, metalness: 0 }),
  };
}

let cache: ReturnType<typeof make> | null = null;
export const mats = () => (cache ??= make());

/** A soft round shadow to sit an object on: a plane with a radial gradient. */
let shadowMat: MeshBasicMaterial | null = null;
export function shadowMaterial() {
  if (shadowMat) return shadowMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  shadowMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide });
  return shadowMat;
}

export function disposeMaterial(m: Material | Material[]) {
  for (const x of Array.isArray(m) ? m : [m]) {
    if (Object.values(mats()).includes(x as never) || x === shadowMat) continue;
    (x as MeshBasicMaterial).map?.dispose();
    x.dispose();
  }
}
