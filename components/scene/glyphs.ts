/*
 * A hand-made pixel font for cards: 5×7 ranks (with "10" squeezed into one
 * 7-wide glyph) and 5×7 suits, drawn at whole-pixel positions and whole-number
 * scales only, so they never blur. Plus 3×5 letters for the D/SB/BB markers.
 */

export const INK = '#0c0916';
export const BONE = '#f4ead5';
export const CARD_RED = '#d8352b';
/** Near-black for spades and clubs. */
export const CARD_BLACK = '#1b1626';

/** 5×7 ranks; 'T' is "10" as two narrow digits, 7 wide. */
export const GLYPHS: Record<string, string[]> = {
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  K: ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'],
  Q: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X.X.X', 'X..X.', '.XX.X'],
  J: ['..XXX', '...X.', '...X.', '...X.', '...X.', 'X..X.', '.XX..'],
  T: ['.X..XX.', 'XX.X..X', '.X.X..X', '.X.X..X', '.X.X..X', '.X.X..X', 'XXX.XX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '...X.', '.XX..'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '.X...', '.X...', '.X...'],
  '6': ['..XX.', '.X...', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '4': ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '3': ['XXXX.', '....X', '....X', '.XXX.', '....X', '....X', 'XXXX.'],
  '2': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
};

/** 5×7 suits. */
export const SUITS: Record<string, string[]> = {
  s: ['..X..', '.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '..X..', '.XXX.'],
  h: ['.....', '.X.X.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  d: ['..X..', '.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  c: ['.XXX.', '.XXX.', 'XXXXX', 'XXXXX', 'XX.XX', '..X..', '.XXX.'],
};

/** 3×5 letters for table markers. */
export const LETTERS: Record<string, string[]> = {
  D: ['XX.', 'X.X', 'X.X', 'X.X', 'XX.'],
  S: ['.XX', 'X..', '.X.', '..X', 'XX.'],
  B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'],
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  N: ['X.X', 'XXX', 'XXX', 'X.X', 'X.X'],
};

export const suitColor = (card: string) => (card[1] === 'h' || card[1] === 'd' ? CARD_RED : CARD_BLACK);
const glyphWidth = (rows: string[]) => rows[0].length;

/** Draw a bitmap with its top-left at (x, y), `scale` canvas pixels per cell, snapped to whole pixels. */
export function stamp(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, color: string, scale = 1) {
  scale = Math.max(1, Math.round(scale));
  ctx.fillStyle = color;
  x = Math.round(x);
  y = Math.round(y);
  rows.forEach((row, dy) => [...row].forEach((c, dx) => c === 'X' && ctx.fillRect(x + dx * scale, y + dy * scale, scale, scale)));
}

/**
 * A card's face inside a pixel box: the rank with its suit under it in the
 * top-left corner (at `index` scale, shrunk only if the box is too small) and
 * a large suit in the middle of the space left. The box must already be the
 * cream face; this only draws the marks.
 */
export function cardMarks(ctx: CanvasRenderingContext2D, card: string, box: { x: number; y: number; w: number; h: number }, index: number) {
  const color = suitColor(card);
  const rank = GLYPHS[card[0]];
  const suit = SUITS[card[1]];
  // Too short for the suit under the rank (a flat card far away): rank and suit side by side, nothing else.
  if (box.h < 17) {
    const rw = glyphWidth(rank);
    const total = rw + 1 + 5;
    const x0 = box.x + Math.max(1, Math.floor((box.w - total) / 2));
    const y0 = box.y + Math.max(1, Math.floor((box.h - 7) / 2));
    stamp(ctx, rank, x0, y0, color);
    if (box.w >= total + 2) stamp(ctx, suit, x0 + rw + 1, y0, color);
    return;
  }
  // The index needs 7 + 1 + 7 cells of height and the rank's width; shrink the scale until it fits.
  let s = Math.max(1, Math.floor(index));
  while (s > 1 && (15 * s + 3 > box.h || glyphWidth(rank) * s + 3 > box.w)) s--;
  const ix = box.x + Math.max(1, Math.round(s * 0.7)) + 1;
  const iy = box.y + Math.max(1, Math.round(s * 0.7)) + 1;
  stamp(ctx, rank, ix, iy, color, s);
  const indexH = 15 * s + 1;
  if (box.h >= indexH + 3) stamp(ctx, suit, ix, iy + 8 * s, color, s);
  // The big suit: as large as fits right of and below the index's column.
  const left = ix + glyphWidth(rank) * s + s;
  const room = { w: box.x + box.w - left - 2, h: box.h - 4 };
  const big = Math.min(Math.floor(room.w / 5), Math.floor(room.h / 7), Math.max(s * 2, 1));
  if (big >= 1 && room.w >= 5) {
    stamp(ctx, suit, left + Math.floor((room.w - 5 * big) / 2), box.y + Math.floor((box.h - 7 * big) / 2) + Math.min(s, 2), color, big);
  }
}

/** A small canvas, or null where there's no DOM (tests, server). */
export function offscreen(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
