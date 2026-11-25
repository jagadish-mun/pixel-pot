/*
 * Drawing the table scene on a small canvas. Everything is filled with whole
 * pixels (a scanline fill, no anti-aliasing), so it stays crisp pixel art when
 * the canvas is scaled up.
 */
import { chipFaceRows, chipTowers, denom } from '../../lib/chips';
import type { Card } from '@/lib/cards';
import { BONE, INK, LETTERS, cardMarks, offscreen, stamp } from './glyphs';
import { handsSize, handsSprite, type HandsMode } from './hands';
import { BOARD_Z, BET_INSET, POT_SPOT, STACK_INSET, myShowSpot, onFelt, railPoint, spots, type SeatSpot } from './layout';
import { hashText } from '../../lib/bot';
import { RAIL_Y, personSprite, spriteSize, type Pose } from './people';
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

export const BOARD_CARD = { w: 0.156, d: 0.22, gap: 0.016 };

/**
 * A card lying flat at (x, y, z), `w` across and `d` deep: a cream trapezoid
 * with a dark outline, in perspective. Its marks (corner index, big suit) are
 * stamped on unsquashed inside it, so they stay readable however flat it lies.
 * `turn` 0→1 flips it over (back, then face).
 */
export function drawFlatCard(
  ctx: Ctx,
  cam: Camera,
  card: Card | 'back',
  at: { x: number; y: number; z: number },
  size: { w: number; d: number },
  opts: { turn?: number; outline?: string; shadow?: boolean; rot?: number; glow?: number } = {},
) {
  const turn = opts.turn ?? 1;
  const hw = (size.w / 2) * Math.max(0.08, Math.abs(Math.cos(turn * Math.PI)));
  const cos = Math.cos(opts.rot ?? 0);
  const sin = Math.sin(opts.rot ?? 0);
  const corners = (y: number, grow: number): Pt[] =>
    [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].map(([sx, sz]) => {
      // Turned a little on the felt (thrown cards), round the card's middle.
      const dx = sx * (hw + grow);
      const dz = sz * (size.d / 2 + grow);
      return project(cam, at.x + dx * cos - dz * sin, y, at.z + dx * sin + dz * cos);
    });
  if (opts.shadow !== false) {
    ctx.globalAlpha = 0.35;
    fillPolys(ctx, [corners(0, 0.008).map((p) => ({ x: p.x + 1, y: p.y + 2 }))], INK);
    ctx.globalAlpha = 1;
  }
  const face = corners(at.y, 0);
  fillPolys(ctx, [corners(at.y, 0.006)], INK);
  fillPolys(ctx, [face], BONE);
  if (turn < 0.5 || card === 'back') {
    fillPolys(ctx, [corners(at.y, -Math.min(0.012, hw * 0.25))], backPattern(ctx));
  } else {
    // An upright box for the marks, measured at the card's mid-height (its sides slant with perspective).
    const [fl, fr, nr, nl] = face;
    const box = { x: Math.ceil((fl.x + nl.x) / 2), y: Math.ceil(fl.y), w: 0, h: 0 };
    box.w = Math.floor((fr.x + nr.x) / 2) - box.x;
    box.h = Math.floor(nl.y) - box.y;
    if (box.w >= 6 && box.h >= 8) cardMarks(ctx, card, box, box.w >= 30 && box.h >= 36 ? 2 : 1);
  }
  if (opts.outline) plotLine(ctx, corners(at.y, 0.01), opts.outline, true);
  // The winning hand glowing: a thick, fading gold edge.
  if (opts.glow) {
    ctx.globalAlpha = opts.glow;
    plotLine(ctx, corners(at.y, 0.014), GOLD, true, 2);
    ctx.globalAlpha = opts.glow * 0.4;
    plotLine(ctx, corners(at.y, 0.026), GOLD, true, 2);
    ctx.globalAlpha = 1;
  }
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
function pileLayout(amount: number, at: Vec, target: number | undefined, cols: number, perTower = 15) {
  const { towers, undrawn } = chipTowers(amount, { target, perTower });
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

export function drawChips(ctx: Ctx, cam: Camera, amount: number, at: Vec, target: number | undefined, cols = 3, perTower = 15) {
  const { placed } = pileLayout(amount, at, target, cols, perTower);
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
  cols = 3,
  perTower = 15,
): { x: number; top: number; bottom: number; left: number; right: number } {
  const { placed } = pileLayout(amount, at, target, cols, perTower);
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
  const rx = Math.max(4, Math.round(r * base.s));
  const back = project(cam, at.x, 0, at.z + r);
  const front = project(cam, at.x, 0, at.z - r);
  const ry = Math.max(2, Math.round((front.y - back.y) / 2));
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
  const letters = [...m.text];
  const w = letters.length * 4 - 1;
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
  myPerTower: number;
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
  overlay?: { felt: () => void; top: () => void; shake: { x: number; y: number } },
) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cam.w, cam.h);
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
      const { w } = spriteSize(at.height);
      const x = Math.round(at.x - w / 2);
      const y = Math.round(at.y - (RAIL_Y / 62) * at.height);
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
      const from = onFelt(data.dealerSeat, 0.05);
      const slide = ease(Math.min(1, t / 0.6));
      const at = { x: from.x + (x - from.x) * slide, y: 0.06 * Math.sin(slide * Math.PI), z: from.z + (BOARD_Z - from.z) * slide };
      const turn = card === 'back' ? 0 : Math.max(0, (t - 0.6) / 0.4);
      items.push({ z: BOARD_Z, draw: () => drawSlot(ctx, cam, x, BOARD_Z) });
      onTop.push(() => drawFlatCard(ctx, cam, card === 'back' ? 'back' : card, at, BOARD_CARD, { turn }));
      return;
    }
    const win = card !== 'back' && data.winning.has(card);
    items.push({
      z: BOARD_Z,
      draw: () => drawFlatCard(ctx, cam, card, { x, y: 0, z: BOARD_Z }, BOARD_CARD, { outline: win ? GOLD : undefined, glow: win ? (data.glow ?? 0) : 0 }),
    });
  });

  for (const s of data.seats) {
    const { stack: stackAt, bet: betAt } = spots(s.seat, s.me, data.myZ);
    const cols = s.me ? 5 : 3;
    const perTower = s.me ? data.myPerTower : 15;
    if (s.stack > 0) items.push({ z: stackAt.z, draw: () => drawChips(ctx, cam, s.stack, stackAt, s.stackChips, cols, perTower) });
    // Chips an animation is moving are drawn by it, not here.
    const betShown = s.bet - (data.moving?.get(s.id) ?? 0);
    if (betShown > 0) items.push({ z: betAt.z, draw: () => drawChips(ctx, cam, betShown, betAt, s.betChips) });
    s.markers.forEach((m, k) => {
      const at = markerSpot(s.seat, s.me, data.myZ, k);
      items.push({ z: at.z, draw: () => drawMarker(ctx, cam, m, at) });
    });
    // Shown cards, face up on the felt where they were thrown (the bets are in the pot by showdown).
    if (s.shown) {
      const glow = data.glow ?? 0;
      for (const c of shownLayout(s.seat, s.me, data.myZ, s.id, s.shown)) {
        const win = data.winning.has(c.card);
        items.push({
          z: c.at.z,
          draw: () => drawFlatCard(ctx, cam, c.card, c.at, c.size, { rot: c.rot, outline: win ? GOLD : undefined, glow: win ? glow : 0 }),
        });
      }
    }
  }
  if (data.pot > 0) items.push({ z: POT_SPOT.z, draw: () => drawChips(ctx, cam, data.pot, POT_SPOT, data.potChips) });
  for (const sw of motion.sweeps) {
    const t = ease(Math.min(1, (now - sw.start) / SWEEP_MS));
    const at = { x: sw.from.x + (POT_SPOT.x - sw.from.x) * t, z: sw.from.z + (POT_SPOT.z - sw.from.z) * t };
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

  // 6. My hands, nearest of all.
  if (data.hands) {
    const box = handsBox(cam, data.hands);
    // Resting hands lie on the near rail.
    const rail = project(cam, 0, RAIL_H, -TABLE_R + RAIL_W / 2).y;
    const sprite = handsSprite({ ...data.hands, restAt: Math.round(rail - box.y) });
    if (sprite) ctx.drawImage(sprite, box.x, box.y + Math.round(data.handsLift ?? 0));
  }

  // Badges and anything else over the whole scene.
  overlay?.top();
  ctx.restore();
}

