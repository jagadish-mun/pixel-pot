/*
 * Opponents: a dark-blue pixel person behind the rail, built from shaded
 * shapes at art resolution (48 × 47) and enlarged by a whole number. A rounded
 * helmet-like head with the player's icon on a screen, a hoodie, arms bent at
 * the elbow with the forearms on the rail, and card backs held in front of the
 * chest. Three views: front (far side), three-quarter (the ends; mirrored for
 * the other end). Idle motion moves whole parts by one pixel, never stretches.
 */
import { facePattern, hash } from '../../lib/faces';
import type { Party, Player } from '@/lib/types';
import { miniBack } from './cardart';
import { offscreen } from './glyphs';
import { Mask, fill, greyed, shade, silhouette, type Ramp } from './pixel';
import { rotSprite } from './rotsprite';
import { override, spriteVersion } from './sprites';

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
  // My hands breathe slower (about 3 s); opponents about every 2 s, out of step.
  const breath = seed === 'my hands' ? 3000 : 1800 + (h % 500);
  const bob = (now + (h % breath)) % breath < breath / 2 ? 0 : 1;
  const blinkEvery = 3200 + ((h >>> 8) % 3000);
  const blink = (now + ((h >>> 4) % blinkEvery)) % blinkEvery < 140;
  const tiltEvery = 9000 + ((h >>> 12) % 7000);
  const tilt = (now + ((h >>> 16) % tiltEvery)) % tiltEvery < 1600;
  return { bob, blink, tilt };
}

/* --------------------------------- palette -------------------------------- */

const HELMET: Ramp = ['#7f95e6', '#4a5db0', '#33438a', '#1c2552'];
const JACKET: Ramp = ['#5a72c8', '#3c4f9a', '#2c3a75', '#1b2450'];
const JACKET_LOW: Ramp = ['#34458a', '#26336a', '#1c2652', '#121836'];
const GLOVE: Ramp = ['#91a6f0', '#6177c9', '#43549a', '#26306a'];
const SCREEN = '#2b2440';
const BEZEL = '#11152c';
const SHADOW = '#0c0916';

/* --------------------------------- sprites -------------------------------- */

const COLS = 48;
const ROWS = 47;
/** The rail's top lies along this row: the body below it is hidden by the table. */
export const RAIL_ROW = 40;
/** One spare row above the head, so a person leaning back stays inside the sprite. */
const HEADROOM = 1;

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
  /** About how tall the person should be, in pixels; the sprite is drawn at the nearest whole-number scale. */
  height: number;
}

/** A person in two layers: the body (behind the table) and the forearms, hands and cards (on the rail, over it). */
export interface PersonSprite {
  body: HTMLCanvasElement;
  arms: HTMLCanvasElement;
}

/** The whole-number scale for a wanted height, the sprite's size, and where the rail lies in it (pixels). */
export function spriteMetrics(height: number): { k: number; w: number; h: number; railY: number } {
  // About the old people's size on screen: one art pixel per scene pixel until seats are near and large.
  const k = Math.max(1, Math.round(height / 70));
  return { k, w: COLS * k, h: (ROWS + HEADROOM) * k, railY: (RAIL_ROW + HEADROOM) * k };
}

const cache = new Map<string, PersonSprite | null>();

