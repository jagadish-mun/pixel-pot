/*
 * Drawing the table scene on a small canvas. Everything is filled with whole
 * pixels (a scanline fill, no anti-aliasing), so it stays crisp pixel art when
 * the canvas is scaled up.
 */
import { PER_TOWER, WEALTH, chipFaceRows, chipTowers, denom } from '../../lib/chips';
import type { Card } from '@/lib/cards';
import { hashText } from '../../lib/bot';
import { CARD_ART, cardArt } from './cardart';
import { BONE, INK, LETTERS, offscreen, stamp } from './glyphs';
import { handsScale, handsSize, handsSprite, type HandsMode } from './hands';
import { silhouette } from './pixel';
import { rotSprite } from './rotsprite';
import { BOARD_Z, BET_INSET, STACK_INSET, myShowSpot, onFelt, railPoint, spots, type SeatSpot } from './layout';
import { personSprite, spriteMetrics, type Pose } from './people';
import { PERSON_H, RAIL_H, RAIL_W, TABLE_R, project, stadium, stadiumAt, stadiumLength, type Camera, type Vec } from './project';

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

const GOLD = '#f5b83d';

/* --------------------------------- raster --------------------------------- */

/** Fill one or more closed outlines (even–odd), one whole-pixel span per row. */
export function fillPolys(ctx: Ctx, contours: Pt[][], style: string | CanvasPattern) {
  const edges: [number, number, number, number][] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (a.y === b.y) continue;
      edges.push(a.y < b.y ? [a.y, a.x, b.y, b.x] : [b.y, b.x, a.y, a.x]);
      minY = Math.min(minY, a.y, b.y);
      maxY = Math.max(maxY, a.y, b.y);
    }
  }
  ctx.fillStyle = style;
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y < y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const [ay, ax, by, bx] of edges) if (yc >= ay && yc < by) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const l = Math.round(xs[i]);
      const r = Math.round(xs[i + 1]);
      if (r > l) ctx.fillRect(l, y, r - l, 1);
    }
  }
}

/** A filled ellipse of whole pixels. */
function fillEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  const top = Math.round(cy - ry);
  const rows = Math.max(1, Math.round(ry * 2));
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows; // 0..1 down the ellipse
    const half = rx * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    const l = Math.round(cx - half);
    const r = Math.round(cx + half);
    if (r > l) ctx.fillRect(l, top + i, r - l, 1);
  }
}

/** A closed or open line of pixels through `pts`, each pixel drawn once (so see-through colours stay even). */
function plotLine(ctx: Ctx, pts: Pt[], color: string, closed: boolean, size = 1) {
  const seen = new Set<number>();
  ctx.fillStyle = color;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let k = 0; k <= steps; k++) {
      const x = Math.floor(a.x + ((b.x - a.x) * k) / steps);
      const y = Math.floor(a.y + ((b.y - a.y) * k) / steps);
      const key = y * 4096 + x;
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.fillRect(x, y, size, size);
    }
  }
}

const onScreen = (cam: Camera, pts: Vec[], y: number): Pt[] => pts.map((p) => project(cam, p.x, y, p.z));

/* -------------------------------- textures -------------------------------- */

const patterns = new WeakMap<Ctx, CanvasPattern>();

/** Felt: green with a light dither of darker pixels. */
function feltPattern(ctx: Ctx): CanvasPattern | string {
  const cached = patterns.get(ctx);
  if (cached) return cached;
  if (typeof document === 'undefined') return '#2e8b57';
  const tile = document.createElement('canvas');
  tile.width = 4;
  tile.height = 4;
  const t = tile.getContext('2d')!;
  t.fillStyle = '#2f8f5c';
  t.fillRect(0, 0, 4, 4);
  t.fillStyle = '#287d50';
  for (const [x, y] of [
    [0, 0],
    [2, 1],
    [1, 2],
    [3, 3],
  ])
    t.fillRect(x, y, 1, 1);
  const p = ctx.createPattern(tile, 'repeat')!;
  patterns.set(ctx, p);
  return p;
}

/* ---------------------------------- cards --------------------------------- */

export const BOARD_CARD = { w: 0.156, d: 0.22, gap: 0.016 };
/** Cards and my hands are drawn on the fine layer: two of its pixels to a scene pixel. */
export const FINE = 2;
const SHADOW = '#0c0916';

