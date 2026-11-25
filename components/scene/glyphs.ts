/* Pixel bitmaps for cards: rank glyphs and suit pips, and a stamp that draws them crisp at any whole-number scale. */

export const INK = '#0c0916';
export const BONE = '#f4ead5';
export const CARD_RED = '#d8352b';

/** 3×5 rank glyphs ('T' is drawn as "10"). */
export const GLYPHS: Record<string, string[]> = {
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

/** 7×7 suit pips. */
export const SUITS: Record<string, string[]> = {
  h: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  d: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  s: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '...X...', '..XXX..'],
  c: ['..XXX..', '..XXX..', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'],
};

/** 5×5 pips for small cards. */
export const SMALL_SUITS: Record<string, string[]> = {
  h: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  d: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '..X..'],
  s: ['..X..', '.XXX.', 'XXXXX', 'XXXXX', '.XXX.'],
  c: ['.XXX.', '.XXX.', 'XXXXX', 'XX.XX', '.XXX.'],
};

export const rankGlyphs = (card: string) => (card[0] === 'T' ? ['1', '0'] : [card[0]]);
export const suitColor = (card: string) => (card[1] === 'h' || card[1] === 'd' ? CARD_RED : INK);

/** Draw a bitmap with its top-left at (x, y), `scale` canvas pixels per cell. */
export function stamp(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, color: string, scale = 1) {
  ctx.fillStyle = color;
  x = Math.round(x);
  y = Math.round(y);
  rows.forEach((row, dy) => [...row].forEach((c, dx) => c === 'X' && ctx.fillRect(x + dx * scale, y + dy * scale, scale, scale)));
}

/** A small canvas, or null where there's no DOM (tests, server). */
export function offscreen(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