/** The person drawn into two canvases, made once per look and reused. */
export function personSprite(look: PersonLook): PersonSprite | null {
  const { k, w, h } = spriteMetrics(look.height);
  const key = `${look.seed}|${look.robot}|${look.pose}|${look.cards}|${look.blink}|${look.tilt}|${look.turn}|${k}|${spriteVersion()}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 800) cache.clear();
  const art = paintArt(look);
  let sprite: PersonSprite | null = null;
  if (art) {
    const scaleUp = (src: HTMLCanvasElement) => {
      const c = offscreen(w, h)!;
      const t = c.getContext('2d')!;
      t.imageSmoothingEnabled = false;
      t.drawImage(src, 0, 0, w, h);
      return c;
    };
    sprite = { body: scaleUp(art.body), arms: scaleUp(art.arms) };
  }
  cache.set(key, sprite);
  return sprite;
}

const mirrorCanvas = (src: HTMLCanvasElement) => {
  const c = offscreen(src.width, src.height)!;
  const t = c.getContext('2d')!;
  t.translate(src.width, 0);
  t.scale(-1, 1);
  t.drawImage(src, 0, 0);
  t.setTransform(1, 0, 0, 1, 0, 0);
  return c;
};

/** The person at art resolution: body and arms, each COLS × (ROWS + HEADROOM). */
function paintArt(look: PersonLook): { body: HTMLCanvasElement; arms: HTMLCanvasElement } | null {
  const W = COLS;
  const H = ROWS + HEADROOM;
  const bodyC = offscreen(W, H);
  const armsC = offscreen(W, H);
  if (!bodyC || !armsC) return null;
  const view = look.turn === 0 ? 'front' : 'quarter';
  const ownBody = override(`opponent-${view}-body`);
  const ownArms = override(`opponent-${view}-arms-${look.pose === 'fold' ? 'fold' : (look.pose === 'hold' || look.pose === 'think') && look.cards ? 'hold' : 'rest'}`);
  const b = bodyC.getContext('2d')!;
  const a = armsC.getContext('2d')!;
  const t = look.turn === 0 ? 0 : 1;
  const holding = (look.pose === 'hold' || look.pose === 'think') && look.cards > 0;
  // Whole-part moves: forward while thinking, back when folded, slumped when out.
  const lean = look.pose === 'think' ? 1 : look.pose === 'fold' ? -1 : look.pose === 'out' ? 1 : 0;
  const tilt = look.tilt ? 1 : 0;
  const y0 = HEADROOM + lean;
  const m = () => new Mask(W, H);

  // Head geometry (the three-quarter view turns it toward the middle: shifted, the screen further over).
  const hx = 24 + 2 * t + tilt;
  const hy = y0 + 9;
  const screen = { x: 19 + 4 * t + tilt, y: y0 + 4, w: 9, h: 9 };

  if (ownBody) b.drawImage(ownBody, 0, 0);
  else {
    // Torso: sloped shoulders about 2.6 heads wide, narrowing to the rail.
    const far = 5 - t; // the far shoulder is foreshortened in three-quarter
    const torso = m().poly([
      [21 + t, y0 + 19],
      [8 - t, y0 + 23],
      [4 - t, y0 + 28],
      [11, H],
      [37 + t, H],
      [44 - t, y0 + 28],
      [40 + t, y0 + 23],
      [27 + t, y0 + 19],
    ]);
    torso.ellipse(8.5 - t, y0 + 27, 5, 4.5).ellipse(39.5 + t, y0 + 27, far, 4.5);
    // Above the rail line in the jacket ramp; below it darker (in the table's shade).
    const above = torso.copy();
    for (let y = RAIL_ROW + HEADROOM; y < H; y++) for (let x = 0; x < W; x++) above.set(x, y, false);
    const below = torso.copy().cut(above);
    shade(b, above, JACKET, { band: 3 });
    shade(b, below, JACKET_LOW, { band: 2 });
    // Hood edge round the neck, and a seam line down the front.
    const hood = m().ellipse(24 + t, y0 + 20.5, 7.5, 3).cut(m().ellipse(24 + t, y0 + 19.5, 4.5, 2.2));
    shade(b, hood, JACKET, { band: 1 });
    b.fillStyle = JACKET[3];
    b.fillRect(24 + 2 * t, y0 + 23, 1, RAIL_ROW + HEADROOM - y0 - 23);
    b.fillStyle = JACKET[0];
    b.fillRect(23 + 2 * t, y0 + 24, 1, 2);
    // Upper arms down the sides to the elbows on the rail, with a shadow where they meet the body.
    for (const [x1, x2] of [
      [9 - t, 8 - t],
      [39 + t, 40 + t],
    ]) {
      const arm = m().limb(x1, y0 + 26, x2, RAIL_ROW + HEADROOM - 1, 3.4);
      fill(b, arm.shifted(x1 < 24 ? 1 : -1, 1), SHADOW, 0.35);
      shade(b, arm, JACKET, { band: 2 });
    }
    // Neck, with the chin's shadow across its top.
    const neck = m().rect(21 + 2 * t, y0 + 16, 6, 5);
    shade(b, neck, HELMET, { band: 2 });
    b.fillStyle = HELMET[3];
    b.fillRect(21 + 2 * t, y0 + 17, 6, 1);
    // The helmet-like head, darker on its right (the screen side shade comes from the ramp).
    const head = m().ellipse(hx, hy, 8, 9);
    fill(b, head.shifted(1, 1), SHADOW, 0.3);
    shade(b, head, HELMET, { band: 3 });
    // The screen: a 1 px bezel with a lit top-left edge.
    b.fillStyle = BEZEL;
    b.fillRect(screen.x - 1, screen.y - 1, screen.w + 2, screen.h + 2);
    b.fillStyle = HELMET[0];
    b.fillRect(screen.x - 1, screen.y - 1, screen.w + 1, 1);
    b.fillRect(screen.x - 1, screen.y - 1, 1, screen.h + 1);
    b.fillStyle = SCREEN;
    b.fillRect(screen.x, screen.y, screen.w, screen.h);
  }

  if (ownArms) a.drawImage(ownArms, 0, 0);
  else {
    const rail = RAIL_ROW + HEADROOM;
    const parts: { mask: Mask; ramp: Ramp; band: number }[] = [];
    const cardsAt: { x: number; y: number; deg: number }[] = [];
    if (look.pose === 'fold') {
      // Arms crossed over the chest, cards gone.
      parts.push({ mask: m().limb(9 - t, rail - 1, 33 + t, y0 + 31, 3), ramp: JACKET, band: 2 });
      parts.push({ mask: m().limb(39 + t, rail - 1, 15 + t, y0 + 32, 3), ramp: JACKET, band: 2 });
      parts.push({ mask: m().ellipse(34 + t, y0 + 30.5, 2.6, 2.2), ramp: GLOVE, band: 1 });
      parts.push({ mask: m().ellipse(14 + t, y0 + 31.5, 2.6, 2.2), ramp: GLOVE, band: 1 });
    } else {
      // Forearms along the rail from the elbows, to hands in front of the chest.
      const hand = holding ? { y: rail - 3, l: 20 + 2 * t, r: 28 + 2 * t } : { y: rail, l: 21 + t, r: 27 + t };
      parts.push({ mask: m().limb(8 - t, rail, hand.l - 1, hand.y + 1, 3), ramp: JACKET, band: 2 });
      parts.push({ mask: m().limb(40 + t, rail, hand.r + 1, hand.y + 1, 3 - 0.4 * t), ramp: JACKET, band: 2 });
      parts.push({ mask: m().ellipse(hand.l, hand.y, 3, 2.6), ramp: GLOVE, band: 1 });
      parts.push({ mask: m().ellipse(hand.r, hand.y, 3, 2.6), ramp: GLOVE, band: 1 });
      if (holding) {
        const cx = 24 + 2 * t;
        cardsAt.push({ x: cx - 2.5, y: hand.y - 6, deg: -7 }, { x: cx + 2.5, y: hand.y - 6, deg: 7 });
      }
    }
    // Cast shadows: the arms on the rail and on the body.
    const all = parts.reduce((acc, p) => acc.add(p.mask), m());
    fill(a, all.shifted(1, 2), SHADOW, 0.4);
    for (const p of parts.slice(0, 2)) shade(a, p.mask, p.ramp, { band: p.band });
    // Card backs fanned with RotSprite, then the hands, with fingertips over the cards' front edge.
    const back = miniBack();
    for (const c of cardsAt) {
      const r = back && rotSprite(back, c.deg);
      if (!r) continue;
      const x = Math.round(c.x - r.cx);
      const y = Math.round(c.y - r.cy);
      // Each card's shadow on the chest behind it.
      const sh = silhouette(r.canvas, SHADOW, 'solid');
      if (sh) {
        a.globalAlpha = 0.35;
        a.drawImage(sh, x + 1, y + 1);
        a.globalAlpha = 1;
      }
      a.drawImage(r.canvas, x, y);
    }
    for (const p of parts.slice(2)) shade(a, p.mask, p.ramp, { band: p.band });
    if (cardsAt.length) {
      for (const dx of [-3, -1, 1, 3]) {
        const f = m().ellipse(24 + 2 * t + dx + (dx < 0 ? -0.5 : 0.5), rail - 6, 1.2, 1.4);
        shade(a, f, GLOVE, { band: 0 });
      }
    }
  }

  // Mirror for the other end (the icon is printed afterwards, so it isn't mirrored).
  let body = bodyC;
  let arms = armsC;
  if (look.turn < 0) {
    body = mirrorCanvas(bodyC);
    arms = mirrorCanvas(armsC);
  }
  if (!ownBody) {
    const sx = look.turn < 0 ? W - screen.x - screen.w : screen.x;
    paintIcon(body.getContext('2d')!, look, sx + 1, screen.y + 1);
  }
  if (look.pose === 'out') {
    body = greyed(body);
    arms = greyed(arms);
  }
  return { body, arms };
}

/** The player's icon on the screen (7 × 7), dimmed for a blink, the right side in shade. */
function paintIcon(ctx: CanvasRenderingContext2D, look: PersonLook, x: number, y: number) {
  const { size, color, cells } = facePattern(look.seed, look.robot);
  const offset = size === 5 ? 1 : 0;
  ctx.fillStyle = color;
  if (look.blink) ctx.globalAlpha = 0.35;
  for (const [cx, cy] of cells) ctx.fillRect(x + cx + offset, y + cy + offset, 1, 1);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = SHADOW;
  ctx.fillRect(x + 5, y, 2, 7);
  ctx.globalAlpha = 1;
}