/** Flat cards' whole-number art scale on the fine layer (about 1.6× the old board cards), and their size in scene pixels. */
/** Per-camera results of layout searches: they depend only on the camera and the table, not on the frame. */
const memo = new WeakMap<Camera, Map<string, unknown>>();
function remember<T>(cam: Camera, key: string, make: () => T): T {
  let m = memo.get(cam);
  if (!m) memo.set(cam, (m = new Map()));
  if (m.size > 500) m.clear();
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

export function flatCard(cam: Camera): { k: number; w: number; h: number } {
  return remember(cam, 'flat', () => {
    const base = Math.abs(project(cam, BOARD_CARD.w / 2, 0, BOARD_Z).x - project(cam, -BOARD_CARD.w / 2, 0, BOARD_Z).x);
    // Rounded up a little (a card a size too big reads better than one too small), but the line of five
    // never reaches the end seats' chips (about 1.0 from the middle).
    const room = FINE * Math.abs(project(cam, 0.8, 0, BOARD_Z).x - project(cam, -0.8, 0, BOARD_Z).x);
    const most = Math.max(1, Math.floor(room / (5 * CARD_ART.flat.w + 12)));
    const k = Math.min(most, Math.max(1, Math.round((FINE * 1.6 * base) / CARD_ART.flat.w + 0.25)));
    return { k, w: (CARD_ART.flat.w * k) / FINE, h: (CARD_ART.flat.h * k) / FINE };
  });
}

/**
 * A flat card centred on (cx, cy) in scene pixels, on the fine layer at art
 * scale `k`: a dithered shadow on the felt below-right, the card (tilted with
 * RotSprite, never ctx.rotate), and a gold ring (glowing) when it wins.
 * Mid-flip (turn < 1) it's a narrowing plain card: no glyph is ever squashed.
 */
export function drawCardAt(fine: Ctx, card: Card | 'back', cx: number, cy: number, k: number, opts: { turn?: number; tilt?: number; win?: boolean; glow?: number } = {}) {
  const turn = opts.turn ?? 1;
  const art = cardArt(turn < 0.5 ? 'back' : card, 'flat');
  if (!art) return;
  if (turn < 1 && card !== 'back') {
    const w = Math.max(1, Math.round(art.width * Math.abs(Math.cos(turn * Math.PI)))) * k;
    const h = art.height * k;
    const x = Math.round(cx * FINE - w / 2);
    const y = Math.round(cy * FINE - h / 2);
    fine.fillStyle = '#8d8579';
    fine.fillRect(x, y, w, h);
    fine.fillStyle = turn < 0.5 ? '#c8352b' : '#f4ead5';
    if (w > 2 * k) fine.fillRect(x + k, y + k, w - 2 * k, h - 2 * k);
    return;
  }
  const rot = opts.tilt ? rotSprite(art, opts.tilt) : null;
  const img = rot?.canvas ?? art;
  const x = Math.round(cx * FINE - (rot ? rot.cx : art.width / 2) * k);
  const y = Math.round(cy * FINE - (rot ? rot.cy : art.height / 2) * k);
  const shadow = silhouette(img, SHADOW, 'dither');
  if (shadow) {
    fine.globalAlpha = 0.5;
    fine.drawImage(shadow, x + k, y + 2 * k, img.width * k, img.height * k);
    fine.globalAlpha = 1;
  }
  fine.drawImage(img, x, y, img.width * k, img.height * k);
  if (opts.win) {
    const ring = silhouette(img, GOLD, 'ring');
    if (ring) fine.drawImage(ring, x - k, y - k, ring.width * k, ring.height * k);
    const outer = ring && opts.glow ? silhouette(ring, GOLD, 'ring') : null;
    if (outer) {
      fine.globalAlpha = opts.glow!;
      fine.drawImage(outer, x - 2 * k, y - 2 * k, outer.width * k, outer.height * k);
      fine.globalAlpha = 1;
    }
  }
}

/** An empty board place: a faint outline of the same card shape. */
function drawSlot(fine: Ctx, cx: number, cy: number, k: number) {
  const art = cardArt('back', 'flat');
  const ring = art && silhouette(art, '#dff5e9', 'ring');
  if (!ring) return;
  fine.globalAlpha = 0.35;
  fine.drawImage(ring, Math.round(cx * FINE - (art.width / 2) * k) - k, Math.round(cy * FINE - (art.height / 2) * k) - k, ring.width * k, ring.height * k);
  fine.globalAlpha = 1;
}

/** Where the pot sits: in front of the board (toward me), a little right of centre, its chips clear of the cards. */
export function potSpot(cam: Camera): Vec {
  return remember(cam, 'pot', () => findPotSpot(cam));
}
function findPotSpot(cam: Camera): Vec {
  const slots = boardSlots(cam);
  const edge = slots[0].cy + flatCard(cam).h / 2 + 3;
  const x = 0.32;
  for (let z = BOARD_Z; z > -0.5; z -= 0.01) if (chipsExtent(cam, 1000, { x, z }, WEALTH.bet, PILES.bet).top >= edge) return { x, z };
  return { x, z: BOARD_Z - 0.25 };
}

/** The board's five places (scene pixels): the same size, an even gap, centred on the table like a dealer's line. */
export function boardSlots(cam: Camera): { cx: number; cy: number; k: number }[] {
  return remember(cam, 'slots', () => makeSlots(cam));
}
function makeSlots(cam: Camera): { cx: number; cy: number; k: number }[] {
  const { k, w } = flatCard(cam);
  const mid = project(cam, 0, 0, BOARD_Z);
  const gap = (3 * k) / FINE;
  const left = Math.round((mid.x - (5 * w + 4 * gap) / 2) * FINE) / FINE;
  const cy = Math.round(mid.y * FINE) / FINE;
  return Array.from({ length: 5 }, (_, i) => ({ cx: left + i * (w + gap) + w / 2, cy, k }));
}

export const boardSlotX = (i: number) => (i - 2) * (BOARD_CARD.w + BOARD_CARD.gap);

/* ---------------------------------- chips --------------------------------- */

const CHIP_R = 0.026;

/** A chip's face seen from above, `rx` across its radius, coloured; made once per colour and size. */
const faces = new Map<string, HTMLCanvasElement | null>();
function chipFace(value: number, rx: number): HTMLCanvasElement | null {
  const key = `${value}|${rx}`;
  if (!faces.has(key)) {
    const d = Math.max(2, rx * 2);
    const c = offscreen(d, d);
    if (c) {
      const t = c.getContext('2d')!;
      const den = denom(value);
      const colors: Record<string, string> = { o: INK, b: den.face, i: den.stripe, r: den.stripe };
      chipFaceRows(d).forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          t.fillStyle = colors[ch];
          t.fillRect(x, y, 1, 1);
        }),
      );
    }
    faces.set(key, c);
  }
  return faces.get(key)!;
}