/** A seat's face-up cards on the felt: where each lies, its size, and a slight turn as if thrown down. */
export function shownLayout(seat: SeatSpot, me: boolean, myZ: number, id: string, cards: Card[]) {
  const spot = me ? myShowSpot(myZ) : onFelt(seat, BET_INSET - 0.07);
  const n = cards.length;
  const w = n > 2 ? SHOWN_CARD.w * 0.8 : SHOWN_CARD.w;
  return cards.map((card, k) => ({
    card,
    at: { x: spot.x + (k - (n - 1) / 2) * (w + 0.01), y: 0, z: spot.z },
    size: { w, d: SHOWN_CARD.d },
    rot: (((hashText(id + card) % 15) - 7) * Math.PI) / 180,
  }));
}

/** Shown cards at showdown: nearly the board's size, so rank and suit both read. */
export const SHOWN_CARD = { w: 0.145, d: 0.2 };

/* ------------------------------- labels' anchors ------------------------------ */

/** Screen spots (internal pixels) for a seat's DOM labels: above the head, and beside the stack and bet. */
export function seatAnchors(
  cam: Camera,
  s: { seat: SeatSpot; me: boolean; stack: number; bet: number; stackChips: number; betChips: number },
  myZ: number,
  myPerTower = 15,
) {
  const { stack: stackAt, bet: betAt } = spots(s.seat, s.me, myZ);
  const person = personAt(cam, s.seat);
  // The top of the head: the sprite's top edge plus its headroom.
  const top = person.y - (RAIL_Y / 62) * person.height + Math.round((person.height * 5) / 62);
  return {
    head: { x: person.x, y: top },
    size: person.height,
    stack: chipsExtent(cam, s.stack, stackAt, s.stackChips, s.me ? 5 : 3, s.me ? myPerTower : 15),
    bet: chipsExtent(cam, s.bet, betAt, s.betChips),
  };
}
