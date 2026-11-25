/* Pixel-art drawing: chips, faces and icons, all as crisp SVG rects. */

import { chipFaceRows, denom } from '@/lib/chips';
import { facePattern } from '@/lib/faces';

export { faceColor } from '@/lib/faces';

const INK = '#0c0916';

/**
 * A single chip seen from above: the same "dice" chip as on the table (base
 * colour, six edge inserts, a dashed inner ring), on buttons, in the feed and
 * as the logo. `color` overrides the base colour (white inserts).
 */
export function ChipFace({ value = 10, size = 32, color }: { value?: number; size?: number; color?: string }) {
  const den = denom(value);
  const palette: Record<string, string> = color
    ? { o: INK, b: color, i: '#f4ead5', r: '#f4ead5' }
    : { o: INK, b: den.face, i: den.stripe, r: den.stripe };
  const rows = chipFaceRows(14);
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[c]} />)))}
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