/**
 * A tower of `count` chips in screen space: base centre (x, y), radii, and
 * `th` pixels per chip. Each chip is a short cylinder whose side shows the edge
 * inserts as light blocks, with a darker line under it so the chips can be
 * counted; the top chip shows its face.
 */
export function drawTower(
  ctx: Ctx,
  t: { x: number; y: number; rx: number; ry: number; th: number; count: number; value: number; shadow?: boolean },
) {
  const d = denom(t.value);
  const { rx, ry, th } = t;
  const x = Math.round(t.x);
  const base = Math.round(t.y);
  const top = base - t.count * th;
  if (t.shadow !== false) {
    ctx.globalAlpha = 0.35;
    fillEllipse(ctx, x + 1, base + 1, rx + 1, ry + 1, INK);
    ctx.globalAlpha = 1;
  }
  // Ink outline round the whole tower.
  fillEllipse(ctx, x, base, rx + 1, ry + 1, INK);
  ctx.fillStyle = INK;
  ctx.fillRect(x - rx - 1, top, 2 * rx + 2, base - top);
  // The bottom curve of the lowest chip.
  fillEllipse(ctx, x, base, rx, ry, d.side);
  // Inserts across the front of the side, at 60° steps round the chip; every other chip turned a little.
  const insertW = Math.max(1, Math.round(rx * 0.3));
  for (let k = 0; k < t.count; k++) {
    const y = base - (k + 1) * th;
    ctx.fillStyle = d.side;
    ctx.fillRect(x - rx, y, 2 * rx, th);
    ctx.fillStyle = d.sideStripe;
    const turn = k % 2 ? 30 : 0;
    for (const a of [-60, 0, 60]) {
      const angle = ((a + turn) * Math.PI) / 180;
      const cx = x + Math.sin(angle) * rx * 0.85;
      if (Math.abs(Math.sin(angle)) > 0.97) continue;
      ctx.fillRect(Math.round(cx - insertW / 2), y, insertW, Math.max(1, th - 1));
    }
    // A darker line under each chip, so they can be counted.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = INK;
    ctx.fillRect(x - rx, y + th - 1, 2 * rx, 1);
    ctx.globalAlpha = 1;
  }
  // The top chip's face.
  const face = chipFace(t.value, rx);
  if (face) ctx.drawImage(face, x - rx, top - ry, 2 * rx, Math.max(2, 2 * ry));
  else fillEllipse(ctx, x, top, rx, ry, d.face);
}

/** How a chip at this spot looks on screen: radii, and 3 pixels a chip near me (2 further away). */
function chipShape(cam: Camera, x: number, z: number) {
  const base = project(cam, x, 0, z);
  const back = project(cam, x, 0, z + CHIP_R);
  const front = project(cam, x, 0, z - CHIP_R);
  const rx = Math.max(2, Math.round(CHIP_R * base.s));
  return { x: base.x, y: base.y, rx, ry: Math.max(1, Math.round((front.y - back.y) / 2)), th: rx >= 8 ? 3 : 2 };
}

/**
 * Towers for a pile, placed on the felt round `at`: biggest values in the back
 * row, `cols` towers a row, back to front.
 */
/** How a pile is stacked: towers across, chips a tower, and the most chips drawn (any more show only in the label). */
export interface PileShape {
  cols: number;
  perTower: number;
  max: number;
}
export const PILES = {
  stack: { cols: 3, perTower: PER_TOWER.stack, max: WEALTH.opponent },
  myStack: { cols: 4, perTower: PER_TOWER.stack, max: WEALTH.me },
  bet: { cols: 2, perTower: PER_TOWER.bet, max: WEALTH.bet },
} satisfies Record<string, PileShape>;

function pileLayout(amount: number, at: Vec, target: number | undefined, pile: PileShape) {
  const { cols, perTower } = pile;
  const { towers, undrawn } = chipTowers(amount, { target: target === undefined ? undefined : Math.min(target, pile.max), perTower, maxChips: pile.max });
  const n = towers.length;
  const perRow = Math.max(1, Math.min(n, cols));
  const rows = Math.ceil(n / perRow);
  const step = CHIP_R * 2.35;
  const placed = towers.map((t, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    // Row 0 (the biggest values) is the furthest from me.
    return { t, x: at.x + (col - (inRow - 1) / 2) * step, z: at.z + ((rows - 1) / 2 - row) * step * 0.95 };
  });
  return { placed, undrawn, rows, perRow, step };
}

export function drawChips(ctx: Ctx, cam: Camera, amount: number, at: Vec, target: number | undefined, pile: PileShape = PILES.bet) {
  const { placed } = pileLayout(amount, at, target, pile);
  placed.sort((a, b) => b.z - a.z);
  for (const p of placed) {
    const shape = chipShape(cam, p.x, p.z);
    const img = towerImage(p.t.value, p.t.count, shape.rx, shape.ry, shape.th);
    if (img) ctx.drawImage(img.canvas, Math.round(shape.x) - img.ox, Math.round(shape.y) - img.oy);
    else drawTower(ctx, { ...shape, count: p.t.count, value: p.t.value });
  }
}

