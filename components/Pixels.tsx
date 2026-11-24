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
