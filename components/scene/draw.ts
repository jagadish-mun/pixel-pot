/*
 * Drawing the table scene on a small canvas. Everything is filled with whole
 * pixels (a scanline fill, no anti-aliasing), so it stays crisp pixel art when
 * the canvas is scaled up.
 */
import { denom, chipTowers } from '@/lib/chips';
import type { Card } from '@/lib/cards';
import { BOARD_Z, BET_INSET, CARDS_INSET, POT_SPOT, STACK_INSET, onFelt, spots, type SeatSpot } from './layout';
import { BODY_H, HEAD_H, RAIL_H, RAIL_W, TABLE_R, project, stadium, type Camera, type Vec } from './project';

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

const INK = '#0c0916';
const BONE = '#f4ead5';
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

// 3×5 rank glyphs and 7×7 suit pips.
const GLYPHS: Record<string, string[]> = {
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  K: ['X.X', 'XX.', 'X..', 'XX.', 'X.X'],
  Q: ['.X.', 'X.X', 'X.X', 'XX.', '.XX'],
  J: ['..X', '..X', '..X', 'X.X', '.X.'],
  '0': ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XX.', '..X', '.X.', 'X..', 'XXX'],
  '3': ['XX.', '..X', '.X.', '..X', 'XX.'],
  '4': ['X.X', 'X.X', 'XXX', '..X', '..X'],
  '5': ['XXX', 'X..', 'XX.', '..X', 'XX.'],
  '6': ['.XX', 'X..', 'XXX', 'X.X', 'XXX'],
  '7': ['XXX', '..X', '.X.', '.X.', '.X.'],
  '8': ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
  '9': ['XXX', 'X.X', 'XXX', '..X', 'XX.'],
};
const SUITS: Record<string, string[]> = {
  h: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  d: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  s: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '...X...', '..XXX..'],
  c: ['..XXX..', '..XXX..', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'],
};

const SMALL_SUITS: Record<string, string[]> = {
  h: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  d: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..'],
  s: ['..X..', '.XXX.', 'XXXXX', 'XXXXX', '.XXX.'],
  c: ['.XXX.', '.XXX.', 'XXXXX', 'XX.XX', '.XXX.'],
};

/** Draw a pixel bitmap with its top-left at (x, y), one canvas pixel per cell. */
function stamp(ctx: Ctx, rows: string[], x: number, y: number, color: string) {
  ctx.fillStyle = color;
  x = Math.round(x);
  y = Math.round(y);
  rows.forEach((row, dy) => [...row].forEach((c, dx) => c === 'X' && ctx.fillRect(x + dx, y + dy, 1, 1)));
}

const backs = new WeakMap<Ctx, CanvasPattern>();

/** The red lattice on card backs. */
function backPattern(ctx: Ctx): CanvasPattern | string {
  const cached = backs.get(ctx);
  if (cached) return cached;
  if (typeof document === 'undefined') return '#e2483d';
  const tile = document.createElement('canvas');
  tile.width = 2;
  tile.height = 2;
  const t = tile.getContext('2d')!;
  t.fillStyle = '#e2483d';
  t.fillRect(0, 0, 2, 2);
  t.fillStyle = '#9c2a2a';
  t.fillRect(0, 0, 1, 1);
  t.fillRect(1, 1, 1, 1);
  const p = ctx.createPattern(tile, 'repeat')!;
  backs.set(ctx, p);
  return p;
}

/* ---------------------------------- cards --------------------------------- */

export const BOARD_CARD = { w: 0.12, d: 0.17, gap: 0.016 };
const SMALL_CARD = { w: 0.075, d: 0.105 };

/**
 * A card lying flat at (x, y, z), `w` across and `d` deep: a trapezoid in
 * perspective. Its rank and suit are stamped on unsquashed, so they stay
 * readable however flat the card lies. `turn` 0→1 flips it over (back, then face).
 */