/** Each tower (colour, height, size) is drawn once into a small canvas and reused. */
const towers = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number } | null>();
function towerImage(value: number, count: number, rx: number, ry: number, th: number) {
  const key = `${value}|${count}|${rx}|${ry}|${th}`;
  if (!towers.has(key)) {
    if (towers.size > 1200) towers.clear();
    const ox = rx + 3;
    const h = count * th + 2 * ry + 6;
    const canvas = offscreen(2 * rx + 6, h);
    if (canvas) drawTower(canvas.getContext('2d')!, { x: ox, y: h - ry - 3, rx, ry, th, count, value });
    towers.set(key, canvas ? { canvas, ox, oy: h - ry - 3 } : null);
  }
  return towers.get(key)!;
}

/** Where a pile is drawn on screen (its base, top and sides), for placing its label. */
export function chipsExtent(
  cam: Camera,
  amount: number,
  at: Vec,
  target?: number,
  pile: PileShape = PILES.bet,
): { x: number; top: number; bottom: number; left: number; right: number } {
  const { placed } = pileLayout(amount, at, target, pile);
  if (!placed.length) {
    const p = project(cam, at.x, 0, at.z);
    return { x: p.x, top: p.y, bottom: p.y, left: p.x, right: p.x };
  }
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of placed) {
    const sh = chipShape(cam, p.x, p.z);
    left = Math.min(left, sh.x - sh.rx - 1);
    right = Math.max(right, sh.x + sh.rx + 1);
    top = Math.min(top, sh.y - p.t.count * sh.th - sh.ry);
    bottom = Math.max(bottom, sh.y + sh.ry + 1);
  }
  return { x: (left + right) / 2, top, bottom, left, right };
}

export type Box = { left: number; right: number; top: number; bottom: number };
export const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Where a pile actually goes: its spot, unless it would cover a person (their
 * body, face or forearms). Then it slides further onto the felt, a step at a
 * time, and if it still touches, its towers get shorter.
 */
export function placePile(cam: Camera, amount: number, at: Vec, target: number | undefined, pile: PileShape, seat: SeatSpot, people: Box[]): { at: Vec; pile: PileShape } {
  const key = `pile|${amount}|${at.x},${at.z}|${target}|${pile.cols},${pile.perTower},${pile.max}|${seat.x},${seat.z}|${people.map((b) => b.left + ',' + b.top).join(';')}`;
  return remember(cam, key, () => findPile(cam, amount, at, target, pile, seat, people));
}
function findPile(cam: Camera, amount: number, at: Vec, target: number | undefined, pile: PileShape, seat: SeatSpot, people: Box[]): { at: Vec; pile: PileShape } {
  const clear = (spot: Vec, shape: PileShape) => !people.some((b) => overlaps(chipsExtent(cam, amount, spot, target, shape), b));
  if (amount <= 0 || clear(at, pile)) return { at, pile };
  for (const shape of [pile, { ...pile, perTower: Math.max(2, Math.ceil(pile.perTower / 2)), cols: pile.cols + 1 }]) {
    for (let step = 1; step <= 8; step++) {
      const spot = { x: at.x - seat.nx * 0.025 * step, z: at.z - seat.nz * 0.025 * step };
      if (clear(spot, shape)) return { at: spot, pile: shape };
    }
  }
  return { at, pile };
}

/** The boxes piles must keep clear of: every opponent, from the head to the forearms. */
export const peopleBoxes = (cam: Camera, seats: { seat: SeatSpot; me: boolean }[]): Box[] =>
  remember(cam, `people|${seats.map((s) => (s.me ? 'me' : `${s.seat.x},${s.seat.z}`)).join(';')}`, () => seats.filter((s) => !s.me).map((s) => personBounds(cam, s.seat)));

/* ------------------------------ table markers ------------------------------ */

const MARKERS = {
  D: { face: '#f4ead5', side: '#c9bea6', ink: INK, text: 'D' },
  SB: { face: '#9ec5ff', side: '#5f86c4', ink: INK, text: 'SB' },
  BB: { face: '#f5b83d', side: '#b07f1f', ink: INK, text: 'BB' },
};
export type Marker = keyof typeof MARKERS;

/** The dealer button (or a blind marker): a small thick disc lying on the felt, its letters on top. */
function drawMarker(ctx: Ctx, cam: Camera, kind: Marker, at: Vec) {
  const m = MARKERS[kind];
  const base = project(cam, at.x, 0, at.z);
  const r = kind === 'D' ? 0.032 : 0.028;
  const letters = [...m.text];
  const w = letters.length * 4 - 1;
  // Never smaller than its letters (3×5 each, 1 apart) plus a pixel of face all round.
  const rx = Math.max(Math.ceil(w / 2) + 2, Math.round(r * base.s));
  const back = project(cam, at.x, 0, at.z + r);
  const front = project(cam, at.x, 0, at.z - r);
  const ry = Math.max(4, Math.round((front.y - back.y) / 2));
  const x = Math.round(base.x);
  const y = Math.round(base.y);
  const th = 3;
  ctx.globalAlpha = 0.35;
  fillEllipse(ctx, x + 1, y + 1, rx + 1, ry + 1, INK);
  ctx.globalAlpha = 1;
  fillEllipse(ctx, x, y, rx + 1, ry + 1, INK);
  ctx.fillStyle = INK;
  ctx.fillRect(x - rx - 1, y - th, 2 * rx + 2, th);
  fillEllipse(ctx, x, y - th, rx + 1, ry + 1, INK);
  fillEllipse(ctx, x, y, rx, ry, m.side);
  ctx.fillStyle = m.side;
  ctx.fillRect(x - rx, y - th, 2 * rx, th);
  fillEllipse(ctx, x, y - th, rx, ry, m.face);
  // Letters, upright and unsquashed, centred on the top.
  letters.forEach((l, k) => stamp(ctx, LETTERS[l], x - Math.floor(w / 2) + k * 4, y - th - 2, m.ink));
}

