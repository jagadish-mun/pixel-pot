/* Every player's face: a pattern and colour picked from their id and name, used by the SVG faces and the table scene. */

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const FACE_COLORS = ['#f5b83d', '#e2483d', '#3f7fe0', '#2fa56d', '#9460e0', '#e96aa8', '#4cc9c0', '#f08a3c'];

/** A player's colour, the same one their face uses. */
export const faceColor = (seed: string) => FACE_COLORS[hash(seed) % FACE_COLORS.length];

// Robot heads for computer players (7×7, mirrored like Face), picked by seed.
const ROBOTS = [
  ['...X...', '.XXXXX.', '.X.X.X.', '.XXXXX.', '.X...X.', '.XXXXX.', '..X.X..'],
  ['X.....X', '.XXXXX.', 'XX.X.XX', '.XXXXX.', '.XX.XX.', '.XXXXX.', '.X...X.'],
  ['..XXX..', '.XXXXX.', 'X.X.X.X', 'XXXXXXX', 'X.XXX.X', '.XXXXX.', 'XX...XX'],
];

/**
 * A player's face pattern: lit cells on a `size`×`size` grid (inside a one-cell
 * border) and their colour. People get a 5×5 mirrored badge; computer players a
 * robot head. The SVG faces and the table's canvas both draw from this.
 */
export function facePattern(seed: string, robot: boolean): { size: number; color: string; cells: [number, number][] } {
  const h = hash(seed);
  if (robot) {
    const rows = ROBOTS[h % ROBOTS.length];
    const cells: [number, number][] = [];
    rows.forEach((row, y) => [...row].forEach((c, x) => c === 'X' && cells.push([x, y])));
    return { size: 7, color: FACE_COLORS[(h >>> 4) % FACE_COLORS.length], cells };
  }
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >>> (3 + y * 3 + x)) & 1) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  if (cells.length < 4) cells.push([2, 1], [1, 2], [3, 2], [2, 3]);
  return { size: 5, color: FACE_COLORS[h % FACE_COLORS.length], cells };
}

