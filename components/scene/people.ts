/*
 * Opponents: a dark-blue pixel person sitting behind the rail, with their face
 * icon printed on like a mask. Drawn procedurally from a 48-pixel-tall design
 * at whatever height the seat's distance calls for, once per pose, and cached.
 */
import { facePattern, hash } from '@/lib/faces';
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

/** Design size: the person is 48 px tall; the sprite adds room above for leaning back. */
const DESIGN = { w: 50, h: 54 };

export interface PersonLook {
  seed: string;
  robot: boolean;
  pose: Pose;
  /** Cards held in the hands (2 or 4) when holding or thinking. */
  cards: number;
  blink: boolean;
  tilt: boolean;
  /** Sprite height in pixels (the person is 48/54 of it). */
  height: number;
}

const cache = new Map<string, HTMLCanvasElement | null>();

/** The person drawn into a small canvas, made once per look and reused. Its bottom edge sits on the rail. */
export function personSprite(look: PersonLook): HTMLCanvasElement | null {
  const key = `${look.seed}|${look.robot}|${look.pose}|${look.cards}|${look.blink}|${look.tilt}|${look.height}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 600) cache.clear();
  const u = look.height / DESIGN.h;
  const canvas = offscreen(DESIGN.w * u, look.height);
  if (canvas) paintPerson(canvas.getContext('2d')!, look, u);
  cache.set(key, canvas);
  return canvas;
}

export const spriteSize = (height: number) => ({ w: Math.max(1, Math.round((DESIGN.w * height) / DESIGN.h)), h: height });

function paintPerson(ctx: CanvasRenderingContext2D, look: PersonLook, u: number) {
  // Draw in design units (0–50 across, 0–54 down, the rail at 54), snapped to whole pixels.
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
  /** A limb from (x0, y0) to (x1, y1), `w` thick, outlined: stepped like pixel art. */
  const limb = (x0: number, y0: number, x1: number, y1: number, w: number, fill: string, edge: string) => {
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (const [pad, color] of [
      [1, INK],
      [0, fill],
    ] as const) {
      for (let k = 0; k <= steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps;
        const y = y0 + ((y1 - y0) * k) / steps;
        rect(x - w / 2 - pad, y - w / 2 - pad, w + 2 * pad, w + 2 * pad, color);
      }
    }
    for (let k = 0; k <= steps; k++) rect(x0 + ((x1 - x0) * k) / steps - w / 2, y0 + ((y1 - y0) * k) / steps - w / 2, 1, w, edge);
  };
  const out = look.pose === 'out';
  const skin = out ? GREY : BLUE;
  const shirt = out ? GREY_SHIRT : SHIRT;
  const lean = look.pose === 'think' ? 3 : look.pose === 'fold' ? -3 : 0;
  const holding = (look.pose === 'hold' || look.pose === 'think') && look.cards > 0;

  // The body's shadow on the rail, cast down and right (the light is top-left).
  shadow(14, 50, 34, 4, 0.4);

  /* Torso: sloped shoulders down to the rail, lit on the left. */
  const sh = 33 + lean;
  rect(9, sh - 2, 32, 3, INK);
  rect(5, sh, 40, 54 - sh, INK);
  rect(10, sh - 1, 30, 2, shirt.mid);
  rect(6, sh + 1, 38, 54 - sh - 1, shirt.mid);
  rect(6, sh + 1, 10, 54 - sh - 1, shirt.lit);
  rect(11, sh - 1, 6, 2, shirt.lit);
  rect(33, sh + 1, 11, 54 - sh - 1, shirt.shade);
  // A V collar.
  rect(21, sh - 1, 8, 2, shirt.deep);
  rect(23, sh + 1, 4, 2, shirt.deep);

  /* Neck, shaded by the chin. */
  rect(20, sh - 6, 10, 6, INK);
  rect(21, sh - 6, 8, 5, skin.mid);
  rect(25, sh - 6, 4, 5, skin.shade);
  shadow(21, sh - 6, 8, 2, 0.5);

  /* Head: big and round, lit from the top-left; hair on top; the face icon printed on. */
  const tilt = look.tilt ? 1 : 0;
  const hx = 13 + tilt;
  const hy = 6 + lean;
  rect(hx + 3, hy - 1, 18, 1, INK);
  rect(hx + 1, hy, 22, 2, INK);
  rect(hx, hy + 2, 24, 18, INK);
  rect(hx + 1, hy + 20, 22, 2, INK);
  rect(hx + 3, hy + 22, 18, 1, INK);
  rect(hx + 3, hy, 18, 2, skin.mid);
  rect(hx + 1, hy + 2, 22, 18, skin.mid);
  rect(hx + 3, hy + 20, 18, 2, skin.mid);
  // Lit left cheek and brow, shaded right side and jaw.
  rect(hx + 1, hy + 4, 4, 15, skin.lit);
  rect(hx + 18, hy + 3, 5, 17, skin.shade);
  rect(hx + 3, hy + 20, 18, 2, skin.shade);
  // Hair, with a highlight and a fringe; a tilted head shows it shifted.
  rect(hx + 3, hy, 18, 3, skin.deep);
  rect(hx + 1, hy + 2, 22, 3, skin.deep);
  rect(hx + 1, hy + 5, 3, 4, skin.deep);
  rect(hx + 20, hy + 5, 3, 4, skin.deep);
  rect(hx + 5 + tilt, hy + 1, 6, 1, skin.lit);
  // Ears.
  rect(hx - 1, hy + 9, 2, 5, INK);
  rect(hx + 23, hy + 9, 2, 5, INK);
  rect(hx - 1, hy + 10, 1, 3, skin.lit);
  rect(hx + 24, hy + 10, 1, 3, skin.shade);
  // The face: the player's icon, darker on the shaded side.
  paintMask(ctx, look, R(hx + 5), R(hy + 6), R(14));
  // Nose shadow just right of the middle; the chin's shadow on the neck.
  shadow(hx + 13, hy + 14, 2, 3, 0.4);
  shadow(hx + 5, hy + 20, 14, 2, 0.3);

  /* Arms. */
  if (look.pose === 'fold') {
    // Leaning back, arms crossed over the chest.
    limb(9, sh + 3, 9, sh + 13, 6, skin.lit, skin.hi);
    limb(41, sh + 3, 41, sh + 13, 6, skin.shade, skin.mid);
    limb(9, sh + 14, 34, sh + 9, 6, skin.mid, skin.lit);
    limb(41, sh + 14, 16, sh + 9, 6, skin.shade, skin.mid);
    rect(32, sh + 6, 4, 5, skin.lit);
    rect(14, sh + 6, 4, 5, skin.mid);
    shadow(10, sh + 17, 30, 2, 0.4);
  } else if (holding) {
    // Elbows on the rail, forearms up, hands holding the fanned cards at the chest.
    const hand = 41 + lean;
    limb(9, sh + 3, 10, 49, 6, skin.lit, skin.hi);
    limb(41, sh + 3, 40, 49, 6, skin.shade, skin.mid);
    limb(10, 49, 18, hand + 2, 6, skin.mid, skin.lit);
    limb(40, 49, 32, hand + 2, 6, skin.shade, skin.mid);
    paintHeldCards(ctx, look.cards, 25, hand - 12, u);
    // Hands round the bottom of the cards: fingers in front, thumbs on top.
    rect(14, hand - 1, 9, 7, INK);
    rect(15, hand, 7, 5, skin.lit);
    rect(27, hand - 1, 9, 7, INK);
    rect(28, hand, 7, 5, skin.shade);
    for (let k = 0; k < 3; k++) {
      rect(16 + k * 2, hand + 1, 1, 3, skin.mid);
      rect(29 + k * 2, hand + 1, 1, 3, skin.deep);
    }
    rect(20, hand - 3, 2, 3, skin.hi);
    rect(28, hand - 3, 2, 3, skin.mid);
    shadow(10, 53, 30, 1, 0.4);
  } else {
    // Resting on the rail: upper arms down the sides, forearms along the rail, hands together.
    limb(9, sh + 3, 9, 48, 6, skin.lit, skin.hi);
    limb(41, sh + 3, 41, 48, 6, skin.shade, skin.mid);
    limb(9, 49, 22, 49, 6, skin.mid, skin.lit);
    limb(41, 49, 28, 49, 6, skin.shade, skin.mid);
    rect(20, 46, 10, 7, INK);
    rect(21, 47, 4, 5, skin.lit);
    rect(25, 47, 4, 5, skin.mid);
    shadow(6, 53, 38, 1, 0.45);
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