/* ---------------------------------- table --------------------------------- */

const RAIL_TOP = '#8a5a34';
const RAIL_LIGHT = '#b07a48';
const RAIL_DARK = '#3b2314';

function drawTable(ctx: Ctx, cam: Camera) {
  const felt = TABLE_R - RAIL_W;
  // Shadow under the table.
  ctx.globalAlpha = 0.5;
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R + 0.05, 96), -0.06)], INK);
  ctx.globalAlpha = 1;
  // Rail: the dark outer side, the felt, the rail's inner wall, its padded top and a highlight.
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R + 0.01, 96), -0.02)], RAIL_DARK);
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R, 96), 0)], '#4a2c19');
  fillPolys(ctx, [onScreen(cam, stadium(felt, 96), 0)], feltPattern(ctx));
  fillPolys(ctx, [onScreen(cam, stadium(felt, 96), RAIL_H), onScreen(cam, stadium(felt, 96), 0)], RAIL_DARK);
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R, 96), RAIL_H), onScreen(cam, stadium(felt, 96), RAIL_H)], RAIL_TOP);
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R - 0.022, 96), RAIL_H), onScreen(cam, stadium(TABLE_R - 0.045, 96), RAIL_H)], RAIL_LIGHT);
  // The betting line.
  ctx.globalAlpha = 0.28;
  plotLine(ctx, onScreen(cam, stadium(felt - 0.13, 120), 0), '#dff5e9', true);
  ctx.globalAlpha = 1;
}

/** Only the near part of the rail (my side), drawn again over anything on the felt it hides. */
const NEAR_Z = -0.4;
function drawNearRail(ctx: Ctx, cam: Camera) {
  const felt = TABLE_R - RAIL_W;
  // One continuous run round my side: from where the outline crosses NEAR_Z on the right, through the middle, to the left.
  const near = (r: number, y: number) => {
    const total = stadiumLength(r);
    let a = 0;
    while (a < total / 2 && stadiumAt(r, a).z < NEAR_Z) a += total / 400;
    return onScreen(cam, Array.from({ length: 81 }, (_, i) => stadiumAt(r, -a + (2 * a * i) / 80)), y);
  };
  const band = (outer: number, inner: number, color: string) => fillPolys(ctx, [[...near(outer, RAIL_H), ...near(inner, RAIL_H).reverse()]], color);
  fillPolys(ctx, [[...near(TABLE_R + 0.01, -0.02), ...near(TABLE_R, RAIL_H).reverse()]], RAIL_DARK);
  band(TABLE_R, felt, RAIL_TOP);
  band(TABLE_R - 0.022, TABLE_R - 0.045, RAIL_LIGHT);
}

/** The table and its near rail never change for a camera: each is drawn once per size and reused. */
const tables = new WeakMap<Camera, { table: HTMLCanvasElement; near: HTMLCanvasElement } | null>();
function tableImages(cam: Camera) {
  if (!tables.has(cam)) {
    const table = offscreen(cam.w, cam.h);
    const near = offscreen(cam.w, cam.h);
    if (table && near) {
      drawTable(table.getContext('2d')!, cam);
      drawNearRail(near.getContext('2d')!, cam);
    }
    tables.set(cam, table && near ? { table, near } : null);
  }
  return tables.get(cam)!;
}

/* --------------------------------- people --------------------------------- */

/** Where an opponent sits on screen: the rail-top point their arms rest on, and their sprite height in pixels. */
export function personAt(cam: Camera, seat: SeatSpot): { x: number; y: number; height: number } {
  const r = railPoint(seat);
  const p = project(cam, r.x, RAIL_H, r.z);
  return { x: p.x, y: p.y, height: Math.max(18, Math.min(80, Math.round(PERSON_H * p.s * (62 / 48)))) };
}

/** Which way a seat's person turns: toward the middle at the rounded ends. */
/** The screen box a seated person covers above the table: from the top of the head to the forearms on the rail. */
export function personBounds(cam: Camera, seat: SeatSpot): Box {
  const at = personAt(cam, seat);
  const { k, w, railY } = spriteMetrics(at.height);
  const left = Math.round(at.x - w / 2);
  const top = Math.round(at.y - railY);
  // Forearms on the rail and their shadow reach a few rows below it.
  return { left, right: left + w, top: top + k, bottom: Math.round(at.y) + 5 * k };
}

const turnOf = (seat: SeatSpot): -1 | 0 | 1 => (seat.nx < -0.45 ? 1 : seat.nx > 0.45 ? -1 : 0);

/* ---------------------------------- scene --------------------------------- */

export interface SceneSeat {
  id: string;
  seat: SeatSpot;
  me: boolean;
  /** Face seed (id + name) and whether it's a computer player's robot face. */
  seed: string;
  robot: boolean;
  pose: Pose;
  /** Cards in their hands (2, or 4 for Omaha) while they hold them. */
  held: number;
  /** Cards turned face up on the felt at showdown. */
  shown: Card[] | null;
  stack: number;
  bet: number;
  /** How many chips to draw for the stack and the bet (relative wealth). */
  stackChips: number;
  betChips: number;
  /** D, SB and BB markers in front of them. */
  markers: Marker[];
  acting: boolean;
}

