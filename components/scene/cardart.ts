/*
 * Card faces, drawn like a real deck at "art resolution" and only ever
 * enlarged by whole numbers. One design in two layouts:
 *   upright: 41×57 (5:7) plus a 1 px shadow edge, for my hand
 *   flat:    41×33 plus a 2 px thick bottom edge, for cards lying on the felt
 * Off-white face with a faint dither, cut corners, a grey outline, a corner
 * index top-left and turned 180° bottom-right, pips in the standard places
 * (bottom half turned), one big pip for aces, a framed figure for J/Q/K.
 */
import type { Card } from '@/lib/cards';
import { CARD_BLACK, CARD_RED, GLYPHS, offscreen } from './glyphs';
import { Mask, bitmap, shade, type Ramp } from './pixel';
import { override, spriteVersion } from './sprites';

export type CardLayout = 'upright' | 'flat';

/** Sprite sizes (art pixels), shadow edge and thickness included. */
export const CARD_ART = { upright: { w: 42, h: 58 }, flat: { w: 41, h: 35 } } as const;
/** The face itself (outline included). */
const FACE = { upright: { w: 41, h: 57 }, flat: { w: 41, h: 33 } } as const;

const PAPER = '#f4ead5';
const PAPER_DOT = '#e9dcc0';
const OUTLINE = '#8d8579';
const OUTLINE_LIT = '#aaa194';
const EDGE = '#5b5348';
const THICK = ['#cfc3aa', '#a99d85'];
const BACK_RED = '#c8352b';
const BACK_LINE = '#8e2420';
const PANEL = '#efe1c2';
const GOLD: Ramp = ['#ffe08a', '#f5b83d', '#b07f1f', '#6e4c10'];
const SKIN: Ramp = ['#fbe0c2', '#f0c79d', '#c9946b', '#8a5a3c'];
const RED_ROBE: Ramp = ['#f0675b', '#d8352b', '#a32820', '#6e1a15'];
const BLUE_ROBE: Ramp = ['#6a82d6', '#3c4f9a', '#2c3a75', '#1e2852'];

/** 7×7 pips for upright cards. */
const PIP7: Record<string, string[]> = {
  h: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  d: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  s: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '.X.X.X.', '..XXX..'],
  c: ['..XXX..', '..XXX..', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'],
};
/** 5×5 pips: flat cards, and the suit under each corner index. */
const PIP5: Record<string, string[]> = {
  h: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  d: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..'],
  s: ['..X..', '.XXX.', 'XXXXX', '..X..', '.XXX.'],
  c: ['.XXX.', 'XXXXX', 'XXXXX', '..X..', '.XXX.'],
};

const RANK_VALUE: Record<string, number> = { A: 1, T: 10, J: 11, Q: 12, K: 13 };
const value = (rank: string) => RANK_VALUE[rank] ?? Number(rank);

/**
 * Where the pips go for ranks 2–10 (top-left corner of each pip, art pixels),
 * in the standard deck positions: two or three columns, the bottom half turned.
 */
export function pipSpots(rank: string, layout: CardLayout): { x: number; y: number; turned: boolean }[] {
  const n = value(rank);
  if (n < 2 || n > 10) return [];
  const up = layout === 'upright';
  const size = up ? 7 : 5;
  const [L, C, R] = up ? [10, 17, 24] : [11, 18, 25];
  // Rows: top, the four-row spacing, the middle, and the extra centre pips of 7, 8 and 10.
  const r = up
    ? { top: 4, q1: 18, mid: 25, q3: 32, bot: 46, s7: 15, s8: 35, t1: 11, t2: 39 }
    : { top: 3, q1: 10, mid: 14, q3: 18, bot: 25, s7: 8, s8: 20, t1: 6, t2: 22 };
  const pairs = (...ys: number[]) => ys.flatMap((y) => [{ x: L, y }, { x: R, y }]);
  const spots: Record<number, { x: number; y: number }[]> = {
    2: [{ x: C, y: r.top }, { x: C, y: r.bot }],
    3: [{ x: C, y: r.top }, { x: C, y: r.mid }, { x: C, y: r.bot }],
    4: pairs(r.top, r.bot),
    5: [...pairs(r.top, r.bot), { x: C, y: r.mid }],
    6: pairs(r.top, r.mid, r.bot),
    7: [...pairs(r.top, r.mid, r.bot), { x: C, y: r.s7 }],
    8: [...pairs(r.top, r.mid, r.bot), { x: C, y: r.s7 }, { x: C, y: r.s8 }],
    9: [...pairs(r.top, r.q1, r.q3, r.bot), { x: C, y: r.mid }],
    10: [...pairs(r.top, r.q1, r.q3, r.bot), { x: C, y: r.t1 }, { x: C, y: r.t2 }],
  };
  const faceH = FACE[layout].h;
  // A pip below the card's middle is turned, as on a real card.
  return spots[n].map((p) => ({ ...p, turned: p.y + size / 2 > faceH / 2 + 0.5 }));
}