function drawFlatCard(
  ctx: Ctx,
  cam: Camera,
  card: Card | 'back',
  at: { x: number; y: number; z: number },
  size: { w: number; d: number },
  opts: { turn?: number; outline?: string; shadow?: boolean } = {},
) {
  const turn = opts.turn ?? 1;
  const hw = (size.w / 2) * Math.max(0.08, Math.abs(Math.cos(turn * Math.PI)));
  const corners = (y: number, grow: number): Pt[] =>
    [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].map(([sx, sz]) => project(cam, at.x + sx * (hw + grow), y, at.z + sz * (size.d / 2 + grow)));
  if (opts.shadow !== false) {
    ctx.globalAlpha = 0.35;
    fillPolys(ctx, [corners(0, 0.008).map((p) => ({ x: p.x + 1, y: p.y + 1 }))], INK);
    ctx.globalAlpha = 1;
  }
  fillPolys(ctx, [corners(at.y, 0.005)], INK);
  fillPolys(ctx, [corners(at.y, 0)], BONE);
  const near = corners(at.y, 0);
  const widthPx = near[2].x - near[3].x;
  if (turn < 0.5 || card === 'back') {
    fillPolys(ctx, [corners(at.y, -Math.min(0.012, hw * 0.25))], backPattern(ctx));
  } else if (widthPx >= 6) {
    const red = card[1] === 'h' || card[1] === 'd';
    const color = red ? '#d8352b' : INK;
    const big = widthPx >= 15;
    // Rank in the far-left corner, the suit in the middle.
    const corner = project(cam, at.x - hw + size.w * 0.12, at.y, at.z + size.d * 0.4);
    const rank = card[0] === 'T' ? ['1', '0'] : [card[0]];
    if (big || rank.length === 1) rank.forEach((g, k) => stamp(ctx, GLYPHS[g], corner.x + k * 4, corner.y, color));
    const pip = big ? SUITS[card[1]] : SMALL_SUITS[card[1]];
    const mid = project(cam, at.x, at.y, at.z - size.d * (big ? 0.12 : 0.05));
    stamp(ctx, pip, mid.x - pip[0].length / 2, mid.y - pip.length / 2 + (big ? 0 : 1), color);
  }
  if (opts.outline) plotLine(ctx, corners(at.y, 0.008), opts.outline, true);
}

/** An empty board slot: a faint outline on the felt. */
function drawSlot(ctx: Ctx, cam: Camera, x: number, z: number) {
  const pts = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([sx, sz]) => project(cam, x + (sx * BOARD_CARD.w) / 2, 0, z + (sz * BOARD_CARD.d) / 2));
  ctx.globalAlpha = 0.35;
  plotLine(ctx, pts, '#dff5e9', true);
  ctx.globalAlpha = 1;
}

export const boardSlotX = (i: number) => (i - 2) * (BOARD_CARD.w + BOARD_CARD.gap);

/* ---------------------------------- chips --------------------------------- */

const CHIP_R = 0.028;
const CHIP_T = 0.0075;

