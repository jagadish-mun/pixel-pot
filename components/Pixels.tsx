/* Pixel-art drawing: chips, faces and icons, all as crisp SVG rects. */

import { denom } from '@/lib/chips';
import { facePattern } from '@/lib/faces';

export { faceColor } from '@/lib/faces';

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

/** A 5x5 mirrored pixel badge, different for every player. */
export function Face({ seed, size = 36 }: { seed: string; size?: number }) {
  const { color, cells } = facePattern(seed, false);
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

/** A pixel robot head: the face of a computer player. */
export function RobotFace({ seed, size = 36 }: { seed: string; size?: number }) {
  const { color, cells } = facePattern(seed, true);
  return (
    <svg className="face" width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={9} height={9} fill="#2b2440" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}
