/*
 * My hands, first person: holding my cards up toward me, lowered flat while I
 * hide them, or resting on the rail. Drawn once per look into a small canvas.
 */
import type { Card } from '@/lib/cards';
import { BONE, GLYPHS, INK, SMALL_SUITS, SUITS, offscreen, rankGlyphs, stamp, suitColor } from './glyphs';

export type HandsMode = 'hold' | 'lowered' | 'rest';

const SKIN = { hi: '#f6d2ae', lit: '#e9b98f', mid: '#d39b73', shade: '#b27a58', deep: '#87573e' };
const CUFF = { lit: '#efe7d6', shade: '#c4b9a4' };
const SLEEVE = { lit: '#3d4f94', shade: '#2a376d' };

/** Card size for my hand: readable at a glance, about 44 CSS pixels wide on a phone. */
export function myCardWidth(canvasW: number, q: number): number {
  return Math.max(16, Math.min(72, Math.round(Math.max(canvasW * 0.06, 44 / q))));
}

/** The sprite's size for a card width and card count; the same in every mode so nothing jumps. */
export function handsSize(cw: number, count: number): { w: number; h: number } {
  const ch = Math.round(cw * 1.4);
  return { w: Math.round(cw * (count > 2 ? 3.9 : 3.3)), h: Math.round(ch * 1.32 + cw * 0.5) };
}

const cache = new Map<string, HTMLCanvasElement | null>();
const faces = new Map<string, HTMLCanvasElement | null>();