export interface SceneData {
  seats: SceneSeat[];
  /** Up to five board cards: a card, 'back' (cardless tables, dealt) or null (empty slot). */
  board: (Card | 'back' | null)[];
  winning: Set<string>;
  pot: number;
  potChips: number;
  /** Where new board cards are dealt from. */
  dealerSeat: SeatSpot | null;
  /** My hands: what they're doing, the cards in them, and the card width. Null for spectators. */
  hands: { mode: HandsMode; cards: Card[]; count: number; cw: number } | null;
  /** Where my chips sit (the felt between my hands and the middle), and how tall my towers may be there. */
  myZ: number;
  /** 0–1: the winning cards glowing after a showdown. */
  glow?: number;
  /** My hands pushed or raised by an animation (pixels; negative is up). */
  handsLift?: number;
  /** Bets left out of the static piles because an animation is moving them (player id → chips). */
  moving?: Map<string, number>;
}

export interface Motion {
  /** Board index → when its deal started (ms). */
  dealt: Map<number, number>;
  /** Bets sliding into the pot. */
  sweeps: { from: Vec; amount: number; chips: number; start: number }[];
  /** Folded cards flying into the middle, from a point on screen. */
  folds: { from: Pt; count: number; start: number; size: number }[];
}

export const DEAL_MS = 650;
export const SWEEP_MS = 450;
export const FOLD_MS = 500;

const ease = (t: number) => 1 - (1 - t) ** 2;

/** A small card back flying from `from` toward the middle, shrinking as it goes. */
function drawFlyingBack(ctx: Ctx, from: Pt, to: Pt, t: number, size: number, k: number) {
  const e = ease(t);
  const w = Math.max(2, Math.round(size * (1 - 0.6 * e)));
  const h = Math.max(3, Math.round(w * 1.4));
  const x = Math.round(from.x + (to.x - from.x) * e + k * w * 0.4 - w / 2);
  const y = Math.round(from.y + (to.y - from.y) * e - Math.sin(e * Math.PI) * size * 0.8 - h / 2);
  ctx.globalAlpha = 1 - e * 0.7;
  ctx.fillStyle = INK;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = BONE;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e2483d';
  if (w > 3) ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.globalAlpha = 1;
}

/** Screen rectangle of my hands (internal pixels), bottom centre of the canvas. */
export function handsBox(cam: Camera, hands: NonNullable<SceneData['hands']>): { x: number; y: number; w: number; h: number } {
  const { w, h } = handsSize(hands.cw, hands.count);
  return { x: Math.round(cam.w / 2 - w / 2), y: cam.h - h, w, h };
}

/** Where a seat's D/SB/BB markers lie: beside their stack, along the rail. */
function markerSpot(seat: SeatSpot, me: boolean, myZ: number, k: number): Vec {
  if (me) return { x: 0.2 + k * 0.075, z: myZ + 0.02 };
  const at = onFelt(seat, 0.08);
  // Along the rail (perpendicular to the seat's normal), to the seat's right as seen from the middle.
  const tx = -seat.nz;
  const tz = seat.nx;
  return { x: at.x + tx * (0.16 + k * 0.07), z: at.z + tz * (0.16 + k * 0.07) };
}