const colorOf = (card: string) => (card[1] === 'h' || card[1] === 'd' ? CARD_RED : CARD_BLACK);

/** The card's outline shape: a rectangle with its corners cut in 2-1 steps. */
function cardMask(w: number, h: number): Mask {
  const m = new Mask(w, h).rect(0, 0, w, h);
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
  ]) {
    m.set(x, y, false);
    m.set(w - 1 - x, y, false);
    m.set(x, h - 1 - y, false);
    m.set(w - 1 - x, h - 1 - y, false);
  }
  return m;
}

/** Paper, outline (lighter on the lit top/left), the faint dither. */
function paintBlank(t: CanvasRenderingContext2D, w: number, h: number, back: boolean) {
  const m = cardMask(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m.get(x, y)) continue;
      const edge = !m.get(x - 1, y) || !m.get(x + 1, y) || !m.get(x, y - 1) || !m.get(x, y + 1);
      const lit = !m.get(x - 1, y) || !m.get(x, y - 1);
      t.fillStyle = edge ? (lit && m.get(x + 1, y) && m.get(x, y + 1) ? OUTLINE_LIT : OUTLINE) : (x * 3 + y * 5) % 11 === 0 ? PAPER_DOT : PAPER;
      t.fillRect(x, y, 1, 1);
    }
  if (back) {
    // A white border, then a red field with a diamond lattice.
    for (let y = 3; y < h - 3; y++)
      for (let x = 3; x < w - 3; x++) {
        const line = (x + y) % 4 === 0 || (x - y + 400) % 4 === 0;
        const rim = x === 3 || y === 3 || x === w - 4 || y === h - 4;
        t.fillStyle = rim ? BACK_LINE : line ? BACK_LINE : BACK_RED;
        t.fillRect(x, y, 1, 1);
      }
  }
}

/** Rank with the small suit under it, top-left; the same turned 180° bottom-right. */
function paintIndex(t: CanvasRenderingContext2D, card: string, w: number, h: number) {
  const color = colorOf(card);
  const rank = GLYPHS[card[0]];
  const rw = rank[0].length;
  const suit = PIP5[card[1]];
  const sx = 2 + Math.floor((rw - 5) / 2);
  bitmap(t, rank, 2, 2, color);
  bitmap(t, suit, sx, 10, color);
  bitmap(t, rank, w - 2 - rw, h - 2 - 7, color, 1, true);
  bitmap(t, suit, w - sx - 5, h - 10 - 5, color, 1, true);
}