/** Screen-space chip tower: base centre, radii, thickness per chip (all in pixels). */
export function drawTower(
  ctx: Ctx,
  t: { x: number; y: number; rx: number; ry: number; th: number; count: number; value: number; shadow?: boolean },
) {
  const d = denom(t.value);
  const { x, rx, ry, th } = t;
  const top = t.y - t.count * th;
  const detail = rx >= 4;
  if (t.shadow !== false) {
    ctx.globalAlpha = 0.35;
    fillEllipse(ctx, x + 1, t.y + 1, rx + 1, ry + 1, INK);
    ctx.globalAlpha = 1;
  }
  // Ink outline round the whole tower, then each chip bottom to top.
  if (rx >= 3) {
    fillEllipse(ctx, x, t.y, rx + 1, ry + 1, INK);
    ctx.fillRect(Math.round(x - rx - 1), Math.round(top), Math.round(2 * rx + 2), Math.round(t.y - top));
    fillEllipse(ctx, x, top, rx + 1, ry + 1, INK);
  }
  for (let k = 0; k < t.count; k++) {
    const base = t.y - k * th;
    fillEllipse(ctx, x, base, rx, ry, d.side);
    ctx.fillRect(Math.round(x - rx), Math.round(base - th), Math.round(2 * rx), Math.round(th));
    // White dashes on the edge, shifting every other chip.
    if (detail && th >= 1) {
      ctx.fillStyle = d.stripe;
      const shift = k % 2 ? 0.25 : -0.25;
      for (const f of [-0.6, 0.6].map((v) => v + shift)) ctx.fillRect(Math.round(x + f * rx), Math.round(base - th), 1, Math.max(1, Math.round(th)));
    }
    fillEllipse(ctx, x, base - th, rx, ry, d.face);
  }
  // Edge marks round the top face.
  if (detail) {
    ctx.fillStyle = d.stripe;
    const cy = Math.round(top);
    ctx.fillRect(Math.round(x - rx), cy, 1, 1);
    ctx.fillRect(Math.round(x + rx - 1), cy, 1, 1);
    ctx.fillRect(Math.round(x), Math.round(cy - ry), 1, 1);
    ctx.fillRect(Math.round(x), Math.round(cy + ry - 1), 1, 1);
    if (rx >= 6) {
      ctx.globalAlpha = 0.5;
      fillEllipse(ctx, x, cy, rx * 0.45, ry * 0.45, d.stripe);
      ctx.globalAlpha = 1;
      fillEllipse(ctx, x, cy, rx * 0.3, ry * 0.3, d.face);
    }
  }
}

/** How a chip at this spot looks on screen. */
function chipShape(cam: Camera, x: number, z: number) {
  const base = project(cam, x, 0, z);
  const back = project(cam, x, 0, z + CHIP_R);
  const front = project(cam, x, 0, z - CHIP_R);
  const up = project(cam, x, CHIP_T * 6, z);
  const rx = Math.max(2, Math.round(CHIP_R * base.s));
  return { x: base.x, y: base.y, rx, ry: Math.max(1, Math.round((front.y - back.y) / 2)), th: Math.max(1, Math.round((base.y - up.y) / 6)) };
}

/** The towers for an amount, gathered round a spot on the felt, drawn back to front. */
function drawChips(ctx: Ctx, cam: Camera, amount: number, at: Vec) {
  const { towers } = chipTowers(amount);
  const n = towers.length;
  if (!n) return;
  const cols = Math.min(n, 3);
  const rows = Math.ceil(n / cols);
  const step = CHIP_R * 2.3;
  const placed = towers.map((t, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i % cols;
    return { t, x: at.x + (col - (inRow - 1) / 2) * step, z: at.z + ((rows - 1) / 2 - row) * step * 0.9 };
  });
  placed.sort((a, b) => b.z - a.z);
  for (const p of placed) drawTower(ctx, { ...chipShape(cam, p.x, p.z), count: p.t.count, value: p.t.value });
}

/** Where a pile of chips is drawn on screen: its base and how tall it gets, for placing its label. */
export function chipsExtent(cam: Camera, amount: number, at: Vec): { x: number; top: number; bottom: number; right: number } {
  const { towers } = chipTowers(amount);
  const shape = chipShape(cam, at.x, at.z);
  const cols = Math.min(Math.max(1, towers.length), 3);
  const tallest = Math.max(1, ...towers.map((t) => t.count));
  const halfW = (cols * CHIP_R * 2.3 * project(cam, at.x, 0, at.z).s) / 2;
  return { x: shape.x, top: shape.y - tallest * shape.th - shape.ry, bottom: shape.y + shape.ry + 1, right: shape.x + halfW };
}

/* --------------------------------- people --------------------------------- */