export function drawScene(
  ctx: Ctx,
  cam: Camera,
  data: SceneData,
  motion: Motion,
  now: number,
  idleOf: (seed: string) => { bob: number; blink: boolean; tilt: boolean },
  overlay?: { felt: () => void; fine?: (fine: Ctx) => void; top: () => void; shake: { x: number; y: number } },
  /** The fine layer, at twice the scene's resolution: cards and my hands. */
  fineLayer?: Ctx | null,
) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cam.w, cam.h);
  const fine = fineLayer ?? ctx;
  if (fineLayer) {
    fineLayer.imageSmoothingEnabled = false;
    fineLayer.clearRect(0, 0, cam.w * FINE, cam.h * FINE);
    fineLayer.save();
    if (overlay) fineLayer.translate(overlay.shake.x * FINE, overlay.shake.y * FINE);
  }
  // Cards go on the fine layer, after the scene: the board, then shown cards back to front.
  const fineItems: { z: number; draw: () => void }[] = [];
  ctx.save();
  // A tiny screen shake (an all-in).
  if (overlay) ctx.translate(overlay.shake.x, overlay.shake.y);

  // 1. Opponents (with their chairs) behind the table, far ones first.
  const people = data.seats
    .filter((s) => !s.me)
    .map((s) => {
      const at = personAt(cam, s.seat);
      const look = idleOf(s.seed);
      const sprite = personSprite({ seed: s.seed, robot: s.robot, pose: s.pose, cards: s.held, blink: look.blink, tilt: look.tilt, turn: turnOf(s.seat), height: at.height });
      const { w, railY } = spriteMetrics(at.height);
      const x = Math.round(at.x - w / 2);
      const y = Math.round(at.y - railY);
      return { s, sprite, x, y, bob: s.pose === 'out' ? 0 : look.bob, z: railPoint(s.seat).z };
    })
    .sort((a, b) => b.z - a.z);
  for (const p of people) if (p.sprite) ctx.drawImage(p.sprite.body, p.x, p.y + p.bob);

  // 2. The table: far rail and felt cover their bodies from the chest down.
  const images = tableImages(cam);
  if (images) ctx.drawImage(images.table, 0, 0);
  else drawTable(ctx, cam);

  // 3. Their forearms and hands resting on the rail, holding their cards.
  for (const p of people) if (p.sprite) ctx.drawImage(p.sprite.arms, p.x, p.y);

  // Whose turn: a pulsing gold ring on the felt in front of them.
  const acting = data.seats.find((s) => s.acting);
  if (acting) {
    const c = acting.me ? { x: 0, z: data.myZ + 0.07 } : onFelt(acting.seat, (STACK_INSET + BET_INSET) / 2);
    const ring: Vec[] = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: c.x + Math.cos(a) * 0.17, z: c.z + Math.sin(a) * 0.13 };
    });
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 180);
    plotLine(ctx, onScreen(cam, ring, 0), GOLD, true, 2);
    ctx.globalAlpha = 1;
  }

  // 4. Everything on the felt, back to front.
  const items: { z: number; draw: () => void }[] = [];
  const onTop: (() => void)[] = [];
  const slots = boardSlots(cam);
  data.board.forEach((card, i) => {
    const slot = slots[i];
    const started = motion.dealt.get(i);
    const t = started === undefined ? 1 : Math.min(1, (now - started) / DEAL_MS);
    const empty = () => drawSlot(fine, slot.cx, slot.cy, slot.k);
    if (!card || t <= 0) {
      fineItems.push({ z: 10, draw: empty });
      return;
    }
    if (t < 1 && data.dealerSeat) {
      // Slides in from the dealer for the first 60% (lifting a little on the way), then flips over.
      const from = project(cam, onFelt(data.dealerSeat, 0.05).x, 0, onFelt(data.dealerSeat, 0.05).z);
      const slide = ease(Math.min(1, t / 0.6));
      const turn = card === 'back' ? 0 : Math.max(0, (t - 0.6) / 0.4);
      fineItems.push({ z: 10, draw: empty });
      fineItems.push({
        z: -10,
        draw: () =>
          drawCardAt(fine, card === 'back' ? 'back' : card, from.x + (slot.cx - from.x) * slide, from.y + (slot.cy - from.y) * slide - 6 * Math.sin(slide * Math.PI), slot.k, { turn }),
      });
      return;
    }
    const win = card !== 'back' && data.winning.has(card);
    fineItems.push({ z: 10, draw: () => drawCardAt(fine, card, slot.cx, slot.cy, slot.k, { win, glow: win ? (data.glow ?? 0) : 0 }) });
  });

  const clearOf = peopleBoxes(cam, data.seats);
  for (const s of data.seats) {
    const spot = spots(s.seat, s.me, data.myZ);
    const stack = placePile(cam, s.stack, spot.stack, s.stackChips, s.me ? PILES.myStack : PILES.stack, s.seat, clearOf);
    if (s.stack > 0) items.push({ z: stack.at.z, draw: () => drawChips(ctx, cam, s.stack, stack.at, s.stackChips, stack.pile) });
    // Chips an animation is moving are drawn by it, not here.
    const betShown = s.bet - (data.moving?.get(s.id) ?? 0);
    const bet = placePile(cam, betShown, spot.bet, s.betChips, PILES.bet, s.seat, clearOf);
    if (betShown > 0) items.push({ z: bet.at.z, draw: () => drawChips(ctx, cam, betShown, bet.at, s.betChips, bet.pile) });
    s.markers.forEach((m, k) => {
      const at = markerSpot(s.seat, s.me, data.myZ, k);
      items.push({ z: at.z, draw: () => drawMarker(ctx, cam, m, at) });
    });
    // Shown cards, face up on the felt where they were thrown (the bets are in the pot by showdown).
    if (s.shown) {
      const glow = data.glow ?? 0;
      for (const c of shownSpots(cam, data, s, s.shown)) {
        const win = data.winning.has(c.card);
        fineItems.push({ z: -c.cy, draw: () => drawCardAt(fine, c.card, c.cx, c.cy, c.k, { tilt: c.tilt, win, glow: win ? glow : 0 }) });
      }
    }
  }
  const pot = potSpot(cam);
  if (data.pot > 0) items.push({ z: pot.z, draw: () => drawChips(ctx, cam, data.pot, pot, data.potChips) });
  for (const sw of motion.sweeps) {
    const t = ease(Math.min(1, (now - sw.start) / SWEEP_MS));
    const at = { x: sw.from.x + (pot.x - sw.from.x) * t, z: sw.from.z + (pot.z - sw.from.z) * t };
    items.push({ z: at.z, draw: () => drawChips(ctx, cam, sw.amount, at, sw.chips) });
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();
  for (const d of onTop) d();

  // Things in motion: sliding chips, thrown cards.
  overlay?.felt();

  // 5. The near rail, over anything on the felt it hides.
  if (images) ctx.drawImage(images.near, 0, 0);

  // Folded cards flying into the middle.
  const middle = project(cam, 0, 0, BOARD_Z);
  for (const f of motion.folds) {
    const t = (now - f.start) / FOLD_MS;
    if (t < 0 || t >= 1) continue;
    for (let k = 0; k < f.count; k++) drawFlyingBack(ctx, f.from, middle, Math.min(1, t + k * 0.05), f.size, k - (f.count - 1) / 2);
  }

  // 6. On the fine layer: the board and shown cards, cards in flight, then my hands, nearest of all.
  fineItems.sort((a, b) => b.z - a.z);
  for (const it of fineItems) it.draw();
  overlay?.fine?.(fine);
  if (data.hands) {
    const box = handsBox(cam, data.hands);
    const k = handsScale(data.hands.cw);
    // Resting hands lie on the near rail. Idle: a slow breath, and now and then a thumb shifting its grip.
    const rail = project(cam, 0, RAIL_H, -TABLE_R + RAIL_W / 2).y;
    const calm = idleOf('my hands');
    const sprite = handsSprite({ ...data.hands, restAt: Math.round((FINE * (rail - box.y)) / k), thumb: calm.tilt });
    if (sprite) {
      const lift = Math.round((data.handsLift ?? 0) * FINE) + calm.bob * k;
      fine.drawImage(
        sprite,
        Math.round(FINE * box.x + (FINE * box.w - sprite.width * k) / 2),
        FINE * (box.y + box.h) - sprite.height * k + lift,
        sprite.width * k,
        sprite.height * k,
      );
    }
  }
  if (fineLayer) fineLayer.restore();

  // Badges and anything else over the whole scene.
  overlay?.top();
  ctx.restore();
}

