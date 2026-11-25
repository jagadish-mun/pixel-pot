/*
 * Opponents: a dark-blue pixel person sitting behind the rail, with their face
 * icon printed on like a mask. Drawn procedurally from a 48-pixel-tall design
 * at whatever height the seat's distance calls for, once per pose, and cached.
 */
import { facePattern, hash } from '../../lib/faces';
import type { Party, Player } from '@/lib/types';
import { BONE, INK, offscreen } from './glyphs';

export type Pose = 'rest' | 'hold' | 'think' | 'fold' | 'out';

/** What an opponent is doing, from the table's state. */
export function poseOf(party: Party, p: Player, opts: { acting: boolean; showing: boolean }): Pose {
  const playing = party.phase !== 'idle';
  const inHand = playing && p.inHand;
  if (p.stack === 0 && !inHand) return 'out';
  if (inHand && p.folded) return 'fold';
  if (inHand && !opts.showing) return opts.acting ? 'think' : 'hold';
  return 'rest';
}

/** Small per-player timings, from their seed, so the table doesn't move in step. */
export function idle(seed: string, now: number): { bob: number; blink: boolean; tilt: boolean } {
  const h = hash(seed);
  const breath = 1800 + (h % 500);
  const bob = (now + (h % breath)) % breath < breath / 2 ? 0 : 1;
  const blinkEvery = 3200 + ((h >>> 8) % 3000);
  const blink = (now + ((h >>> 4) % blinkEvery)) % blinkEvery < 140;
  const tiltEvery = 9000 + ((h >>> 12) % 7000);
  const tilt = (now + ((h >>> 16) % tiltEvery)) % tiltEvery < 1600;
  return { bob, blink, tilt };
}

/* --------------------------------- palette -------------------------------- */

const BLUE = { hi: '#7489d6', lit: '#5a6fbd', mid: '#435499', shade: '#303d75', deep: '#212a54' };
const SHIRT = { lit: '#38498c', mid: '#2a376d', shade: '#1e2852', deep: '#151c3b' };
const GREY = { hi: '#8d8996', lit: '#76727f', mid: '#5f5b67', shade: '#48444f', deep: '#35323b' };
const GREY_SHIRT = { lit: '#57535f', mid: '#4a4652', shade: '#3c3943', deep: '#2e2c34' };
const MASK_BG = '#2b2440';

/* --------------------------------- sprites -------------------------------- */

/** Design size: 50 × 62 units. The rail's top lies at y = RAIL_Y; everything below it is hidden by the table. */
const DESIGN = { w: 50, h: 62 };
export const RAIL_Y = 46;

export interface PersonLook {
  seed: string;
  robot: boolean;
  pose: Pose;
  /** Cards held in the hands (2 or 4) when holding or thinking. */
  cards: number;
  blink: boolean;
  tilt: boolean;
  /** At the rounded ends people sit turned toward the middle: 1 turned right, −1 left. */
  turn: -1 | 0 | 1;
  /** Sprite height in pixels. */
  height: number;
}

/** A person in two layers: the body (behind the table) and the forearms and hands (on the rail, over it). */
export interface PersonSprite {
  body: HTMLCanvasElement;
  arms: HTMLCanvasElement;
}

const cache = new Map<string, PersonSprite | null>();

