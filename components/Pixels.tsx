/* Pixel-art drawing: chips, faces, cards and icons, all as crisp SVG rects. */

import { denom } from '@/lib/chips';

const INK = '#0c0916';

/** A single chip seen from above, used on buttons and as the logo. */
export function ChipFace({ value = 10, size = 32 }: { value?: number; size?: number }) {
  const d = { body: denom(value).face, stripe: denom(value).stripe };
  // 12x12 grid: a chunky octagon with four edge marks.
  const rows = ['....XXXX....', '..XXXXXXXX..', '.XXXXXXXXXX.', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX'];
  const all = [...rows, ...rows.slice().reverse()];
  return (
    <svg width={size} height={size} viewBox="-1 -1 14 14" shapeRendering="crispEdges" aria-hidden="true">
      {all.map((row, y) => {
        const first = row.indexOf('X');
        const len = row.lastIndexOf('X') - first + 1;
        return <rect key={`o${y}`} x={first - 1} y={y - 1} width={len + 2} height={3} fill={INK} />;
      })}
      {all.map((row, y) => {
        const first = row.indexOf('X');
        const len = row.lastIndexOf('X') - first + 1;
        return <rect key={y} x={first} y={y} width={len} height={1} fill={d.body} />;
      })}
      <rect x={5} y={0} width={2} height={2} fill={d.stripe} />
      <rect x={5} y={10} width={2} height={2} fill={d.stripe} />
      <rect x={0} y={5} width={2} height={2} fill={d.stripe} />
      <rect x={10} y={5} width={2} height={2} fill={d.stripe} />
      <rect x={4} y={4} width={4} height={4} fill={d.stripe} />
      <rect x={5} y={5} width={2} height={2} fill={d.body} />
    </svg>
  );
}

function hash(text: string): number {
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

/** A 5x5 mirrored pixel badge, different for every player. */
export function Face({ seed, size = 36 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const color = FACE_COLORS[h % FACE_COLORS.length];
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
  return (
    <svg className="face" width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={7} height={7} fill="#2b2440" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}

/** A pixel speaker, with a cross when muted. */
export function Speaker({ muted, size = 20 }: { muted: boolean; size?: number }) {
  const body: [number, number, number, number][] = [
    [1, 3, 2, 3],
    [3, 2, 1, 5],
    [4, 1, 1, 7],
  ];
  const sound: [number, number, number, number][] = muted
    ? [
        [6, 2, 1, 1],
        [8, 2, 1, 1],
        [7, 3, 1, 1],
        [6, 4, 1, 1],
        [8, 4, 1, 1],
      ]
    : [
        [6, 3, 1, 3],
        [7, 2, 1, 1],
        [7, 6, 1, 1],
        [8, 1, 1, 7],
      ];
  return (
    <svg width={size} height={size} viewBox="0 0 10 9" shapeRendering="crispEdges" aria-hidden="true">
      {[...body, ...sound].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

/* ---------------------------------- cards ---------------------------------- */

// 7×7 suit bitmaps, drawn as pixels so they stay crisp at any size.
const SUIT_PIXELS: Record<string, string[]> = {
  h: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  d: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  s: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '...X...', '..XXX..'],
  c: ['..XXX..', '..XXX..', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'],
};
const CARD_RED = '#d8352b';

function SuitPixels({ suit, x, y, color }: { suit: string; x: number; y: number; color: string }) {
  return (
    <>
      {SUIT_PIXELS[suit].flatMap((row, dy) =>
        [...row].map((cell, dx) => (cell === 'X' ? <rect key={`${dx}-${dy}`} x={x + dx} y={y + dy} width={1} height={1} fill={color} /> : null)),
      )}
    </>
  );
}

/** A face-up playing card ("As", "Td"), 20×28 pixel grid, sized by its container. */
export function PlayingCard({ card }: { card: string }) {
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const color = suit === 'h' || suit === 'd' ? CARD_RED : INK;
  return (
    <svg width="100%" height="100%" viewBox="0 0 20 28" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={20} height={28} fill={INK} />
      <rect x={1} y={1} width={18} height={26} fill="#f4ead5" />
      <text
        x={rank.length === 2 ? 1.5 : 2.5}
        y={10}
        fontFamily="'Press Start 2P', monospace"
        fontSize={8}
        letterSpacing={rank.length === 2 ? -1 : 0}
        fill={color}
      >
        {rank}
      </text>
      <SuitPixels suit={suit} x={7} y={15} color={color} />
    </svg>
  );
}

// Robot heads for computer players (7×7, mirrored like Face), picked by seed.
const ROBOTS = [
  ['...X...', '.XXXXX.', '.X.X.X.', '.XXXXX.', '.X...X.', '.XXXXX.', '..X.X..'],
  ['X.....X', '.XXXXX.', 'XX.X.XX', '.XXXXX.', '.XX.XX.', '.XXXXX.', '.X...X.'],
  ['..XXX..', '.XXXXX.', 'X.X.X.X', 'XXXXXXX', 'X.XXX.X', '.XXXXX.', 'XX...XX'],
];

/** A pixel robot head: the face of a computer player. */
export function RobotFace({ seed, size = 36 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const rows = ROBOTS[h % ROBOTS.length];
  const color = FACE_COLORS[(h >>> 4) % FACE_COLORS.length];
  return (
    <svg className="face" width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={9} height={9} fill="#2b2440" />
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) => (cell === 'X' ? <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1} height={1} fill={color} /> : null)),
      )}
    </svg>
  );
}