/** A simple court figure in a framed panel: crown or hat, face, robe in the suit's colour, a large rank letter. */
function paintCourt(t: CanvasRenderingContext2D, card: string, layout: CardLayout) {
  const up = layout === 'upright';
  const red = card[1] === 'h' || card[1] === 'd';
  const robe = red ? RED_ROBE : BLUE_ROBE;
  const ink = colorOf(card);
  const rank = card[0];
  const panel = up ? { x: 9, y: 3, w: 23, h: 51 } : { x: 9, y: 2, w: 23, h: 29 };
  t.fillStyle = PANEL;
  t.fillRect(panel.x, panel.y, panel.w, panel.h);
  t.fillStyle = robe[3];
  t.fillRect(panel.x, panel.y, panel.w, 1);
  t.fillRect(panel.x, panel.y + panel.h - 1, panel.w, 1);
  t.fillRect(panel.x, panel.y, 1, panel.h);
  t.fillRect(panel.x + panel.w - 1, panel.y, 1, panel.h);
  // The figure: upright it stands over the letter; flat it sits left of it.
  // Flat cards have room for a bust left of the letter, down to the panel's foot.
  const fx = up ? 20.5 : 14.5;
  const top = up ? 6 : 5;
  const s = up ? 1 : 0.6;
  const foot = up ? top + 28 : panel.y + panel.h - 1;
  const w = 41;
  const m = (fn: (k: Mask) => Mask) => fn(new Mask(w, 57));
  // Robe, with a white ruff collar and a gold seam.
  const robeM = m((k) =>
    k.poly([
      [fx - 6 * s, top + 14 * s],
      [fx + 6 * s, top + 14 * s],
      [fx + 8.5 * s, foot],
      [fx - 8.5 * s, foot],
    ]),
  );
  shade(t, robeM, robe);
  t.fillStyle = GOLD[1];
  t.fillRect(Math.floor(fx), Math.round(top + 15 * s), 1, Math.round(foot - top - 16 * s));
  const ruff = m((k) => k.ellipse(fx, top + 13.5 * s, 5 * s + 0.5, 1.6));
  shade(t, ruff, ['#ffffff', '#f4ead5', '#cfc3aa', '#8d8579']);
  // Head.
  const head = m((k) => k.ellipse(fx, top + 8.5 * s, 3.6 * s + 0.6, 4 * s + 0.4));
  shade(t, head, SKIN, { band: 1 });
  t.fillStyle = '#2a1d16';
  t.fillRect(Math.round(fx - 2 * s), Math.round(top + 8 * s), 1, 1);
  t.fillRect(Math.round(fx + 1 * s), Math.round(top + 8 * s), 1, 1);
  t.fillStyle = SKIN[2];
  t.fillRect(Math.round(fx - 1), Math.round(top + 10.5 * s), 2, 1);
  // Crown (king, queen) or cap (jack).
  if (rank === 'J') {
    const cap = m((k) => k.ellipse(fx, top + 4.5 * s, 4.5 * s + 0.5, 2 * s + 0.4));
    shade(t, cap, robe, { band: 1 });
    t.fillStyle = '#ffffff';
    t.fillRect(Math.round(fx + 3 * s), Math.round(top + 1 * s), 1, 3);
  } else {
    const pts: [number, number][] =
      rank === 'K'
        ? [
            [fx - 4.5 * s, top + 6 * s],
            [fx - 4.5 * s, top],
            [fx - 2.2 * s, top + 3 * s],
            [fx, top - 1],
            [fx + 2.2 * s, top + 3 * s],
            [fx + 4.5 * s, top],
            [fx + 4.5 * s, top + 6 * s],
          ]
        : [
            [fx - 3.8 * s, top + 6 * s],
            [fx - 3.2 * s, top + 1.5 * s],
            [fx, top + 3 * s],
            [fx + 3.2 * s, top + 1.5 * s],
            [fx + 3.8 * s, top + 6 * s],
          ];
    shade(t, m((k) => k.poly(pts)), GOLD, { band: 1 });
    t.fillStyle = RED_ROBE[1];
    t.fillRect(Math.floor(fx), Math.round(top + 4 * s), 1, 1);
  }
  // The large letter.
  const letter = GLYPHS[rank];
  if (up) bitmap(t, letter, 16, 38, ink, 2);
  else bitmap(t, letter, 21, 9, ink, 2);
}

function paintFace(t: CanvasRenderingContext2D, card: string, layout: CardLayout) {
  const { w, h } = FACE[layout];
  paintBlank(t, w, h, false);
  paintIndex(t, card, w, h);
  const color = colorOf(card);
  const rank = card[0];
  const suit = card[1];
  if (rank === 'A') {
    const s = layout === 'upright' ? 3 : 2;
    bitmap(t, PIP7[suit], Math.floor((w - 7 * s) / 2), Math.floor((h - 7 * s) / 2), color, s);
  } else if (rank === 'J' || rank === 'Q' || rank === 'K') paintCourt(t, card, layout);
  else for (const p of pipSpots(rank, layout)) bitmap(t, layout === 'upright' ? PIP7[suit] : PIP5[suit], p.x, p.y, color, 1, p.turned);
}