/** The person drawn into two small canvases, made once per look and reused. */
export function personSprite(look: PersonLook): PersonSprite | null {
  const key = `${look.seed}|${look.robot}|${look.pose}|${look.cards}|${look.blink}|${look.tilt}|${look.turn}|${look.height}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 800) cache.clear();
  const u = look.height / DESIGN.h;
  const body = offscreen(DESIGN.w * u, look.height);
  const arms = offscreen(DESIGN.w * u, look.height);
  const sprite = body && arms ? { body, arms } : null;
  if (sprite) paintPerson(sprite.body.getContext('2d')!, sprite.arms.getContext('2d')!, look, u);
  cache.set(key, sprite);
  return sprite;
}

export const spriteSize = (height: number) => ({ w: Math.max(1, Math.round((DESIGN.w * height) / DESIGN.h)), h: height });

/** Drawing helpers in design units, snapped to whole pixels. */
function painter(ctx: CanvasRenderingContext2D, u: number) {
  const R = (n: number) => Math.round(n * u);
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    const x0 = R(x);
    const y0 = R(y);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, Math.max(1, R(x + w) - x0), Math.max(1, R(y + h) - y0));
  };
  const shadow = (x: number, y: number, w: number, h: number, a = 0.35) => {
    ctx.globalAlpha = a;
    rect(x, y, w, h, INK);
    ctx.globalAlpha = 1;
  };
  /** A limb from (x0, y0) to (x1, y1), `w` thick, outlined, lit along one edge. */
  const limb = (x0: number, y0: number, x1: number, y1: number, w: number, fill: string, edge: string) => {
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (const [pad, color] of [
      [1, INK],
      [0, fill],
    ] as const) {
      for (let k = 0; k <= steps; k++) rect(x0 + ((x1 - x0) * k) / steps - w / 2 - pad, y0 + ((y1 - y0) * k) / steps - w / 2 - pad, w + 2 * pad, w + 2 * pad, color);
    }
    for (let k = 0; k <= steps; k++) rect(x0 + ((x1 - x0) * k) / steps - w / 2, y0 + ((y1 - y0) * k) / steps - w / 2, 1, w, edge);
  };
  return { R, rect, shadow, limb };
}

function paintPerson(bodyCtx: CanvasRenderingContext2D, armsCtx: CanvasRenderingContext2D, look: PersonLook, u: number) {
  const out = look.pose === 'out';
  const skin = out ? GREY : BLUE;
  const shirt = out ? GREY_SHIRT : SHIRT;
  const lean = look.pose === 'think' ? 3 : look.pose === 'fold' ? -3 : 0;
  const holding = (look.pose === 'hold' || look.pose === 'think') && look.cards > 0;
  // Turned toward the middle: the head and face shift that way, the far shoulder narrows.
  const turn = look.turn;

  /* ---------- body: chair back, torso, upper arms, head ---------- */
  {
    const { R, rect, shadow, limb } = painter(bodyCtx, u);
    // The chair's back, behind the shoulders.
    rect(7, 18, 36, 46, INK);
    rect(8, 19, 34, 45, '#3a2030');
    rect(8, 19, 5, 45, '#4e2c40');
    rect(8, 19, 34, 2, '#5c3550');

    const sh = 33 + lean;
    const nearL = turn > 0 ? 0 : 2;
    const nearR = turn < 0 ? 0 : 2;
    // Torso, lit on the left.
    rect(10 - nearL, sh - 2, 30 + nearL + nearR, 3, INK);
    rect(7 - nearL, sh, 36 + nearL + nearR, 62 - sh, INK);
    rect(8 - nearL, sh + 1, 34 + nearL + nearR, 62 - sh - 1, shirt.mid);
    rect(11 - nearL, sh - 1, 28 + nearL + nearR, 2, shirt.mid);
    rect(8 - nearL, sh + 1, 9, 62 - sh - 1, shirt.lit);
    rect(32 + nearR, sh + 1, 10, 62 - sh - 1, shirt.shade);
    rect(21 + turn * 2, sh - 1, 8, 2, shirt.deep);
    rect(23 + turn * 2, sh + 1, 4, 2, shirt.deep);
    shadow(13, sh + 4, 1, 62 - sh - 6, 0.55);
    shadow(36, sh + 4, 1, 62 - sh - 6, 0.55);
    // Upper arms down to the elbows at the rail (crossed when folded).
    if (look.pose === 'fold') {
      limb(9, sh + 3, 9, sh + 13, 6, skin.lit, skin.hi);
      limb(41, sh + 3, 41, sh + 13, 6, skin.shade, skin.mid);
      limb(9, sh + 14, 34, sh + 9, 6, skin.mid, skin.lit);
      limb(41, sh + 14, 16, sh + 9, 6, skin.shade, skin.mid);
      rect(32, sh + 6, 4, 5, skin.lit);
      rect(14, sh + 6, 4, 5, skin.mid);
      shadow(10, sh + 17, 30, 2, 0.4);
    } else {
      limb(8, sh + 3, 9, RAIL_Y + 1, 6, skin.lit, skin.hi);
      limb(42, sh + 3, 41, RAIL_Y + 1, 6, skin.shade, skin.mid);
    }

    // Neck, shaded by the chin.
    const nx = 20 + turn * 2;
    rect(nx, sh - 6, 10, 6, INK);
    rect(nx + 1, sh - 6, 8, 5, skin.mid);
    rect(nx + 5, sh - 6, 4, 5, skin.shade);
    shadow(nx + 1, sh - 6, 8, 2, 0.5);

    // Head: big and round, hair on top, the face icon printed on.
    const tilt = look.tilt ? 1 : 0;
    const hx = 13 + tilt + turn * 3;
    const hy = 6 + lean;
    rect(hx + 3, hy - 1, 18, 1, INK);
    rect(hx + 1, hy, 22, 2, INK);
    rect(hx, hy + 2, 24, 18, INK);
    rect(hx + 1, hy + 20, 22, 2, INK);
    rect(hx + 3, hy + 22, 18, 1, INK);
    rect(hx + 3, hy, 18, 2, skin.mid);
    rect(hx + 1, hy + 2, 22, 18, skin.mid);
    rect(hx + 3, hy + 20, 18, 2, skin.mid);
    rect(hx + 1, hy + 4, 4, 15, skin.lit);
    rect(hx + 18, hy + 3, 5, 17, skin.shade);
    rect(hx + 3, hy + 20, 18, 2, skin.shade);
    rect(hx + 3, hy, 18, 3, skin.deep);
    rect(hx + 1, hy + 2, 22, 3, skin.deep);
    rect(hx + 1, hy + 5, 3, 4, skin.deep);
    rect(hx + 20, hy + 5, 3, 4, skin.deep);
    rect(hx + 5 + tilt, hy + 1, 6, 1, skin.lit);
    // Ears: the one on the far side of a turned head hides.
    if (turn <= 0) {
      rect(hx + 23, hy + 9, 2, 5, INK);
      rect(hx + 24, hy + 10, 1, 3, skin.shade);
    }
    if (turn >= 0) {
      rect(hx - 1, hy + 9, 2, 5, INK);
      rect(hx - 1, hy + 10, 1, 3, skin.lit);
    }
    paintMask(bodyCtx, look, R(hx + 5 + turn * 2), R(hy + 6), R(14));
    shadow(hx + 13 + turn * 2, hy + 14, 2, 3, 0.4);
    shadow(hx + 5, hy + 20, 14, 2, 0.3);
  }

  /* ---------- arms: forearms along the rail, hands, held cards ---------- */
  if (look.pose === 'fold') return;
  {
    const { rect, shadow, limb } = painter(armsCtx, u);
    const skin2 = skin;
    // The arms' shadow on the rail.
    shadow(8, RAIL_Y + 3, 36, 2, 0.4);
    if (holding) {
      // Forearms on the rail, hands raised a little holding the fanned cards just above its edge.
      const hand = RAIL_Y - 3 + Math.round(lean / 2);
      limb(9, RAIL_Y + 1, 18, hand + 2, 6, skin2.mid, skin2.lit);
      limb(41, RAIL_Y + 1, 32, hand + 2, 6, skin2.shade, skin2.mid);
      paintHeldCards(armsCtx, look.cards, 25, hand - 13, u);
      rect(14, hand - 1, 9, 7, INK);
      rect(15, hand, 7, 5, skin2.lit);
      rect(27, hand - 1, 9, 7, INK);
      rect(28, hand, 7, 5, skin2.shade);
      for (let k = 0; k < 3; k++) {
        rect(16 + k * 2, hand + 1, 1, 3, skin2.mid);
        rect(29 + k * 2, hand + 1, 1, 3, skin2.deep);
      }
      rect(20, hand - 3, 2, 3, skin2.hi);
      rect(28, hand - 3, 2, 3, skin2.mid);
    } else {
      // Forearms along the rail, hands together in front.
      limb(9, RAIL_Y + 1, 22, RAIL_Y + 1, 6, skin2.mid, skin2.lit);
      limb(41, RAIL_Y + 1, 28, RAIL_Y + 1, 6, skin2.shade, skin2.mid);
      rect(20, RAIL_Y - 2, 10, 7, INK);
      rect(21, RAIL_Y - 1, 4, 5, skin2.lit);
      rect(25, RAIL_Y - 1, 4, 5, skin2.mid);
    }
  }
}

/** The face icon on a dark mask, `size` pixels square, the right side darker. */
function paintMask(ctx: CanvasRenderingContext2D, look: PersonLook, x: number, y: number, size: number) {
  const { size: n, color, cells } = facePattern(look.seed, look.robot);
  // People's 5×5 badge sits inside a one-cell border, like the round icon; robots fill the mask.
  const grid = n + 2;
  const cell = Math.max(1, Math.floor(size / grid));
  const inset = Math.round((size - cell * grid) / 2);
  const ox = x + inset;
  const oy = y + inset;
  ctx.fillStyle = MASK_BG;
  ctx.fillRect(ox, oy, cell * grid, cell * grid);
  ctx.fillStyle = look.pose === 'out' ? '#9a96a3' : color;
  if (look.blink) ctx.globalAlpha = 0.35;
  for (const [cx, cy] of cells) ctx.fillRect(ox + (cx + 1) * cell, oy + (cy + 1) * cell, cell, cell);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = INK;
  const shadeFrom = Math.round(grid * 0.62) * cell;
  ctx.fillRect(ox + shadeFrom, oy, cell * grid - shadeFrom, cell * grid);
  ctx.globalAlpha = 1;
}

/** Card backs held fanned in front of the chest, centred on (cx, top) in design units. */
function paintHeldCards(ctx: CanvasRenderingContext2D, count: number, cx: number, top: number, u: number) {
  const w = Math.max(3, Math.round((count > 2 ? 7 : 9) * u));
  const h = Math.max(4, Math.round(12 * u));
  const step = Math.max(2, Math.round((count > 2 ? 4 : 6) * u));
  const x0 = Math.round(cx * u) - Math.round((step * (count - 1) + w) / 2);
  const y0 = Math.round(top * u);
  for (let i = 0; i < count; i++) {
    // Fanned: each card leans a little more to the right, shifted row by row.
    const lean = (i - (count - 1) / 2) * 0.18;
    for (let r = 0; r < h; r++) {
      const shift = Math.round((h - r) * lean);
      const x = x0 + i * step + shift;
      const y = y0 + r + Math.round(Math.abs(i - (count - 1) / 2) * u);
      const edge = r === 0 || r === h - 1;
      ctx.fillStyle = INK;
      ctx.fillRect(x - 1, y, w + 2, 1);
      ctx.fillStyle = edge ? INK : BONE;
      ctx.fillRect(x, y, w, 1);
      if (!edge && r > 1 && r < h - 2 && w > 4) {
        ctx.fillStyle = '#e2483d';
        ctx.fillRect(x + 1, y, w - 2, 1);
        ctx.fillStyle = '#9c2a2a';
        for (let k = 1 + (r % 2); k < w - 1; k += 2) ctx.fillRect(x + k, y, 1, 1);
      }
    }
  }
}
