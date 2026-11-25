/* Pixel-art drawing: chips, chip stacks and player faces, all as crisp SVG rects. */

const DENOMS = [
  { value: 25000, body: '#2b2440', stripe: '#f5b83d' },
  { value: 5000, body: '#e96aa8', stripe: '#fde3ef' },
  { value: 1000, body: '#f5b83d', stripe: '#fff3c9' },
  { value: 500, body: '#9460e0', stripe: '#e6d9ff' },
  { value: 100, body: '#3f7fe0', stripe: '#dbe8ff' },
  { value: 25, body: '#2fa56d', stripe: '#d5f5e3' },
  { value: 5, body: '#e2483d', stripe: '#ffe0dc' },
  { value: 1, body: '#f4ead5', stripe: '#b9ad94' },
];
const INK = '#0c0916';
const CHIP_W = 14;

/** Break an amount into chip columns, the way you'd stack it on a table. */
function columns(amount: number, maxColumns: number, maxPerColumn: number): { body: string; stripe: string; count: number }[] {
  if (amount <= 0) return [];
  // Start from a chip worth about a third of the amount so stacks look like stacks, not one big chip.
  let rest = amount;
  const out: { body: string; stripe: string; count: number }[] = [];
  const top = DENOMS.findIndex((d) => d.value <= Math.max(1, amount / 3));
  for (const d of DENOMS.slice(Math.max(0, top))) {
    const count = Math.floor(rest / d.value);
    if (count > 0) {
      out.push({ body: d.body, stripe: d.stripe, count: Math.min(count, maxPerColumn) });
      rest -= count * d.value;
    }
  }
  return out.slice(0, maxColumns);
}

export function ChipStack({
  amount,
  scale = 2,
  maxColumns = 4,
  maxPerColumn = 10,
}: {
  amount: number;
  scale?: number;
  maxColumns?: number;
  maxPerColumn?: number;
}) {
  const cols = columns(amount, maxColumns, maxPerColumn);
  if (cols.length === 0) return null;
  const tallest = Math.max(...cols.map((c) => c.count));
  const height = tallest * 3 + 2;
  const width = cols.length * (CHIP_W + 2) - 2;
  return (
    <svg
      className="chipstack"
      width={width * scale}
      height={height * scale}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {cols.map((col, c) => {
        const x = c * (CHIP_W + 2);
        return Array.from({ length: col.count }, (_, i) => {
          const y = height - 5 - i * 3;
          return (
            <g key={`${c}-${i}`}>
              <rect x={x} y={y} width={CHIP_W} height={5} fill={INK} />
              <rect x={x + 1} y={y + 1} width={CHIP_W - 2} height={3} fill={col.body} />
              <rect x={x + 3} y={y + 1} width={2} height={3} fill={col.stripe} />
              <rect x={x + 9} y={y + 1} width={2} height={3} fill={col.stripe} />
              <rect x={x + 1} y={y + 3} width={CHIP_W - 2} height={1} fill="rgba(12,9,22,.28)" />
            </g>
          );
        });
      })}
    </svg>
  );
}

/** A single chip seen from above, used on buttons and as the logo. */
export function ChipFace({ value, size = 32 }: { value?: number; size?: number }) {
  const d = DENOMS.find((x) => x.value === value) ?? DENOMS[6];
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

/** The back of a card: a red pixel lattice inside a bone border. */
export function CardBack() {
  const cells: [number, number][] = [];
  for (let y = 3; y < 11; y++) for (let x = 3; x < 7; x++) if ((x + y) % 2 === 0) cells.push([x, y]);
  return (
    <svg width="100%" height="100%" viewBox="0 0 10 14" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={10} height={14} fill={INK} />
      <rect x={1} y={1} width={8} height={12} fill="#f4ead5" />
      <rect x={2} y={2} width={6} height={10} fill="#e2483d" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#9c2a2a" />
      ))}
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
