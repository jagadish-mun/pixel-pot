/*
 * A tiny pixel-art toolkit. Shapes are filled as masks at "art resolution"
 * (ellipses and polygons give stair-stepped edges), then painted with a
 * 4-step colour ramp lit from the top-left and a selective outline: the
 * darkest shade of the object's own colour, one step lighter on lit edges.
 * Art is only ever enlarged by whole numbers.
 */
import { offscreen } from './glyphs';

/** highlight, base, shadow, deep shadow */
export type Ramp = readonly [string, string, string, string];

export class Mask {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h);
  }
  get(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.data[y * this.w + x] === 1;
  }
  set(x: number, y: number, on = true) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = on ? 1 : 0;
  }
  /** Pixels whose centres lie inside the ellipse: clean 3-2-1 steps round the curve. */
  ellipse(cx: number, cy: number, rx: number, ry: number, on = true): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, on);
      }
    return this;
  }
  rect(x: number, y: number, w: number, h: number, on = true): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, on);
    return this;
  }
  /** A filled polygon, sampled at pixel centres. */
  poly(pts: [number, number][], on = true): this {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if (y1 <= sy !== y2 <= sy) xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k] - 0.5); x + 0.5 <= xs[k + 1]; x++) this.set(x, y, on);
    }
    return this;
  }
  /** A thick line between two points (a limb), with rounded ends. */
  limb(x1: number, y1: number, x2: number, y2: number, r: number, on = true): this {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / len) * r;
    const ny = ((x2 - x1) / len) * r;
    this.poly(
      [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
      ],
      on,
    );
    this.ellipse(x1, y1, r, r, on);
    return this.ellipse(x2, y2, r, r, on);
  }
  add(o: Mask): this {
    for (let i = 0; i < this.data.length; i++) if (o.data[i]) this.data[i] = 1;
    return this;
  }
  cut(o: Mask): this {
    for (let i = 0; i < this.data.length; i++) if (o.data[i]) this.data[i] = 0;
    return this;
  }
  copy(): Mask {
    const m = new Mask(this.w, this.h);
    m.data.set(this.data);
    return m;
  }
  shifted(dx: number, dy: number): Mask {
    const m = new Mask(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y)) m.set(x + dx, y + dy);
    return m;
  }
  mirrored(): Mask {
    const m = new Mask(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y)) m.set(this.w - 1 - x, y);
    return m;
  }
  count(): number {
    let n = 0;
    for (const v of this.data) n += v;
    return n;
  }
}

/** Steps from (x, y) in a direction until the pixel is outside the mask (1 = an edge pixel). */
function reach(m: Mask, x: number, y: number, dx: number, dy: number, max = 8): number {
  for (let k = 1; k <= max; k++) if (!m.get(x + dx * k, y + dy * k)) return k;
  return max + 1;
}

/**
 * Paint a mask: a selective outline (deep on the shadow side, the shadow
 * shade on lit top/left edges), a 1 px highlight just inside the lit edge, a
 * shadow band along the bottom/right, base in between. `band` is the shadow's
 * width; `outline: false` leaves the edge to the shading.
 */
export function shade(ctx: CanvasRenderingContext2D, m: Mask, ramp: Ramp, opts: { outline?: boolean; band?: number; x?: number; y?: number } = {}) {
  const [hi, base, sh, deep] = ramp;
  const outline = opts.outline ?? true;
  const band = opts.band ?? 2;
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!m.get(x, y)) continue;
      const up = reach(m, x, y, 0, -1);
      const left = reach(m, x, y, -1, 0);
      const down = reach(m, x, y, 0, 1);
      const right = reach(m, x, y, 1, 0);
      const edge = Math.min(up, left, down, right) === 1;
      let c: string;
      if (outline && edge) c = (up === 1 || left === 1) && down > 1 && right > 1 ? sh : deep;
      else {
        const inset = outline ? 1 : 0;
        const tl = Math.min(up, left) - inset;
        const br = Math.min(down, right) - inset;
        c = tl === 1 ? hi : br <= band ? sh : base;
      }
      ctx.fillStyle = c;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
}

/** A flat-coloured mask (shadows, lines). */
export function fill(ctx: CanvasRenderingContext2D, m: Mask, color: string, alpha = 1, x = 0, y = 0) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let yy = 0; yy < m.h; yy++) for (let xx = 0; xx < m.w; xx++) if (m.get(xx, yy)) ctx.fillRect(x + xx, y + yy, 1, 1);
  ctx.globalAlpha = 1;
}

/** A shape's opaque pixels as a mask (from a drawn canvas). */
export function maskOf(c: HTMLCanvasElement): Mask {
  const m = new Mask(c.width, c.height);
  const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < m.data.length; i++) m.data[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

const silhouettes = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement | null>>();

/**
 * A sprite's silhouette in one colour (a cast shadow, or a glow outline):
 * 'solid' is the shape itself, 'dither' every other pixel of it, 'ring' a
 * 1 px line round it (that canvas is 1 px bigger all round).
 */
export function silhouette(src: HTMLCanvasElement, color: string, kind: 'solid' | 'dither' | 'ring'): HTMLCanvasElement | null {
  let per = silhouettes.get(src);
  if (!per) silhouettes.set(src, (per = new Map()));
  const key = `${color}|${kind}`;
  if (per.has(key)) return per.get(key)!;
  const pad = kind === 'ring' ? 1 : 0;
  const out = offscreen(src.width + 2 * pad, src.height + 2 * pad);
  if (out) {
    const m = maskOf(src);
    const t = out.getContext('2d')!;
    t.fillStyle = color;
    for (let y = -pad; y < m.h + pad; y++)
      for (let x = -pad; x < m.w + pad; x++) {
        const on = m.get(x, y);
        const draw =
          kind === 'solid' ? on : kind === 'dither' ? on && (x + y) % 2 === 0 : !on && (m.get(x - 1, y) || m.get(x + 1, y) || m.get(x, y - 1) || m.get(x, y + 1));
        if (draw) t.fillRect(x + pad, y + pad, 1, 1);
      }
  }
  per.set(key, out);
  return out;
}

/** A canvas's colours turned to greys (players out of chips), keeping their lightness. */
export function greyed(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = offscreen(src.width, src.height)!;
  const t = out.getContext('2d')!;
  t.drawImage(src, 0, 0);
  const img = t.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.3 * d[i] + 0.55 * d[i + 1] + 0.15 * d[i + 2]);
    d[i] = g + 4;
    d[i + 1] = g;
    d[i + 2] = g + 8;
  }
  t.putImageData(img, 0, 0);
  return out;
}

/** Stamp a bitmap (rows of 'X') at a whole-number scale, optionally turned 180°. */
export function bitmap(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, color: string, scale = 1, turned = false) {
  ctx.fillStyle = color;
  const rs = turned ? [...rows].reverse().map((r) => [...r].reverse().join('')) : rows;
  rs.forEach((row, dy) => [...row].forEach((c, dx) => c === 'X' && ctx.fillRect(x + dx * scale, y + dy * scale, scale, scale)));
}