export function handsSprite(look: { mode: HandsMode; cards: Card[]; count: number; cw: number }): HTMLCanvasElement | null {
  const key = `${look.mode}|${look.cards.join('')}|${look.count}|${look.cw}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 40) cache.clear();
  const { w, h } = handsSize(look.cw, look.count);
  const canvas = offscreen(w, h);
  if (canvas) {
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (look.mode === 'hold') paintHolding(ctx, look.cards, look.cw, w, h);
    else paintResting(ctx, look.cw, w, h, look.mode === 'lowered' ? look.count : 0);
  }
  cache.set(key, canvas);
  return canvas;
}

/** A card face at width `cw`: the rank in the top-left corner, a big pip in the middle. */
function cardFace(card: Card, cw: number): HTMLCanvasElement | null {
  const key = card + cw;
  if (faces.has(key)) return faces.get(key)!;
  const ch = Math.round(cw * 1.4);
  const c = offscreen(cw, ch);
  if (c) {
    const t = c.getContext('2d')!;
    t.fillStyle = INK;
    t.fillRect(0, 0, cw, ch);
    t.fillStyle = BONE;
    t.fillRect(1, 1, cw - 2, ch - 2);
    // The corner index (rank, small suit under it) stays readable when the next card covers the middle.
    const g = cw >= 54 ? 4 : cw >= 38 ? 3 : cw >= 22 ? 2 : 1;
    const color = suitColor(card);
    const glyphs = rankGlyphs(card);
    glyphs.forEach((glyph, k) => stamp(t, GLYPHS[glyph], 2 + Math.ceil(g / 2) + k * 4 * g - (k ? g : 0), 2 + g, color, g));
    stamp(t, SMALL_SUITS[card[1]], 2 + Math.ceil(g / 2), 3 + 7 * g, color, Math.max(1, g - 1));
    const ps = Math.max(1, g - 1);
    stamp(t, SUITS[card[1]], cw - 7 * ps - g - 2, ch - 7 * ps - g - 2, color, ps);
  }
  faces.set(key, c);
  return c;
}

/** A rounded blob of skin with an ink outline, lit on its left. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit = true) {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  ctx.fillStyle = INK;
  ctx.fillRect(x + 1, y - 1, w - 2, h + 2);
  ctx.fillRect(x - 1, y + 1, w + 2, h - 2);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = lit ? SKIN.mid : SKIN.shade;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = lit ? SKIN.lit : SKIN.mid;
  ctx.fillRect(x + 1, y + 1, Math.max(1, Math.round(w * 0.4)), h - 2);
  ctx.fillStyle = lit ? SKIN.hi : SKIN.lit;
  ctx.fillRect(x + 1, y + 1, Math.max(1, Math.round(w * 0.25)), 1);
}

/** A forearm in its sleeve, from (x, y) down off the bottom edge, with a light cuff at the wrist. */
function sleeve(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, bottom: number, lit: boolean) {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  const cuff = Math.max(2, Math.round(w * 0.35));
  ctx.fillStyle = INK;
  ctx.fillRect(x - 1, y, w + 2, bottom - y);
  ctx.fillStyle = SKIN.shade;
  ctx.fillRect(x, y, w, cuff);
  ctx.fillStyle = lit ? CUFF.lit : CUFF.shade;
  ctx.fillRect(x, y + cuff, w, cuff);
  ctx.fillStyle = lit ? SLEEVE.lit : SLEEVE.shade;
  ctx.fillRect(x, y + 2 * cuff + 1, w, bottom - y - 2 * cuff - 1);
}

function paintHolding(ctx: CanvasRenderingContext2D, cards: Card[], cw: number, w: number, h: number) {
  const ch = Math.round(cw * 1.4);
  const n = Math.max(1, cards.length);
  // Fanned round a pivot well below the cards, as a hand holds them, so each corner index shows.
  const step = ((n > 2 ? 9 : 13) * Math.PI) / 180;
  const radius = ch * 1.9;
  const pivot = { x: w / 2, y: Math.round(ch * 0.2) + ch + radius };
  const left = -((n - 1) / 2) * step;
  const right = ((n - 1) / 2) * step;
  // A point on a card, in its own frame (x across from the middle, y up from the bottom edge), on the sprite.
  const onCard = (angle: number, x: number, y: number) => {
    const ly = -radius - y;
    return { x: pivot.x + x * Math.cos(angle) - ly * Math.sin(angle), y: pivot.y + x * Math.sin(angle) + ly * Math.cos(angle) };
  };
  const gl = onCard(left, -cw / 2, 0);
  const gr = onCard(right, cw / 2, 0);
  const palm = { w: cw * 0.7, h: cw * 0.62 };

  // Forearms in their sleeves, off the bottom edge.
  sleeve(ctx, gl.x - palm.w * 0.35, gl.y + palm.h * 0.35, palm.w * 0.78, h, true);
  sleeve(ctx, gr.x - palm.w * 0.43, gr.y + palm.h * 0.35, palm.w * 0.78, h, false);
  // Fingers wrapped behind the cards: their tips show past the outer edges.
  const fw = Math.max(3, cw * 0.2);
  const fh = Math.max(2, cw * 0.12);
  for (let k = 0; k < 4; k++) {
    const up = ch * 0.18 + k * (fh + 1);
    const l = onCard(left, -cw / 2, up);
    const r = onCard(right, cw / 2, up);
    blob(ctx, l.x - fw * 0.75, l.y - fh / 2, fw, fh, true);
    blob(ctx, r.x - fw * 0.25, r.y - fh / 2, fw, fh, false);
  }
  // Palms behind the bottom corners.
  blob(ctx, gl.x - palm.w * 0.45, gl.y - palm.h * 0.35, palm.w, palm.h, true);
  blob(ctx, gr.x - palm.w * 0.55, gr.y - palm.h * 0.35, palm.w, palm.h, false);

  // The cards.
  cards.forEach((card, i) => {
    const face = cardFace(card, cw);
    if (!face) return;
    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(left + i * step);
    ctx.drawImage(face, Math.round(-cw / 2), Math.round(-radius - ch));
    ctx.restore();
  });

  // Thumbs in front, pressing on the bottom corners, with a nail catching the light.
  const tl = onCard(left, -cw / 2 + cw * 0.16, ch * 0.08);
  const tr = onCard(right, cw / 2 - cw * 0.16, ch * 0.08);
  const tw = cw * 0.26;
  const th = cw * 0.34;
  blob(ctx, tl.x - tw / 2, tl.y - th / 2, tw, th, true);
  blob(ctx, tr.x - tw / 2, tr.y - th / 2, tw, th, false);
  ctx.fillStyle = SKIN.hi;
  ctx.fillRect(Math.round(tl.x - tw / 4), Math.round(tl.y - th / 2 + 1), Math.max(1, Math.round(tw / 2)), Math.max(1, Math.round(th / 4)));
  ctx.fillStyle = SKIN.lit;
  ctx.fillRect(Math.round(tr.x - tw / 4), Math.round(tr.y - th / 2 + 1), Math.max(1, Math.round(tw / 2)), Math.max(1, Math.round(th / 4)));
}

/** Hands palms-down on the rail; with `cards`, my cards lie flat between them, face down. */
function paintResting(ctx: CanvasRenderingContext2D, cw: number, w: number, h: number, cards: number) {
  const hand = { w: cw * 0.9, h: cw * 0.55 };
  const y = h - cw * 0.95;
  if (cards) {
    const cardW = Math.round(cw * 0.9);
    const cardH = Math.max(4, Math.round(cw * 0.42));
    for (let i = 0; i < cards; i++) {
      const x = Math.round(w / 2 - (cardW * (cards + 1)) / 4 + i * cardW * 0.5 - cardW / 4);
      const top = Math.round(y - cardH * 0.4 + i);
      ctx.fillStyle = INK;
      ctx.fillRect(x - 1, top - 1, cardW + 2, cardH + 2);
      ctx.fillStyle = BONE;
      ctx.fillRect(x, top, cardW, cardH);
      ctx.fillStyle = '#e2483d';
      ctx.fillRect(x + 1, top + 1, cardW - 2, cardH - 2);
      ctx.fillStyle = '#9c2a2a';
      for (let yy = 1; yy < cardH - 1; yy++) for (let xx = 1 + (yy % 2); xx < cardW - 1; xx += 2) ctx.fillRect(x + xx, top + yy, 1, 1);
    }
  }
  const lx = w / 2 - hand.w - cw * 0.35;
  const rx = w / 2 + cw * 0.35;
  sleeve(ctx, lx + hand.w * 0.15, y + hand.h * 0.7, hand.w * 0.7, h, true);
  sleeve(ctx, rx + hand.w * 0.15, y + hand.h * 0.7, hand.w * 0.7, h, false);
  blob(ctx, lx, y, hand.w, hand.h, true);
  blob(ctx, rx, y, hand.w, hand.h, false);
  // Knuckles.
  ctx.fillStyle = SKIN.shade;
  for (let k = 1; k < 4; k++) {
    ctx.fillRect(Math.round(lx + (hand.w * k) / 4), Math.round(y + 1), 1, Math.max(1, Math.round(hand.h * 0.3)));
    ctx.fillRect(Math.round(rx + (hand.w * k) / 4), Math.round(y + 1), 1, Math.max(1, Math.round(hand.h * 0.3)));
  }
}