/**
 * Where a seat's shown cards lie (scene pixels): side by side at their spot
 * with a small random tilt, moved, if they'd cover them, clear of that seat's
 * chips, the board and the people: in toward the middle, along the rail
 * (toward me first), or back out.
 */
export function shownSpots(cam: Camera, data: SceneData, s: SceneSeat, cards: Card[]): { card: Card; cx: number; cy: number; tilt: number; k: number }[] {
  const key = `shown|${s.id}|${cards.join('')}|${s.stack}|${s.stackChips}|${data.myZ}|${data.seats.map((x) => x.id).join(',')}`;
  return remember(cam, key, () => findShown(cam, data, s, cards));
}
function findShown(cam: Camera, data: SceneData, s: SceneSeat, cards: Card[]): { card: Card; cx: number; cy: number; tilt: number; k: number }[] {
  // A step smaller than the board (still readable), so a hand fits beside its owner's chips.
  const board = flatCard(cam);
  const k = Math.max(1, board.k - 1);
  const w = (CARD_ART.flat.w * k) / FINE;
  const h = (CARD_ART.flat.h * k) / FINE;
  const spot = s.me ? myShowSpot(data.myZ) : onFelt(s.seat, BET_INSET - 0.07 + 0.1 * Math.abs(s.seat.nx));
  const n = cards.length;
  // Four (Omaha) overlap enough to fit, each corner index still showing.
  const step = n > 2 ? w * 0.62 : w + 2;
  const lay = (dx: number, dz: number) => {
    const p = project(cam, spot.x + dx, 0, spot.z + dz);
    return cards.map((card, i) => ({ card, cx: p.x + (i - (n - 1) / 2) * step, cy: p.y, tilt: (hashText(s.id + card) % 11) - 5, k }));
  };
  const box = (c: { cx: number; cy: number }): Box => ({ left: c.cx - w / 2 - 2, right: c.cx + w / 2 + 2, top: c.cy - h / 2 - 2, bottom: c.cy + h / 2 + 2 });
  const slots = boardSlots(cam);
  const line: Box = { left: slots[0].cx - board.w / 2 - 2, right: slots[4].cx + board.w / 2 + 2, top: slots[0].cy - board.h / 2 - 2, bottom: slots[0].cy + board.h / 2 + 2 };
  const avoid = [line, ...peopleBoxes(cam, data.seats)];
  if (s.stack > 0) {
    const stack = placePile(cam, s.stack, spots(s.seat, s.me, data.myZ).stack, s.stackChips, s.me ? PILES.myStack : PILES.stack, s.seat, peopleBoxes(cam, data.seats));
    avoid.push(chipsExtent(cam, s.stack, stack.at, s.stackChips, stack.pile));
  }
  const { nx, nz } = s.seat;
  const side = nx >= 0 ? { x: nz, z: -nx } : { x: -nz, z: nx };
  const dirs = [{ x: -nx, z: -nz }, side, { x: -side.x, z: -side.z }, { x: nx, z: nz }];
  for (let step = 0; step <= 12; step++)
    for (const d of step ? dirs : dirs.slice(0, 1)) {
      const placed = lay(d.x * 0.025 * step, d.z * 0.025 * step);
      if (!placed.some((c) => avoid.some((b) => overlaps(box(c), b)))) return placed;
    }
  return lay(0, 0);
}

/* ------------------------------- labels' anchors ------------------------------ */

/** Screen spots (internal pixels) for a seat's DOM labels: above the head, and beside the stack and bet. */
export function seatAnchors(
  cam: Camera,
  s: { seat: SeatSpot; me: boolean; stack: number; bet: number; stackChips: number; betChips: number },
  myZ: number,
  people: Box[] = [],
) {
  const spot = spots(s.seat, s.me, myZ);
  const stackAt = placePile(cam, s.stack, spot.stack, s.stackChips, s.me ? PILES.myStack : PILES.stack, s.seat, people);
  const betAt = placePile(cam, s.bet, spot.bet, s.betChips, PILES.bet, s.seat, people);
  const person = personAt(cam, s.seat);
  // The top of the head: the sprite's top edge plus its one row of headroom.
  const { k, railY } = spriteMetrics(person.height);
  const top = Math.round(person.y - railY) + k;
  return {
    head: { x: person.x, y: top },
    size: person.height,
    stack: chipsExtent(cam, s.stack, stackAt.at, s.stackChips, stackAt.pile),
    bet: chipsExtent(cam, s.bet, betAt.at, s.betChips, betAt.pile),
  };
}