const arts = new Map<string, HTMLCanvasElement | null>();

/** A card (or 'back') at art resolution, cached. A hand-drawn public/sprites/card-<card>-<layout>.png wins. */
export function cardArt(card: Card | 'back', layout: CardLayout): HTMLCanvasElement | null {
  const key = `${card}|${layout}|${spriteVersion()}`;
  if (arts.has(key)) return arts.get(key)!;
  const own = override(`card-${card}-${layout}`);
  const { w, h } = CARD_ART[layout];
  const c = own ?? offscreen(w, h);
  if (c && !own) {
    const t = c.getContext('2d')!;
    const face = FACE[layout];
    if (card === 'back') paintBlank(t, face.w, face.h, true);
    else paintFace(t, card, layout);
    if (layout === 'upright') {
      // A 1 px shadow edge along the bottom and right.
      const m = cardMask(face.w, face.h);
      t.fillStyle = EDGE;
      for (let y = 0; y <= face.h; y++)
        for (let x = 0; x <= face.w; x++) if (!m.get(x, y) && m.get(x - 1, y - 1)) t.fillRect(x, y, 1, 1);
    } else {
      // The card's thickness: two darker rows under the face, following its cut corners.
      for (let k = 0; k < 2; k++) {
        t.fillStyle = THICK[k];
        t.fillRect(2 - k, face.h + k, face.w - 4 + 2 * k, 1);
      }
      t.fillStyle = OUTLINE;
      t.fillRect(1, face.h + 1, 1, 1);
      t.fillRect(face.w - 2, face.h + 1, 1, 1);
    }
  }
  arts.set(key, c);
  return c;
}

/** The whole-number scale for a card about `width` pixels wide. */
export const cardScale = (width: number, layout: CardLayout) => Math.max(1, Math.round(width / CARD_ART[layout].w));

const scaled = new Map<string, HTMLCanvasElement | null>();

/** A card face about `width` pixels wide: the art enlarged by a whole number (never squashed). */
export function drawCardFace(card: Card | 'back', width: number, layout: CardLayout): HTMLCanvasElement | null {
  const k = cardScale(width, layout);
  const key = `${card}|${layout}|${k}|${spriteVersion()}`;
  if (scaled.has(key)) return scaled.get(key)!;
  if (scaled.size > 400) scaled.clear();
  const art = cardArt(card, layout);
  const c = art ? offscreen(art.width * k, art.height * k) : null;
  if (c && art) {
    const t = c.getContext('2d')!;
    t.imageSmoothingEnabled = false;
    t.drawImage(art, 0, 0, art.width * k, art.height * k);
  }
  scaled.set(key, c);
  return c;
}

/* --------------------------- opponents' card backs -------------------------- */

/** A small card back held by an opponent: 9×13, white border, red with a diamond lattice. */
export function miniBack(): HTMLCanvasElement | null {
  const key = `mini|${spriteVersion()}`;
  if (arts.has(key)) return arts.get(key)!;
  const own = override('card-back-mini');
  const c = own ?? offscreen(9, 13);
  if (c && !own) {
    const t = c.getContext('2d')!;
    const m = cardMask(9, 13);
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 9; x++) {
        if (!m.get(x, y)) continue;
        const edge = !m.get(x - 1, y) || !m.get(x + 1, y) || !m.get(x, y - 1) || !m.get(x, y + 1);
        const rim = x === 1 || y === 1 || x === 7 || y === 11;
        t.fillStyle = edge ? OUTLINE : rim ? PAPER : (x + y) % 3 === 0 || (x - y + 30) % 3 === 0 ? BACK_LINE : BACK_RED;
        t.fillRect(x, y, 1, 1);
      }
  }
  arts.set(key, c);
  return c;
}