/** A placeholder opponent: a body and a head standing behind the rail. */
function drawPerson(ctx: Ctx, cam: Camera, seat: SeatSpot, color: string, dim: boolean) {
  const base = project(cam, seat.x, 0, seat.z);
  const s = base.s;
  const bodyTop = project(cam, seat.x, BODY_H, seat.z).y;
  const headTop = project(cam, seat.x, HEAD_H, seat.z).y;
  const bw = Math.round(0.2 * s);
  const hw = Math.round(0.1 * s);
  ctx.globalAlpha = dim ? 0.45 : 1;
  const bx = Math.round(base.x - bw / 2);
  const hx = Math.round(base.x - hw / 2);
  ctx.fillStyle = INK;
  ctx.fillRect(bx - 1, Math.round(bodyTop) - 1, bw + 2, Math.round(base.y - bodyTop) + 1);
  ctx.fillRect(hx - 1, Math.round(headTop) - 1, hw + 2, Math.round(bodyTop - headTop) + 1);
  ctx.fillStyle = '#2b2440';
  ctx.fillRect(bx, Math.round(bodyTop), bw, Math.round(base.y - bodyTop));
  ctx.fillStyle = color;
  ctx.fillRect(bx + 1, Math.round(bodyTop) + 1, bw - 2, Math.max(1, Math.round((base.y - bodyTop) * 0.35)));
  ctx.fillRect(hx, Math.round(headTop), hw, Math.round(bodyTop - headTop) - 1);
  ctx.globalAlpha = 1;
}

/* ---------------------------------- table --------------------------------- */

function drawTable(ctx: Ctx, cam: Camera) {
  const felt = TABLE_R - RAIL_W;
  // Shadow under the table.
  ctx.globalAlpha = 0.5;
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R + 0.05, 96), -0.06)], INK);
  ctx.globalAlpha = 1;
  // Rail: the dark outer side, the felt, the rail's inner wall, its padded top and a highlight.
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R + 0.01, 96), -0.02)], '#3b2314');
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R, 96), 0)], '#4a2c19');
  fillPolys(ctx, [onScreen(cam, stadium(felt, 96), 0)], feltPattern(ctx));
  fillPolys(ctx, [onScreen(cam, stadium(felt, 96), RAIL_H), onScreen(cam, stadium(felt, 96), 0)], '#3b2314');
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R, 96), RAIL_H), onScreen(cam, stadium(felt, 96), RAIL_H)], '#8a5a34');
  fillPolys(ctx, [onScreen(cam, stadium(TABLE_R - 0.022, 96), RAIL_H), onScreen(cam, stadium(TABLE_R - 0.045, 96), RAIL_H)], '#b07a48');
  // The betting line.
  ctx.globalAlpha = 0.28;
  plotLine(ctx, onScreen(cam, stadium(felt - 0.13, 120), 0), '#dff5e9', true);
  ctx.globalAlpha = 1;
}

/* ---------------------------------- scene --------------------------------- */

export interface SceneSeat {
  seat: SeatSpot;
  me: boolean;
  color: string;
  /** Folded, out of the hand, or out of chips. */
  dim: boolean;
  /** Face-down cards in front of them (0 for none). */
  cards: number;
  stack: number;
  bet: number;
  acting: boolean;
}

export interface SceneData {
  seats: SceneSeat[];
  /** Up to five board cards: a card, 'back' (cardless tables, dealt) or null (empty slot). */
  board: (Card | 'back' | null)[];
  winning: Set<string>;
  pot: number;
  /** Where new board cards are dealt from. */
  dealerSeat: SeatSpot | null;
}

export interface Motion {
  /** Board index → when its deal started (ms). */
  dealt: Map<number, number>;
  /** Bets sliding into the pot. */
  sweeps: { from: Vec; amount: number; start: number }[];
}

export const DEAL_MS = 650;
export const SWEEP_MS = 450;

const ease = (t: number) => 1 - (1 - t) ** 2;

