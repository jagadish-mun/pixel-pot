/*
 * My hands, first person, drawn at art resolution and enlarged by a whole
 * number on the fine (2×) layer. Holding: my cards fanned from a pivot at the
 * bottom centre (RotSprite-turned, so their edges are clean stair-steps),
 * thumbs pressed on the front corners, fingertips peeking out behind the outer
 * edges, forearms coming in from the bottom corners. Lowered (peeking) or
 * resting: palms down on the rail, with my cards face down between them.
 */
import type { Card } from '@/lib/cards';
import { cardArt, CARD_ART } from './cardart';
import { offscreen } from './glyphs';
import { Mask, fill, shade, silhouette, type Ramp } from './pixel';
import { rotSprite } from './rotsprite';
import { override, spriteVersion } from './sprites';

export type HandsMode = 'hold' | 'lowered' | 'rest';

const SKIN: Ramp = ['#f6d2ae', '#e2ad84', '#b97d58', '#7d4e34'];
const SLEEVE: Ramp = ['#4b5ea8', '#2c3a75', '#1e2852', '#121a38'];
const SHADOW = '#1a1020';

/** Card size for my hand (scene pixels): readable at a glance, about 48 CSS pixels wide on a phone. */
export function myCardWidth(canvasW: number, q: number): number {
  return Math.max(20, Math.min(90, Math.round(Math.max(canvasW * 0.06, 48 / q))));
}

/** Art pixels to fine-layer pixels: my cards about 20% bigger than `cw` scene pixels (two fine pixels each). */
export const handsScale = (cw: number) => Math.max(2, Math.round((2 * cw * 1.2) / CARD_ART.upright.w));

/** The art canvas: the same in every mode so nothing jumps. */
const artSize = (count: number) => ({ w: count > 2 ? 150 : 130, h: 82 });

/** The hands' size in scene pixels. */
export function handsSize(cw: number, count: number): { w: number; h: number } {
  const k = handsScale(cw);
  const { w, h } = artSize(count);
  return { w: Math.ceil((w * k) / 2), h: Math.ceil((h * k) / 2) };
}

const FAN: Record<number, number[]> = { 2: [-9, 5], 4: [-12, -4, 4, 12] };
const SPREAD: Record<number, number[]> = { 2: [-12, 12], 4: [-18, -6, 6, 18] };

interface Placed {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  /** Corners on the art canvas: bottom-left, bottom-right, top-left, top-right. */
  corner: (u: number, v: number) => { x: number; y: number };
}

/** A card turned by `deg` round its bottom centre, put with that point at (bx, by). */
function place(card: Card | 'back', deg: number, bx: number, by: number): Placed | null {
  const art = cardArt(card, 'upright');
  const rot = art && rotSprite(art, deg);
  if (!art || !rot) return null;
  const a = (deg * Math.PI) / 180;
  const half = { w: (CARD_ART.upright.w - 1) / 2, h: (CARD_ART.upright.h - 1) / 2 };
  // u, v in −1..1 across and down the card; the centre goes where the bottom centre lands minus its turned offset.
  const cx = bx + Math.sin(a) * half.h;
  const cy = by - Math.cos(a) * half.h;
  const corner = (u: number, v: number) => ({
    x: cx + Math.cos(a) * u * half.w - Math.sin(a) * v * half.h,
    y: cy + Math.sin(a) * u * half.w + Math.cos(a) * v * half.h,
  });
  return { canvas: rot.canvas, x: Math.round(cx - rot.cx), y: Math.round(cy - rot.cy), corner };
}

const cache = new Map<string, HTMLCanvasElement | null>();

