// 3D Previz exports: the block-out as GLB, and the camera move as After Effects keyframes.
import { moveById } from '../data/moves';

/** Keyframe data in the format After Effects pastes onto a camera layer. */
export function aeKeyframes(moveId: string, lens: string, seconds: number) {
  const fps = 24;
  const W = 1920;
  const H = 1080;
  const zoom = ((parseInt(lens, 10) || 35) / 36) * W;
  const fx = moveById(moveId)?.fx ?? 'static';
  const frames = Math.round(seconds * fps);
  const D = 2000;
  const rows: Array<[number, number[], number[], number]> = [];
  for (let f = 0; f <= frames; f += 6) {
    const t = f / frames;
    const e = t * t * (3 - 2 * t);
    let pos = [W / 2, H / 2, -D];
    let poi = [W / 2, H / 2, 0];
    let roll = 0;
    switch (fx) {
      case 'in':
        pos = [W / 2, H / 2, -D + 800 * e];
        break;
      case 'out':
        pos = [W / 2, H / 2, -D + 800 * (1 - e)];
        break;
      case 'left':
      case 'right': {
        const dx = (fx === 'left' ? -1 : 1) * 600 * e;
        pos = [W / 2 + dx, H / 2, -D];
        poi = [W / 2 + dx, H / 2, 0];
        break;
      }
      case 'up':
      case 'down': {
        const dy = (fx === 'up' ? -1 : 1) * 500 * e;
        pos = [W / 2, H / 2 + dy, -D];
        poi = [W / 2, H / 2 + dy * 0.4, 0];
        break;
      }
      case 'pan-l':
      case 'pan-r':
        poi = [W / 2 + (fx === 'pan-l' ? -1 : 1) * 900 * e, H / 2, 0];
        break;
      case 'tilt-u':
      case 'tilt-d':
        poi = [W / 2, H / 2 + (fx === 'tilt-u' ? -1 : 1) * 700 * e, 0];
        break;
      case 'orbit-l':
      case 'orbit-r': {
        const a = (fx === 'orbit-l' ? -1 : 1) * (Math.PI / 3) * e;
        pos = [W / 2 + Math.sin(a) * D, H / 2, -Math.cos(a) * D];
        break;
      }
      case 'roll':
        roll = 25 * e;
        break;
      case 'shake':
        pos = [W / 2 + Math.sin(f * 1.7) * 8, H / 2 + Math.cos(f * 2.3) * 6, -D];
        break;
    }
    rows.push([f, pos, poi, roll]);
  }
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
  const block = (title: string, head: string, values: (r: (typeof rows)[number]) => string) =>
    [`Transform\t${title}`, `\tFrame\t${head}\t`, ...rows.map((r) => `\t${r[0]}\t${values(r)}\t`), ''].join('\n');
  const zoomFor = (f: number) => (fx === 'zoom-in' ? zoom * (1 + f / frames) : fx === 'zoom-out' ? zoom * (2 - f / frames) : zoom);
  return [
    'Adobe After Effects 8.0 Keyframe Data',
    '',
    `\tUnits Per Second\t${fps}`,
    `\tSource Width\t${W}`,
    `\tSource Height\t${H}`,
    '\tSource Pixel Aspect Ratio\t1',
    '\tComp Pixel Aspect Ratio\t1',
    '',
    block('Point of Interest', 'X pixels\tY pixels\tZ pixels', (r) => r[2].map(fmt).join('\t')),
    block('Position', 'X pixels\tY pixels\tZ pixels', (r) => r[1].map(fmt).join('\t')),
    block('Z Rotation', 'degrees', (r) => fmt(r[3])),
    ['Camera Options\tZoom', '\tFrame\tpixels\t', ...rows.map((r) => `\t${r[0]}\t${fmt(zoomFor(r[0]))}\t`), ''].join('\n'),
    '',
    'End of Keyframe Data',
  ].join('\n');
}

/** Build the previz set and download it as a GLB. */
export async function exportPreviz(set: string) {
  const { exportSetGLB } = await import('../three/models/previz');
  const blob = await exportSetGLB(set);
  if (!blob) return false;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kinemi-previz-${set.toLowerCase().replace(/\s+/g, '-')}.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