export function drawScene(ctx: Ctx, cam: Camera, data: SceneData, motion: Motion, now: number) {
  ctx.imageSmoothingEnabled = false;
  // The room is the page behind the canvas.
  ctx.clearRect(0, 0, cam.w, cam.h);

  // People behind the table, far ones first.
  const others = data.seats.filter((s) => !s.me).sort((a, b) => b.seat.z - a.seat.z);
  for (const s of others) drawPerson(ctx, cam, s.seat, s.color, s.dim);

  drawTable(ctx, cam);

  // Whose turn: a pulsing gold ring on the felt in front of them.
  const acting = data.seats.find((s) => s.acting);
  if (acting) {
    const c = onFelt(acting.seat, acting.me ? 0.2 : (STACK_INSET + BET_INSET) / 2);
    const ring: Vec[] = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: c.x + Math.cos(a) * 0.17, z: c.z + Math.sin(a) * 0.13 };
    });
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 180);
    plotLine(ctx, onScreen(cam, ring, 0), GOLD, true, 2);
    ctx.globalAlpha = 1;
  }

  // Things on the felt, back to front.
  const items: { z: number; draw: () => void }[] = [];
  const dealing: (() => void)[] = [];
  data.board.forEach((card, i) => {
    const x = boardSlotX(i);
    const started = motion.dealt.get(i);
    const t = started === undefined ? 1 : Math.min(1, (now - started) / DEAL_MS);
    if (!card || t <= 0) {
      items.push({ z: BOARD_Z, draw: () => drawSlot(ctx, cam, x, BOARD_Z) });
      return;
    }
    if (t < 1 && data.dealerSeat) {
      // Slides in from the dealer for the first 60%, then flips over.
      const from = onFelt(data.dealerSeat, CARDS_INSET);
      const slide = ease(Math.min(1, t / 0.6));
      const at = { x: from.x + (x - from.x) * slide, y: 0.06 * Math.sin(slide * Math.PI), z: from.z + (BOARD_Z - from.z) * slide };
      const turn = card === 'back' ? 0 : Math.max(0, (t - 0.6) / 0.4);
      items.push({ z: BOARD_Z, draw: () => drawSlot(ctx, cam, x, BOARD_Z) });
      dealing.push(() => drawFlatCard(ctx, cam, card === 'back' ? 'back' : card, at, BOARD_CARD, { turn }));
      return;
    }
    const win = card !== 'back' && data.winning.has(card);
    items.push({ z: BOARD_Z, draw: () => drawFlatCard(ctx, cam, card, { x, y: 0, z: BOARD_Z }, BOARD_CARD, { outline: win ? GOLD : undefined }) });
  });
  for (const s of data.seats) {
    if (s.cards && !s.me) {
      const at = spots(s.seat, false).cards;
      for (let k = 0; k < s.cards; k++) {
        const x = at.x + (k - (s.cards - 1) / 2) * SMALL_CARD.w * 0.7;
        items.push({ z: at.z + 0.001 * k, draw: () => drawFlatCard(ctx, cam, 'back', { x, y: 0.002 * k, z: at.z }, SMALL_CARD) });
      }
    }
    const { stack: stackAt, bet: betAt } = spots(s.seat, s.me);
    if (s.stack > 0) items.push({ z: stackAt.z, draw: () => drawChips(ctx, cam, s.stack, stackAt) });
    if (s.bet > 0) items.push({ z: betAt.z, draw: () => drawChips(ctx, cam, s.bet, betAt) });
  }
  if (data.pot > 0) items.push({ z: POT_SPOT.z, draw: () => drawChips(ctx, cam, data.pot, POT_SPOT) });
  for (const sw of motion.sweeps) {
    const t = ease(Math.min(1, (now - sw.start) / SWEEP_MS));
    const at = { x: sw.from.x + (POT_SPOT.x - sw.from.x) * t, z: sw.from.z + (POT_SPOT.z - sw.from.z) * t };
    items.push({ z: at.z, draw: () => drawChips(ctx, cam, sw.amount, at) });
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();
  for (const d of dealing) d();
}

/* ------------------------------- labels' anchors ------------------------------ */

/** Screen spots (internal pixels) for a seat's DOM labels. */
export function seatAnchors(cam: Camera, s: { seat: SeatSpot; me: boolean; stack: number; bet: number }) {
  const head = project(cam, s.seat.x, HEAD_H, s.seat.z);
  const { stack: stackAt, bet: betAt } = spots(s.seat, s.me);
  return {
    head: { x: head.x, y: head.y },
    stack: chipsExtent(cam, s.stack, stackAt),
    bet: chipsExtent(cam, s.bet, betAt),
  };
}