/** The hands at art resolution (scale with `handsScale`), made once per look. `restAt` is the rail's height in art pixels. */
export function handsSprite(look: { mode: HandsMode; cards: Card[]; count: number; restAt?: number; thumb?: boolean }): HTMLCanvasElement | null {
  const restAt = look.mode === 'hold' ? 0 : (look.restAt ?? 0);
  const key = `${look.mode}|${look.cards.join('')}|${look.count}|${restAt}|${look.thumb ? 1 : 0}|${spriteVersion()}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 40) cache.clear();
  const { w, h } = artSize(look.count);
  const canvas = offscreen(w, h);
  if (canvas) {
    const ctx = canvas.getContext('2d')!;
    if (look.mode === 'hold') paintHolding(ctx, look.cards, w, h, Boolean(look.thumb));
    else paintResting(ctx, w, h, look.mode === 'lowered' ? look.count : 0, restAt);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Draw a sprite's cast shadow, `d` pixels down-right. */
function castShadow(ctx: CanvasRenderingContext2D, p: Placed, d: number, alpha: number) {
  const s = silhouette(p.canvas, SHADOW, 'solid');
  if (!s) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(s, p.x + d, p.y + d);
  ctx.globalAlpha = 1;
}

/**
 * One hand round a card's lower outer corner. `side` −1 is my left hand
 * (on the leftmost card's bottom-left), 1 my right. Returns the parts drawn
 * in front of the cards (the thumb) separately.
 */
function handParts(p: Placed, side: -1 | 1, w: number, h: number, thumbShift: number) {
  const corner = p.corner(side, 1);
  const top = p.corner(side, -1);
  // Up the outer edge, and outward from it.
  const len = Math.hypot(top.x - corner.x, top.y - corner.y);
  const up = { x: (top.x - corner.x) / len, y: (top.y - corner.y) / len };
  const out = { x: -side * up.y, y: side * up.x };
  const at = (along: number, outward: number) => ({ x: corner.x + up.x * along + out.x * outward, y: corner.y + up.y * along + out.y * outward });

  // Forearm and palm as one shape: from the bottom corner up to the heel of the hand behind the card's corner.
  const wrist = at(-9, -6);
  const pc = at(3, -4);
  const arm = new Mask(w, h).limb(wrist.x, wrist.y, wrist.x + side * 22, h + 10, 8.5).ellipse(pc.x, pc.y, 10.5, 9.5);
  // Four fingertips behind the card, peeking out past its outer edge, each its own rounded shape.
  const fingers = [11, 18, 25, 32].map((along) => {
    const f = at(along, 2.5);
    return new Mask(w, h).ellipse(f.x, f.y, 4.2, 3.3);
  });
  // The thumb, pressed on the card's front: short and broad, from the heel up and in toward the middle.
  const base = at(1 + thumbShift, -3);
  const tip = at(7 + thumbShift, -9);
  const thumb = new Mask(w, h).limb(base.x, base.y, tip.x, tip.y, 3.4);
  const dir = { x: (tip.x - base.x) / Math.hypot(tip.x - base.x, tip.y - base.y), y: (tip.y - base.y) / Math.hypot(tip.x - base.x, tip.y - base.y) };
  return { arm, fingers, thumb, tip, base, dir, wristAt: at(-12, -5) };
}

function paintHolding(ctx: CanvasRenderingContext2D, cards: Card[], w: number, h: number, thumbShift: boolean) {
  // Hand-drawn overrides come in two layers round my cards: behind them (arms, palms, fingers) and in front (thumbs).
  const ownBack = override('hands-hold-back');
  const ownFront = override('hands-hold-front');
  const n = cards.length >= 4 ? 4 : 2;
  // The fan's tallest corner just reaches the top; forearms run off the bottom.
  const pivot = { x: w / 2, y: 61 };
  const placed = (FAN[n] ?? FAN[2])
    .map((deg, i) => (cards[i] ? place(cards[i], deg, pivot.x + SPREAD[n][i], pivot.y) : null))
    .filter((p): p is Placed => p !== null);
  if (!placed.length) return;
  const left = handParts(placed[0], -1, w, h, thumbShift ? 1 : 0);
  const right = handParts(placed[placed.length - 1], 1, w, h, thumbShift ? 1 : 0);

  if (ownBack) ctx.drawImage(ownBack, 0, 0);
  else for (const hand of [left, right]) {
    // Forearm and palm in one shading pass, then the sleeve's navy cuff over its lower end.
    shade(ctx, hand.arm, SKIN, { band: 3 });
    const sleeve = hand.arm.copy();
    for (let y = 0; y < h - 13; y++) for (let x = 0; x < w; x++) sleeve.set(x, y, false);
    shade(ctx, sleeve, SLEEVE, { band: 3 });
    // The cuff's highlight fold and shadow crease.
    for (let x = 0; x < w; x++) {
      if (sleeve.get(x, h - 12) && sleeve.get(x - 1, h - 12) && sleeve.get(x + 1, h - 12)) {
        ctx.fillStyle = SLEEVE[0];
        ctx.fillRect(x, h - 11, 1, 1);
      }
      if (sleeve.get(x, h - 6) && sleeve.get(x - 1, h - 6) && sleeve.get(x + 1, h - 6)) {
        ctx.fillStyle = SLEEVE[3];
        ctx.fillRect(x, h - 6, 1, 1);
      }
    }
    // The wrist bone catching the light.
    ctx.fillStyle = SKIN[0];
    ctx.fillRect(Math.round(hand.wristAt.x), Math.round(hand.wristAt.y), 2, 1);
    for (const f of hand.fingers) shade(ctx, f, SKIN, { band: 1 });
  }

  // Cards back to front; each casts a shadow onto what's behind it (fingers, palms, the card before).
  for (const p of placed) {
    castShadow(ctx, p, 2, 0.45);
    ctx.drawImage(p.canvas, p.x, p.y);
  }

  // Thumbs in front: a soft shadow onto the card, the thumb, a knuckle crease across its middle, the nail.
  if (ownFront) return void ctx.drawImage(ownFront, 0, 0);
  for (const hand of [left, right]) {
    fill(ctx, hand.thumb.shifted(1, 1), SHADOW, 0.35);
    shade(ctx, hand.thumb, SKIN, { band: 2 });
    const mid = { x: (hand.base.x + hand.tip.x) / 2, y: (hand.base.y + hand.tip.y) / 2 };
    ctx.fillStyle = SKIN[2];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!hand.thumb.get(x, y) || !hand.thumb.get(x - 1, y) || !hand.thumb.get(x + 1, y) || !hand.thumb.get(x, y - 1) || !hand.thumb.get(x, y + 1)) continue;
        if (Math.abs((x + 0.5 - mid.x) * hand.dir.x + (y + 0.5 - mid.y) * hand.dir.y) < 0.5) ctx.fillRect(x, y, 1, 1);
      }
    // The nail: a pale patch just short of the tip, with a highlight on its lit corner.
    const nail = { x: Math.round(hand.tip.x - hand.dir.x * 1.5) - 1, y: Math.round(hand.tip.y - hand.dir.y * 1.5) - 1 };
    ctx.fillStyle = '#f8dcc2';
    ctx.fillRect(nail.x, nail.y, 3, 2);
    ctx.fillStyle = '#fff3e6';
    ctx.fillRect(nail.x, nail.y, 1, 1);
  }
}

/** Palms down on the rail, forearms from the bottom corners; with `cards`, my cards lie face down between them. */
function paintResting(ctx: CanvasRenderingContext2D, w: number, h: number, cards: number, restAt: number) {
  const own = override(cards ? 'hands-lowered' : 'hands-rest');
  if (own) return void ctx.drawImage(own, 0, 0);
  const y = restAt > 12 && restAt < h - 10 ? restAt : h - 24;
  if (cards) {
    const back = cardArt('back', 'flat');
    if (back) {
      for (let i = 0; i < Math.min(cards, 2); i++) {
        const x = Math.round(w / 2 - back.width / 2 + (i - 0.5) * 10);
        const top = Math.round(y - back.height / 2 - 4 + i * 2);
        ctx.globalAlpha = 0.4;
        ctx.drawImage(silhouette(back, SHADOW, 'dither') ?? back, x + 2, top + 2);
        ctx.globalAlpha = 1;
        ctx.drawImage(back, x, top);
      }
    }
  }
  for (const side of [-1, 1] as const) {
    // Forearms in their sleeves come in from the bottom corners, converging on the hands lying on the rail.
    const cx = w / 2 + side * 30;
    const arm = new Mask(w, h).limb(cx + side * 3, y + 5, cx + side * 30, h + 12, 9.5);
    shade(ctx, arm, SLEEVE, { band: 3 });
    // A pale cuff at the wrist, with its fold.
    const cuff = new Mask(w, h).limb(cx + side * 3.5, y + 7, cx + side * 5.5, y + 11, 8.5);
    cuff.cut(new Mask(w, h).rect(0, 0, w, y + 6));
    shade(ctx, cuff, ['#f4ead5', '#d9cfbb', '#b3a88f', '#7d7462'], { band: 1 });
    // The hand, palm down: a broad back of the hand with four fingers reaching forward onto the rail.
    const hand = new Mask(w, h).ellipse(cx, y + 1, 12, 7.5);
    for (let f = 0; f < 4; f++) hand.ellipse(cx + (f - 1.5) * 5.2 + side * 0.5, y - 5 - (f === 1 || f === 2 ? 1 : 0), 2.6, 3.5);
    fill(ctx, hand.shifted(1, 2), SHADOW, 0.35);
    shade(ctx, hand, SKIN, { band: 3 });
    // Knuckle creases between the fingers, and the wrist bone's highlight.
    ctx.fillStyle = SKIN[2];
    for (let f = 0; f < 3; f++) ctx.fillRect(Math.round(cx + (f - 1) * 5.2 + side * 0.5), Math.round(y - 4), 1, 3);
    ctx.fillStyle = SKIN[0];
    ctx.fillRect(Math.round(cx - side * 7), Math.round(y + 4), 2, 1);
  }
}
