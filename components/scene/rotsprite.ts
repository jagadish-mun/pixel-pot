/*
 * RotSprite: rotating pixel art without breaking it. The sprite is enlarged 8×
 * with Scale2x (EPX) three times, which rounds its diagonals; rotated with
 * nearest-neighbour sampling; then shrunk back 8× by taking the most common
 * colour in each 8×8 block. Edges come out as clean stair-steps. Results are
 * cached per sprite and angle. Never ctx.rotate anything with glyphs.
 */
import { offscreen } from './glyphs';

interface Px {
  px: Uint32Array;
  w: number;
  h: number;
}

/** Scale2x (EPX): each pixel becomes 2×2, taking a neighbour's colour where two edges meet. */
export function scale2x({ px, w, h }: Px): Px {
  const out = new Uint32Array(w * 2 * h * 2);
  const at = (x: number, y: number) => px[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = px[y * w + x];
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const o = y * 2 * (w * 2) + x * 2;
      out[o] = c === a && c !== d && a !== b ? a : p;
      out[o + 1] = a === b && a !== c && b !== d ? b : p;
      out[o + w * 2] = d === c && d !== b && c !== a ? c : p;
      out[o + w * 2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  return { px: out, w: w * 2, h: h * 2 };
}

/**
 * Rotate by `deg` (clockwise, y down) about the sprite's centre. The result is
 * big enough for the turned sprite; its centre is the old centre.
 */
export function rotatePixels(src: Px, deg: number): Px {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  if (Math.abs(deg) < 0.01) return src;
  let big = scale2x(scale2x(scale2x(src)));
  // Rotated bounds at 8×, rounded up to whole 8×8 blocks with the same centre parity.
  const ow = Math.ceil((Math.abs(src.w * cos) + Math.abs(src.h * sin)) / 2) * 2 + (src.w % 2) + 2;
  const oh = Math.ceil((Math.abs(src.w * sin) + Math.abs(src.h * cos)) / 2) * 2 + (src.h % 2) + 2;
  const W = ow * 8;
  const H = oh * 8;
  const rot = new Uint32Array(W * H);
  const cx = W / 2;
  const cy = H / 2;
  const sx0 = big.w / 2;
  const sy0 = big.h / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const sx = Math.floor(cos * dx + sin * dy + sx0);
      const sy = Math.floor(-sin * dx + cos * dy + sy0);
      if (sx >= 0 && sy >= 0 && sx < big.w && sy < big.h) rot[y * W + x] = big.px[sy * big.w + sx];
    }
  big = { px: new Uint32Array(0), w: 0, h: 0 };
  // Back down: the most common colour of each 8×8 block (ties go to the block's centre pixel).
  const out = new Uint32Array(ow * oh);
  const vals: number[] = [];
  const counts: number[] = [];
  for (let by = 0; by < oh; by++)
    for (let bx = 0; bx < ow; bx++) {
      vals.length = 0;
      counts.length = 0;
      for (let y = by * 8; y < by * 8 + 8; y++)
        for (let x = bx * 8; x < bx * 8 + 8; x++) {
          const v = rot[y * W + x];
          const i = vals.indexOf(v);
          if (i < 0) {
            vals.push(v);
            counts.push(1);
          } else counts[i]++;
        }
      const centre = rot[(by * 8 + 4) * W + bx * 8 + 4];
      let best = vals.indexOf(centre);
      for (let i = 0; i < vals.length; i++) if (counts[i] > counts[best]) best = i;
      out[by * ow + bx] = vals[best];
    }
  return { px: out, w: ow, h: oh };
}

export interface Rotated {
  canvas: HTMLCanvasElement;
  /** Where the original sprite's centre lies in the rotated canvas. */
  cx: number;
  cy: number;
}

const cache = new WeakMap<HTMLCanvasElement, Map<number, Rotated | null>>();

/** A sprite turned by `deg` (rounded to whole degrees), cached per sprite and angle. */
export function rotSprite(src: HTMLCanvasElement, deg: number): Rotated | null {
  const angle = Math.round(deg);
  let per = cache.get(src);
  if (!per) cache.set(src, (per = new Map()));
  if (per.has(angle)) return per.get(angle)!;
  let result: Rotated | null = null;
  if (angle === 0) result = { canvas: src, cx: src.width / 2, cy: src.height / 2 };
  else {
    const t = src.getContext('2d')!;
    const data = t.getImageData(0, 0, src.width, src.height);
    const r = rotatePixels({ px: new Uint32Array(data.data.buffer.slice(0)), w: src.width, h: src.height }, angle);
    const out = offscreen(r.w, r.h);
    if (out) {
      const img = new ImageData(new Uint8ClampedArray(r.px.buffer as ArrayBuffer), r.w, r.h);
      out.getContext('2d')!.putImageData(img, 0, 0);
      result = { canvas: out, cx: r.w / 2, cy: r.h / 2 };
    }
  }
  per.set(angle, result);
  return result;
}
