// Placeholder posters: deterministic pixel art for every render, until the Comfy bridge returns real frames.
// Each scene is a little shader over normalised coordinates, so a poster can be drawn at any
// pixel count and scaled up by a whole number: the pixels stay square and crisp at every size.
import { basePalette } from './scenes';
import { rng } from './util';

type RGB = [number, number, number];

export interface PosterSpec {
  scene: string;
  seed: number;
  palette?: string[];
  panels?: number;
}

const rgb = (h: string): RGB => {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const P = (...hex: string[]) => hex.map(rgb);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const frac = (t: number) => t - Math.floor(t);

/** Ordered-dither between neighbouring colours of a ramp: the banded skies of pixel art. */
function ramp(cols: RGB[], t: number, x: number, y: number): RGB {
  const s = clamp01(t) * (cols.length - 1);
  const i = Math.floor(s);
  return s - i > bayer(x, y) ? cols[Math.min(i + 1, cols.length - 1)] : cols[i];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a: RGB, b: RGB, k: number): RGB => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

function h1(n: number, seed: number) {
  let x = Math.imul((n | 0) ^ seed, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x165667b1);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
const h2 = (x: number, y: number, seed: number) => h1(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663), seed);

function noise1(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return h1(i, seed) * (1 - u) + h1(i + 1, seed) * u;
}

function fbm(x: number, seed: number, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise1(x * f, seed + i * 101);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

/** Inside an axis-aligned ellipse, 0 at the centre, 1 on the edge. */
const ell = (u: number, v: number, cx: number, cy: number, rx: number, ry: number) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2;

type Shader = (u: number, v: number, x: number, y: number) => RGB;
type Scene = (seed: number, aspect: number, palette?: RGB[]) => Shader;

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

const neon: Scene = (seed, aspect) => {
  const r = rng(seed);
  const horizon = 0.6 + (r() - 0.5) * 0.05;
  const pink = r() < 0.45;
  const glow = pink ? P('#ff4fa3', '#36e2ff', '#ffb35c') : P('#39d879', '#2ee6c4', '#ffb35c');
  const sky = P('#04050d', '#0a0f2b', '#1a1a48', '#3a1f5c');
  const street = P('#1a2236', '#10172a', '#070b16');
  // the far skyline: a row of blocks
  const far = Array.from({ length: 14 }, () => 0.1 + r() * 0.24);
  // two near walls frame the street, each with a tall sign
  const signs = [
    { x: 0.13 + r() * 0.04, y: horizon - 0.3 - r() * 0.08, w: 0.035, h: 0.2, c: glow[0] },
    { x: 0.84 - r() * 0.04, y: horizon - 0.26 - r() * 0.08, w: 0.035, h: 0.18, c: glow[1] },
    { x: 0.3 + r() * 0.4, y: horizon - 0.12, w: 0.05, h: 0.04, c: glow[2] },
  ];
  const fig = 0.4 + r() * 0.16;
  const wallL = 0.2;
  const wallR = 0.8;

  const lit = (u: number, v: number, top: number, i: number) => {
    const cx = Math.floor(u * 70);
    const cy = Math.floor((v - top) * 22);
    return (cx & 1) === 0 && (cy & 1) === 0 && h2(cx + i * 13, cy, seed) > 0.55;
  };

  const above = (u: number, v: number, x: number, y: number, stars: boolean): RGB => {
    let c = ramp(sky, v / horizon, x, y);
    if (stars && v < horizon * 0.35 && h2(x, y, seed) > 0.994) c = [210, 220, 250];
    const fi = Math.floor(u * far.length);
    const ftop = horizon - far[fi];
    if (v > ftop) {
      c = ramp(P('#151d3a', '#0e1530'), (v - ftop) * 3, x, y);
      if (lit(u, v, ftop, fi)) c = mul(glow[Math.floor(h2(fi, Math.floor(v * 22), seed) * 3)], 0.6);
    }
    // the near walls, leaning in with the perspective
    const lean = (horizon - v) * 0.12;
    if (u < wallL + lean || u > wallR - lean) {
      c = ramp(P('#0b1122', '#070b18'), Math.abs(u - 0.5) * 2, x, y);
      if (lit(u, v, 0, u < 0.5 ? 1 : 2) && v > 0.12) c = mul([255, 214, 140], 0.55);
    }
    for (const s of signs) {
      const dx = Math.abs(u - s.x) / s.w;
      const dy = Math.abs(v - s.y) / s.h;
      const d = Math.max(dx, dy);
      if (d < 1) c = d > 0.7 ? s.c : frac(dy * 3) < 0.5 ? mix(s.c, [255, 255, 255], 0.3) : mul(s.c, 0.3);
      else c = add(c, s.c, 0.5 * Math.exp(-(d - 1) * 2.2));
    }
    return c;
  };

  return (u, v, x, y) => {
    let c: RGB;
    if (v < horizon) c = above(u, v, x, y, true);
    else {
      const t = (v - horizon) / (1 - horizon);
      c = ramp(street, t, x, y);
      // kerbs converge on the vanishing point
      const kerb = 0.5 + (0.5 - wallL) * (0.25 + t * 0.75);
      if (Math.abs(Math.abs(u - 0.5) - (kerb - 0.5)) < 0.006 + t * 0.006) c = [60, 72, 96];
      if (Math.abs(u - 0.5) > kerb - 0.5) c = mul(c, 0.7);
      // wet reflections of the signs, broken up by ripples
      for (const s of signs) {
        if (Math.abs(u - s.x) < s.w * 1.4 && frac(v * 60 + noise1(u * 40, seed) * 3) < 0.6) c = add(c, s.c, 0.35 * (1 - t));
      }
      if (Math.abs(u - 0.5) < 0.004 + t * 0.012 && frac(1 / (t + 0.06)) < 0.45) c = [230, 190, 110];
    }
    // a figure in a yellow coat, under a black umbrella
    const fx = (u - fig) * aspect;
    const fv = (v - (horizon - 0.02)) / 0.24;
    if (fv > -0.12 && fv < 1) {
      const umb = fv < 0.08 && fx * fx / 0.004 + ((fv - 0.08) / 0.2) ** 2 < 1;
      const head = Math.abs(fx) < 0.018 && fv > 0.1 && fv < 0.24;
      const coat = Math.abs(fx) < 0.024 + fv * 0.03 && fv >= 0.24 && fv < 0.82;
      const legs = Math.abs(Math.abs(fx) - 0.014) < 0.008 && fv >= 0.82;
      if (umb) c = [16, 18, 26];
      else if (head) c = [40, 30, 34];
      else if (coat) c = fx > 0.01 ? [180, 140, 40] : [242, 212, 92];
      else if (legs) c = [24, 20, 26];
    }
    // sparse rain
    const col = Math.floor(u * 64);
    if (h1(col, seed + 5) > 0.55 && frac(v * 9 + h1(col, seed) * 7 + u * 3) < 0.05) c = add(c, [140, 170, 210], 0.45);
    return c;
  };
};

const desert: Scene = (seed) => {
  const r = rng(seed);
  const horizon = 0.6 + (r() - 0.5) * 0.06;
  const sunX = 0.3 + r() * 0.4;
  const sky = P('#1a0f3a', '#3b1f63', '#8a2f6e', '#d94a6a', '#ff7a45', '#ffb35c');
  const sand = P('#c9724a', '#9c4f3d', '#6b3434', '#3b1f2e');
  const mesaSeed = seed + 17;
  const motelX = r() < 0.5 ? 0.62 + r() * 0.12 : 0.1 + r() * 0.12;
  const cacti = Array.from({ length: 3 }, () => ({ x: r(), s: 0.5 + r() * 0.6 }));
  return (u, v, x, y) => {
    let c: RGB;
    if (v < horizon) {
      c = ramp(sky, v / horizon, x, y);
      const sd = ell(u, v, sunX, horizon - 0.05, 0.16, 0.25);
      if (sd < 1) {
        const band = v > horizon - 0.12 && frac(v * 48) < (v - (horizon - 0.12)) * 6;
        if (!band) c = ramp(P('#ffe28a', '#ffb35c', '#ff7a45'), (v - (horizon - 0.3)) / 0.3, x, y);
      } else c = add(c, [255, 140, 80], 0.18 * Math.exp(-(sd - 1) * 1.2));
      const mesa = horizon - 0.04 - (noise1(u * 4, mesaSeed) > 0.55 ? 0.1 : 0.02) - fbm(u * 12, mesaSeed) * 0.03;
      if (v > mesa) c = ramp(P('#3b1f4f', '#2a1638'), (v - mesa) / 0.1, x, y);
    } else {
      const t = (v - horizon) / (1 - horizon);
      c = ramp(sand, t, x, y);
      const half = 0.02 + t * 0.4;
      if (Math.abs(u - 0.5) < half) {
        c = ramp(P('#3a3340', '#2b2530', '#1d1922'), t, x, y);
        if (Math.abs(u - 0.5) < 0.004 + t * 0.012 && frac(1 / (t + 0.08)) < 0.5) c = [255, 214, 120];
      }
    }
    // the motel: a long low block and a sign on a pole
    const mb = horizon + 0.02;
    if (Math.abs(u - motelX) < 0.12 && v > mb - 0.1 && v < mb) {
      c = v < mb - 0.085 ? [60, 30, 50] : [44, 24, 44];
      if (frac((u - motelX) * 40) < 0.4 && v > mb - 0.06 && v < mb - 0.03) c = h2(Math.floor((u - motelX) * 40), 1, seed) > 0.4 ? [255, 214, 140] : [80, 50, 70];
    }
    const sx = motelX + 0.14;
    if (Math.abs(u - sx) < 0.004 && v > mb - 0.28 && v < mb) c = [40, 24, 40];
    if (Math.abs(u - sx) < 0.05 && v > mb - 0.34 && v < mb - 0.26) {
      const edge = Math.abs(u - sx) > 0.042 || v < mb - 0.333 || v > mb - 0.267;
      c = edge ? [255, 79, 163] : frac(u * 60) < 0.5 && Math.abs(v - (mb - 0.3)) < 0.012 ? [57, 216, 121] : [70, 20, 60];
    } else {
      const d = ell(u, v, sx, mb - 0.3, 0.07, 0.06);
      if (d < 3) c = add(c, [255, 79, 163], 0.12 * (3 - d));
    }
    for (const k of cacti) {
      const cv = horizon + 0.12 + k.s * 0.2;
      const ch = 0.08 * k.s;
      const cw = 0.006 * k.s;
      if (v < cv && v > cv - ch && (Math.abs(u - k.x) < cw || (v > cv - ch * 0.7 && v < cv - ch * 0.45 && Math.abs(u - k.x) < cw * 4 && Math.abs(Math.abs(u - k.x) - cw * 3) < cw))) c = [40, 52, 40];
    }
    return c;
  };
};

const ocean: Scene = (seed, aspect) => {
  const r = rng(seed);
  const horizon = 0.52 + (r() - 0.5) * 0.06;
  const left = r() < 0.5;
  const moonX = left ? 0.72 : 0.28;
  const sky = P('#0b1a33', '#1d3a63', '#3d6a8f', '#b98aa0', '#f2b38a');
  const sea = P('#16405e', '#0d2c48', '#071a2e');
  const lh = left ? 0.2 : 0.8;
  return (u, v, x, y) => {
    const cu = left ? u : 1 - u;
    let c: RGB;
    if (v < horizon) {
      c = ramp(sky, v / horizon, x, y);
      const md = ell(u, v, moonX, 0.22, 0.045 / aspect * 1.7, 0.045 * 1.7);
      if (md < 1) c = [242, 238, 220];
      else c = add(c, [200, 210, 230], 0.12 * Math.exp(-(md - 1) * 0.8));
      // lighthouse beam
      const ang = Math.atan2(v - (horizon - 0.33), (u - lh) * aspect);
      if (Math.abs(ang - (left ? -0.12 : Math.PI + 0.12)) < 0.06 && Math.abs(u - lh) > 0.02) c = add(c, [255, 240, 190], 0.3);
    } else {
      const t = (v - horizon) / (1 - horizon);
      c = ramp(sea, t, x, y);
      if (frac(v * 90 + noise1(u * 20, seed) * 2) < 0.12) c = add(c, [120, 170, 200], 0.25 * (1 - t));
      if (Math.abs(u - moonX) < 0.04 * (1 + t) && frac(v * 70 + noise1(u * 30, seed + 1)) < 0.45) c = add(c, [230, 230, 210], 0.5 * (1 - t * 0.5));
    }
    // the cliff and the tower on it
    const cliff = horizon - 0.18 + cu * 0.9 + fbm(cu * 10, seed) * 0.06;
    if (cu < 0.34 && v > cliff) c = ramp(P('#1a2430', '#10171f', '#080c12'), (v - cliff) * 4, x, y);
    if (cu < 0.36 && v > cliff - 0.01 && v < cliff + 0.01 && cu > 0.3) c = [220, 235, 240];
    const tw = 0.018 + (v - (horizon - 0.38)) * 0.03;
    if (Math.abs(u - lh) < tw && v > horizon - 0.36 && v < horizon - 0.12) c = frac(v * 22) < 0.5 ? [230, 230, 225] : [190, 60, 60];
    if (Math.abs(u - lh) < 0.024 && v > horizon - 0.4 && v < horizon - 0.36) c = [255, 238, 170];
    return c;
  };
};

const forest: Scene = (seed, aspect) => {
  const r = rng(seed);
  const sky = P('#e8efe6', '#c9d9cf', '#a7c0b6');
  const layers = [
    { base: 0.5, h: 0.16, col: rgb('#8fae9f'), n: 22 },
    { base: 0.62, h: 0.24, col: rgb('#5d8573'), n: 16 },
    { base: 0.78, h: 0.36, col: rgb('#2f5545'), n: 11 },
    { base: 1.02, h: 0.5, col: rgb('#13291f'), n: 7 },
  ].map((l, i) => ({ ...l, off: r(), seed: seed + i * 31 }));
  const shaft = 0.2 + r() * 0.5;
  return (u, v, x, y) => {
    let c = ramp(sky, v * 1.2, x, y);
    for (const l of layers) {
      const tu = u * l.n + l.off;
      const i = Math.floor(tu);
      const local = frac(tu) - 0.5;
      const th = l.h * (0.75 + h1(i, l.seed) * 0.5);
      const top = l.base - th;
      const half = ((v - top) / th) * 0.5 * (aspect > 1 ? 1 : 0.8);
      if (v > top && Math.abs(local) < half + (frac((v - top) * 40) < 0.5 ? 0.03 : 0)) c = l.col;
      if (v > l.base - 0.02) c = l.col;
      // fog between layers
      if (v > l.base - 0.08 && v < l.base) c = mix(c, [220, 230, 225], 0.25 * bayer(x, y));
    }
    const d = u - shaft - v * 0.35;
    if (Math.abs(d) < 0.05 && v < 0.85) c = add(c, [255, 245, 200], 0.18 * (1 - Math.abs(d) / 0.05));
    return c;
  };
};

const mountain: Scene = (seed, aspect) => {
  const r = rng(seed);
  const horizon = 0.64 + (r() - 0.5) * 0.04;
  const sky = P('#030714', '#071433', '#0b2147', '#123a5e');
  const ph = r() * 10;
  // pixel-art peaks: a few cones per range
  const range = (n: number, base: number, tall: number) =>
    Array.from({ length: n }, (_, i) => ({ c: (i + 0.2 + r() * 0.6) / n, h: base + r() * tall, k: 1.1 + r() * 0.8 }));
  const back = range(4, 0.18, 0.16);
  const front = range(3, 0.1, 0.14);
  const height = (u: number, cones: typeof back) => {
    let h = 0;
    for (const p of cones) h = Math.max(h, p.h - Math.abs(u - p.c) * aspect * 0.55 * p.k);
    return h + noise1(u * 30, seed) * 0.012;
  };
  return (u, v, x, y) => {
    const mirror = v > horizon;
    const vv = mirror ? horizon - (v - horizon) * 0.9 : v;
    const uu = mirror ? u + Math.sin(v * 140) * 0.003 : u;
    let c = ramp(sky, vv / horizon, x, y);
    if (vv < horizon * 0.55 && h2(x, Math.floor(vv * 1000), seed) > 0.992) c = [230, 240, 255];
    // aurora: a curtain of green and teal with vertical folds
    const centre = 0.2 + Math.sin(uu * 5 + ph) * 0.05 + noise1(uu * 6, seed) * 0.05;
    const fold = 0.5 + 0.5 * Math.sin(uu * 70 + noise1(uu * 8, seed) * 6);
    const a = Math.exp(-(((vv - centre) / 0.07) ** 2)) * (0.35 + 0.4 * fold);
    if (a > 0.06) c = ramp([c, rgb('#1a8f4d'), rgb('#39d879'), rgb('#a0eec2')], a, x, y);
    else if (vv > centre && vv < centre + 0.18) c = add(c, [46, 230, 196], 0.1 * (1 - (vv - centre) / 0.18) * fold);
    // snow only on the high ground
    const hBack = height(uu, back);
    const hb = horizon - hBack;
    if (vv > hb) {
      c = ramp(P('#2b4566', '#22385a', '#1a2c48'), (vv - hb) * 5, x, y);
      if (hBack > 0.2 && vv < hb + (hBack - 0.2) * 0.7) c = ramp(P('#e8f1ff', '#b8cbe4'), (vv - hb) * 18, x, y);
    }
    const hFront = height(uu + 0.37, front);
    const hf = horizon - hFront;
    if (vv > hf) {
      c = ramp(P('#16243a', '#0e1828', '#0a121e'), (vv - hf) * 5, x, y);
      if (hFront > 0.13 && vv < hf + (hFront - 0.13) * 0.7) c = ramp(P('#f2f7ff', '#c4d4ea'), (vv - hf) * 18, x, y);
    }
    if (mirror) {
      c = mul(c, 0.5);
      if (frac(v * 90 + noise1(u * 12, seed) * 2) < 0.1) c = add(c, [90, 170, 150], 0.15);
    }
    return c;
  };
};

const portrait: Scene = (seed, aspect) => {
  const r = rng(seed);
  const bg = r() < 0.5 ? P('#0e1a2a', '#16304a', '#20476a') : P('#1a1020', '#2e1b3a', '#4a2a52');
  const rim = r() < 0.6 ? rgb('#39d879') : rgb('#2ee6c4');
  const hair = [rgb('#c8d2d8'), rgb('#1a1418'), rgb('#6b3a2a'), rgb('#e0b060')][Math.floor(r() * 4)];
  const coat = [rgb('#f2d45c'), rgb('#3d6e8f'), rgb('#7a2f3a'), rgb('#2f5545')][Math.floor(r() * 4)];
  const skin = [rgb('#e8b896'), rgb('#c48a66'), rgb('#8a5a3c'), rgb('#f2cfb0')][Math.floor(r() * 4)];
  const side = r() < 0.5 ? 1 : -1;
  const short = r() < 0.5;
  return (u, v, x, y) => {
    const X = (u - 0.5) * aspect;
    let c = ramp(bg, 1 - Math.abs(X) * 0.9 + (1 - v) * 0.15, x, y);
    c = add(c, rim, 0.16 * clamp01(1 - Math.abs(X - side * 0.45) * 2.5));
    const head = ell(X, v, 0, 0.42, 0.12, 0.16);
    const body = ell(X, v, 0, 1.06, 0.4, 0.38);
    const neck = Math.abs(X) < 0.05 && v > 0.52 && v < 0.74;
    if (body < 1) {
      c = ramp([mul(coat, 0.5), coat], (1 - body) * 1.5 - side * X, x, y);
      if (side * X > 0 && body > 0.8) c = mix(c, rim, 0.8);
      if (Math.abs(X) < 0.08 && v < 0.8 && v > 0.7) c = mul(coat, 0.4);
    } else if (neck) c = ramp([mul(skin, 0.55), mul(skin, 0.8)], 0.5 + side * X * 4, x, y);
    if (head < 1) {
      c = ramp([mul(skin, 0.6), skin], 1.1 - head + side * X * 2, x, y);
      const hairTop = v < 0.33 + Math.sin(X * 40) * 0.01;
      const hairSide = Math.abs(X) > 0.085 && v < (short ? 0.44 : 0.62);
      if (hairTop || hairSide) c = ramp([mul(hair, 0.55), hair], 1 - head + 0.2, x, y);
      if (head > 0.78 && side * X > 0) c = mix(c, rim, 0.85);
      if (Math.abs(v - 0.43) < 0.012 && Math.abs(Math.abs(X) - 0.045) < 0.014) c = [20, 18, 24];
      if (Math.abs(v - 0.51) < 0.008 && Math.abs(X) < 0.025) c = mul(skin, 0.55);
    }
    if (!short && Math.abs(X) > 0.085 && Math.abs(X) < 0.15 && v > 0.42 && v < 0.66 && body >= 1) c = ramp([mul(hair, 0.5), hair], 0.6, x, y);
    return c;
  };
};

const product: Scene = (seed, aspect) => {
  const r = rng(seed);
  const bg = P('#06101c', '#0d1b2a', '#16304a');
  const kind = Math.floor(r() * 3);
  const col = [rgb('#f2f7f4'), rgb('#39d879'), rgb('#ff9f5a'), rgb('#8b7bff')][Math.floor(r() * 4)];
  return (u, v, x, y) => {
    const X = (u - 0.5) * aspect;
    let c = ramp(bg, 1 - Math.abs(v - 0.45) * 1.6, x, y);
    if (Math.abs(X) < (v + 0.15) * 0.32 && v < 0.8) c = add(c, [160, 190, 210], 0.07);
    const top = 0.72;
    if (Math.abs(X) < 0.3 && v > top && v < 0.99) c = ramp(P('#c9d4dc', '#8c9aa6', '#5b6876'), (v - top) * 4 + Math.abs(X) * 1.5, x, y);
    if (ell(X, v, 0, top, 0.3, 0.04) < 1) c = [222, 230, 236];
    if (kind === 0) {
      const body = Math.abs(X) < 0.1 && v > 0.36 && v < top;
      const neck = Math.abs(X) < 0.035 && v > 0.24 && v < 0.37;
      const cap = Math.abs(X) < 0.05 && v > 0.19 && v < 0.25;
      if (body || neck) c = ramp([mul(col, 0.4), col], 0.75 - X * 4, x, y);
      if (cap) c = [30, 34, 40];
      if (body && Math.abs(X + 0.05) < 0.012 && v < 0.62) c = [255, 255, 255];
      if (body && v > 0.48 && v < 0.58) c = mul(col, 0.3);
    } else if (kind === 1) {
      const s = ell(X, v, 0, top - 0.1, 0.3, 0.1);
      const toe = ell(X, v, 0.12, top - 0.05, 0.18, 0.055);
      if ((s < 1 && v < top - 0.02) || toe < 1) c = ramp([mul(col, 0.5), col], 1.1 - s, x, y);
      if (Math.abs(v - (top - 0.025)) < 0.012 && Math.abs(X) < 0.3) c = [235, 235, 230];
      if (s < 1 && Math.abs(v - (top - 0.11)) < 0.01 && frac(X * 30) < 0.5) c = [240, 240, 240];
    } else {
      const d = ell(X, v, 0, top - 0.16, 0.16, 0.16);
      if (d < 1) c = ramp([mul(col, 0.35), col], 1.1 - d - X * 2, x, y);
      if (d < 0.25 && X < 0) c = mix(c, [255, 255, 255], 0.5);
      if (Math.abs(X) < 0.012 && v > top - 0.38 && v < top - 0.31) c = [200, 200, 200];
    }
    return c;
  };
};

const fashion: Scene = (seed, aspect) => {
  const r = rng(seed);
  const bg = P('#efe4d4', '#dccab3', '#bca58e');
  const garment = [rgb('#4d6b45'), rgb('#efe6d6'), rgb('#7a2f3a'), rgb('#2e3b55'), rgb('#c8a45c')][Math.floor(r() * 5)];
  const skin = [rgb('#e8b896'), rgb('#8a5a3c'), rgb('#c48a66')][Math.floor(r() * 3)];
  const lean = (r() - 0.5) * 0.05;
  return (u, v, x, y) => {
    const X = (u - 0.5) * aspect;
    let c = ramp(bg, v * 0.9 + Math.abs(X) * 0.3, x, y);
    if (v > 0.88) c = ramp(P('#a8907a', '#8c7562'), (v - 0.88) * 6, x, y);
    // soft shadow on the floor
    if (ell(X, v, 0.03, 0.9, 0.16, 0.02) < 1) c = mul(c, 0.85);
    const cx = lean * (1 - v);
    const head = ell(X, v, cx, 0.13, 0.045, 0.055);
    if (head < 1) c = v < 0.11 ? [40, 30, 30] : ramp([mul(skin, 0.7), skin], 1 - head, x, y);
    if (Math.abs(X - cx) < 0.016 && v > 0.18 && v < 0.21) c = skin;
    const w = 0.07 + (v - 0.2) * 0.17;
    if (v > 0.2 && v < 0.74 && Math.abs(X - cx) < w) {
      c = ramp([mul(garment, 0.55), garment], 0.85 - Math.abs(X - cx) / w + (X < cx ? 0.25 : 0), x, y);
      if (Math.abs(X - cx) < 0.005 && v > 0.24) c = mul(garment, 0.45);
      if (v > 0.4 && v < 0.43) c = mul(garment, 0.68);
      if (Math.abs(X - cx) > w - 0.012) c = mul(garment, 0.7);
    }
    if (v >= 0.74 && v < 0.88 && Math.abs(Math.abs(X - cx) - 0.026) < 0.012) c = [44, 38, 40];
    if (v > 0.86 && v < 0.89 && Math.abs(Math.abs(X - cx) - 0.03) < 0.02) c = [26, 22, 24];
    c = add(c, [255, 250, 240], 0.08 * clamp01(1 - Math.abs(X) * 2));
    return c;
  };
};

const space: Scene = (seed, aspect) => {
  const r = rng(seed);
  const px = 0.62 + (r() - 0.5) * 0.2;
  const py = 0.6;
  const pr = 0.32;
  const band = [rgb('#1d3a8a'), rgb('#3d6ae0'), rgb('#7fd3e6'), rgb('#e9f3f1')];
  return (u, v, x, y) => {
    let c = ramp(P('#03030a', '#090a1f', '#141238'), v, x, y);
    if (h2(x, y, seed) > 0.985) c = h2(x, y, seed + 1) > 0.7 ? [255, 255, 255] : [140, 150, 200];
    const du = (u - px) * aspect;
    const dv = v - py;
    const d = Math.sqrt(du * du + dv * dv) / pr;
    if (d < 1) {
      const light = clamp01(0.3 + (-du * 0.8 - dv * 0.6) / pr);
      c = ramp(band, light * 0.9 + noise1(dv * 18 + seed, seed) * 0.15, x, y);
      if (d > 0.94) c = mix(c, [140, 200, 255], 0.5);
    } else c = add(c, [80, 130, 255], 0.2 * Math.exp(-(d - 1) * 8));
    const ring = Math.abs(((u - px) * aspect) ** 2 / 1 + ((v - py) * 3.2) ** 2 - (pr * 1.5) ** 2);
    if (ring < 0.01 && (v > py - 0.02 || d > 1)) c = add(c, [200, 190, 255], 0.5);
    // a station drifting by
    const sx = 0.22;
    const sy = 0.3;
    if (Math.abs(v - sy) < 0.008 && Math.abs(u - sx) < 0.08) c = [190, 200, 210];
    if (Math.abs(u - sx) < 0.02 && Math.abs(v - sy) < 0.04) c = [220, 225, 230];
    if (Math.abs(u - sx - 0.07) < 0.012 && Math.abs(v - sy) < 0.05) c = [40, 80, 160];
    if (Math.abs(u - sx + 0.07) < 0.012 && Math.abs(v - sy) < 0.05) c = [40, 80, 160];
    return c;
  };
};

const interior: Scene = (seed) => {
  const r = rng(seed);
  const wx = 0.3 + r() * 0.4;
  const wall = P('#2b2026', '#3b2a2a', '#4a3530');
  return (u, v, x, y) => {
    let c = ramp(wall, 1 - v, x, y);
    const floor = 0.72;
    if (v > floor) c = ramp(P('#3a2a22', '#2a1e18', '#1a120e'), (v - floor) * 4, x, y);
    const inWin = Math.abs(u - wx) < 0.12 && v > 0.18 && v < 0.55;
    if (inWin) {
      c = ramp(P('#ffe2b0', '#f2b56a', '#d98a4a'), (v - 0.18) * 3, x, y);
      if (Math.abs(u - wx) < 0.006 || Math.abs(v - 0.365) < 0.008) c = [60, 40, 34];
    }
    // light pool on the floor
    const lp = v > floor && Math.abs(u - wx - (v - floor) * 0.6) < 0.12 + (v - floor) * 0.3;
    if (lp) c = add(c, [255, 200, 130], 0.22);
    // table and lamp
    if (v > 0.6 && v < 0.63 && Math.abs(u - (1 - wx)) < 0.14) c = [26, 18, 16];
    if (v > 0.63 && v < floor + 0.06 && Math.abs(Math.abs(u - (1 - wx)) - 0.12) < 0.01) c = [26, 18, 16];
    const ld = ell(u, v, 1 - wx + 0.08, 0.52, 0.04, 0.05);
    if (ld < 1) c = [255, 214, 140];
    else c = add(c, [255, 190, 110], 0.1 * Math.exp(-(ld - 1) * 0.6));
    return c;
  };
};

const previz: Scene = (seed, aspect) => {
  const r = rng(seed);
  const horizon = 0.42;
  const boxes = Array.from({ length: 6 }, () => ({ x: r() * 0.9 + 0.05, d: 0.15 + r() * 0.8, h: 0.1 + r() * 0.25, w: 0.04 + r() * 0.08 }));
  const camX = 0.2 + r() * 0.6;
  return (u, v, x, y) => {
    let c = ramp(P('#0c1118', '#121a24', '#18222e'), v, x, y);
    if (v > horizon) {
      const t = (v - horizon) / (1 - horizon);
      const z = 1 / (t + 0.02);
      const gx = (u - 0.5) * z;
      if (frac(z * 0.5) < 0.04 * z * 0.1 + 0.03 || frac(gx * 0.6) < 0.025 * z * 0.25) c = [42, 60, 74];
    }
    for (const b of boxes) {
      const t = b.d;
      const base = horizon + (1 - horizon) * t * 0.6;
      const scale = 0.4 + t;
      const w = b.w * scale;
      const top = base - b.h * scale;
      if (Math.abs(u - b.x) < w && v < base && v > top) {
        const edge = Math.abs(u - b.x) > w - 0.006 || v < top + 0.01;
        c = edge ? [150, 165, 178] : ramp(P('#5b6876', '#46525e', '#343e48'), (v - top) / (base - top), x, y);
      }
    }
    // the camera and its frustum, in Kinemi green
    const cy = 0.86;
    const ang = Math.atan2(cy - v, (u - camX) * aspect);
    const dist = Math.hypot((u - camX) * aspect, cy - v);
    if (dist < 0.55 && (Math.abs(ang - 1.25) < 0.01 || Math.abs(ang - 1.9) < 0.01)) c = [57, 216, 121];
    if (Math.abs(u - camX) < 0.03 && Math.abs(v - cy) < 0.025) c = [57, 216, 121];
    if (Math.abs(u - camX) < 0.02 && Math.abs(v - cy) < 0.014) c = [12, 30, 20];
    return c;
  };
};

const audio: Scene = (seed) => {
  const r = rng(seed);
  const ph = r() * 100;
  return (u, v, x, y) => {
    let c = ramp(P('#06101c', '#0b1828', '#0f2034'), Math.abs(v - 0.5) * 2, x, y);
    if (frac(u * 24) < 0.02 || Math.abs(v - 0.5) < 0.002) c = [24, 40, 56];
    const env = 0.15 + 0.85 * fbm(u * 6 + ph, seed, 3);
    const bar = Math.floor(u * 64);
    const amp = env * (0.25 + 0.75 * h1(bar, seed)) * 0.38;
    if (frac(u * 64) < 0.62 && Math.abs(v - 0.5) < amp) c = ramp(P('#145a37', '#24b964', '#39d879', '#a0eec2'), 1 - Math.abs(v - 0.5) / amp + 0.2, x, y);
    if (Math.abs(u - 0.38) < 0.003) c = [242, 247, 244];
    return c;
  };
};

const SCENES: Record<string, Scene> = { neon, desert, ocean, forest, mountain, portrait, product, fashion, space, interior, previz, audio };

/* ------------------------------------------------------------------ */
/* Composites: palette stills and boards                               */
/* ------------------------------------------------------------------ */

function nearest(c: RGB, pal: RGB[], x: number, y: number) {
  let best = 0;
  let second = 0;
  let bd = Infinity;
  let sd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const d = (c[0] - p[0]) ** 2 * 0.3 + (c[1] - p[1]) ** 2 * 0.59 + (c[2] - p[2]) ** 2 * 0.11;
    if (d < bd) {
      sd = bd;
      second = best;
      bd = d;
      best = i;
    } else if (d < sd) {
      sd = d;
      second = i;
    }
  }
  // dither between the two closest colours
  const t = bd / (bd + sd + 1e-6);
  return t * 1.6 > bayer(x, y) + 0.35 ? pal[second] : pal[best];
}

function shaderFor(spec: PosterSpec, aspect: number, kind?: string): Shader {
  if (kind === 'palette' && spec.palette?.length) {
    const pal = spec.palette.map(rgb);
    const sorted = [...pal].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    const inner = (SCENES[spec.scene] ?? neon)(spec.seed, aspect * 1.3);
    return (u, v, x, y) => {
      if (v > 0.78) {
        const i = Math.min(4, Math.floor(u * 5));
        const edge = frac(u * 5) < 0.02 || v < 0.795;
        return edge ? [6, 10, 16] : pal[i];
      }
      const c = inner(u, v / 0.78, x, y);
      return nearest(c, sorted, x, y);
    };
  }
  if (kind === 'board') {
    const n = Math.max(2, Math.min(8, spec.panels ?? 4));
    const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const pal = basePalette(spec.scene).map(rgb);
    const scenes = Array.from({ length: n }, (_, i) => (SCENES[spec.scene] ?? neon)(spec.seed + i * 977, (aspect * rows) / cols));
    return (u, v, x, y) => {
      const gu = u * cols;
      const gv = v * rows;
      const i = Math.floor(gv) * cols + Math.floor(gu);
      const lu = frac(gu);
      const lv = frac(gv);
      const gap = 0.04;
      if (i >= n || lu < gap || lu > 1 - gap || lv < gap * 1.6 || lv > 1 - gap * 1.6) return mul(pal[4] ?? [8, 12, 20], 0.8);
      const c = scenes[i]((lu - gap) / (1 - 2 * gap), (lv - gap * 1.6) / (1 - 3.2 * gap), x, y);
      // shot number: a row of pixels top left
      if (lv < gap * 1.6 + 0.07 && lu < gap + 0.025 * (i + 1) && lu > gap + 0.01) return [242, 247, 244];
      return c;
    };
  }
  return (SCENES[spec.scene] ?? SCENES[kind ?? ''] ?? neon)(spec.seed, aspect);
}

const cache = new Map<string, HTMLCanvasElement>();

/** The poster at exactly cols x rows pixels, cached: scale it up by a whole number to show it. */
export function renderLow(spec: PosterSpec & { kind?: string }, cols: number, rows: number) {
  cols = Math.max(8, cols);
  rows = Math.max(6, rows);
  const key = `${spec.kind}|${spec.scene}|${spec.seed}|${spec.panels ?? ''}|${(spec.palette ?? []).join()}|${cols}x${rows}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const shade = shaderFor(spec, cols / rows, spec.kind);
  const low = document.createElement('canvas');
  low.width = cols;
  low.height = rows;
  const lctx = low.getContext('2d')!;
  const img = lctx.createImageData(cols, rows);
  const d = img.data;
  const grain = spec.seed ^ 0x5bd1e995;
  for (let y = 0; y < rows; y++) {
    const v = (y + 0.5) / rows;
    for (let x = 0; x < cols; x++) {
      const u = (x + 0.5) / cols;
      const c = shade(u, v, x, y);
      // vignette and a touch of grain
      const vig = 1 - 0.7 * ((u - 0.5) ** 2 + (v - 0.5) ** 2);
      const g = (h2(x, y, grain) - 0.5) * 10;
      const o = (y * cols + x) * 4;
      d[o] = c[0] * vig + g;
      d[o + 1] = c[1] * vig + g;
      d[o + 2] = c[2] * vig + g;
      d[o + 3] = 255;
    }
  }
  lctx.putImageData(img, 0, 0);
  cache.set(key, low);
  if (cache.size > 240) cache.delete(cache.keys().next().value!);
  return low;
}
