/*
 * The table in world units, and the camera that projects it to the screen.
 *
 * World: the table's centre is the origin; x runs to my right, z away from me
 * across the table, y up. The felt is at y = 0. I sit at the middle of the near
 * long side (negative z) and the camera is at my eyes, looking across and down.
 */

/** Half the table's length (centre to the tip of a rounded end), to the outside of the rail. */
export const TABLE_L = 1.3;
/** Half the table's depth, to the outside of the rail. The ends are half-circles of this radius. */
export const TABLE_R = 0.7;
/** Half the length of the straight long sides. */
export const STRAIGHT = TABLE_L - TABLE_R;
export const RAIL_W = 0.1;
/** Height of the padded rail's top above the felt. */
export const RAIL_H = 0.035;
/** Opponents sit this far outside the rail. */
export const SEAT_GAP = 0.2;
/** How tall a seated opponent stands above the rail (their sprite scales from this with distance). */
export const PERSON_H = 0.46;

/** The camera circles the point it looks at, this far away: about my eyes, sitting at the near side. */
const EYE_DISTANCE = 1.9;
const LOOK_AT_Z = -0.1;

export type Vec = { x: number; z: number };

/** Length of the outline of a stadium (long straight sides, half-circle ends) with end radius `r`. */
export function stadiumLength(r: number): number {
  return 4 * STRAIGHT + 2 * Math.PI * r;
}

/**
 * The point at distance `u` along that outline, with its outward normal. 0 is
 * the middle of the near side; `u` grows toward my left, round the far side and
 * back along my right.
 */
export function stadiumAt(r: number, u: number): Vec & { nx: number; nz: number } {
  const total = stadiumLength(r);
  u = ((u % total) + total) % total;
  const arc = Math.PI * r;
  // Near side, from the middle going left.
  if (u <= STRAIGHT) return { x: -u, z: -r, nx: 0, nz: -1 };
  u -= STRAIGHT;
  // Left end: a half-circle round (−STRAIGHT, 0), from the near side to the far side.
  if (u <= arc) {
    const a = -Math.PI / 2 - u / r;
    return { x: -STRAIGHT + r * Math.cos(a), z: r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
  }
  u -= arc;
  // Far side, left to right.
  if (u <= 2 * STRAIGHT) return { x: -STRAIGHT + u, z: r, nx: 0, nz: 1 };
  u -= 2 * STRAIGHT;
  // Right end, far side to near side.
  if (u <= arc) {
    const a = Math.PI / 2 - u / r;
    return { x: STRAIGHT + r * Math.cos(a), z: r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
  }
  u -= arc;
  // Near side, from the right back to the middle.
  return { x: STRAIGHT - u, z: -r, nx: 0, nz: -1 };
}

/** The whole outline as `n` points. */
export function stadium(r: number, n = 72): Vec[] {
  const total = stadiumLength(r);
  return Array.from({ length: n }, (_, i) => stadiumAt(r, (i / n) * total));
}

/** The stretch of the seat ring opponents use: from a little below the middle of my left end, round the far side, to the same point on the right. */
export function opponentArc(): [number, number] {
  const r = TABLE_R + SEAT_GAP;
  const below = (22 * Math.PI) / 180;
  const from = STRAIGHT + r * (Math.PI / 2 - below);
  return [from, stadiumLength(r) - from];
}

/* --------------------------------- camera --------------------------------- */

export interface Camera {
  /** Canvas size in internal pixels. */
  w: number;
  h: number;
  /** Where the eye is, and the pitch (degrees below level) it looks down at. */
  eyeY: number;
  eyeZ: number;
  cos: number;
  sin: number;
  pitch: number;
  /** Focal length in pixels, and where the view's axis lands on screen. */
  f: number;
  cx: number;
  cy: number;
}

/** A projected point; `s` is pixels per world unit at that depth (nearer is bigger). */
export type Projected = { x: number; y: number; s: number };

export function project(cam: Pick<Camera, 'eyeY' | 'eyeZ' | 'cos' | 'sin' | 'f' | 'cx' | 'cy'>, x: number, y: number, z: number): Projected {
  const py = y - cam.eyeY;
  const pz = z - cam.eyeZ;
  // The camera looks along (0, −sin, cos); its up is (0, cos, sin).
  const depth = pz * cam.cos - py * cam.sin;
  const up = py * cam.cos + pz * cam.sin;
  const s = cam.f / depth;
  return { x: cam.cx + x * s, y: cam.cy - up * s, s };
}

/**
 * Points that must be on screen: the table, and every place an opponent can
 * sit. People are flat, upright sprites standing on the rail, so for them `up`
 * and `half` (world units, scaled like the sprite) give the top of the head
 * and the shoulders' width.
 */
function fitPoints(): { x: number; y: number; z: number; up: number; half: number }[] {
  const out: { x: number; y: number; z: number; up: number; half: number }[] = [];
  for (const p of stadium(TABLE_R + 0.03, 96)) out.push({ x: p.x, y: 0, z: p.z, up: 0, half: 0 });
  const [from, to] = opponentArc();
  const inset = SEAT_GAP + RAIL_W / 2;
  for (let i = 0; i <= 40; i++) {
    const p = stadiumAt(TABLE_R + SEAT_GAP, from + ((to - from) * i) / 40);
    out.push({ x: p.x - p.nx * inset, y: RAIL_H, z: p.z - p.nz * inset, up: (PERSON_H * 54) / 48, half: PERSON_H * 0.5 });
  }
  return out;
}
const FIT = fitPoints();

/**
 * Fit the camera to a canvas: how steeply it looks down (36°–55°) and how far
 * it zooms, so the table and every seat fit with `margin` internal pixels free
 * at the top and sides (for name plates) and the bottom. Of the views that zoom
 * in nearly as far as the best, it takes the steepest, so tall screens see more
 * of the felt and wide, short ones a flatter view.
 */
export function fitCamera(w: number, h: number, margin: { top: number; side: number; bottom: number }): Camera {
  const cams: Camera[] = [];
  for (let pitch = 36; pitch <= 55; pitch += 1) {
    const rad = (pitch * Math.PI) / 180;
    const eye = { eyeY: EYE_DISTANCE * Math.sin(rad), eyeZ: LOOK_AT_Z - EYE_DISTANCE * Math.cos(rad) };
    const unit = { ...eye, cos: Math.cos(rad), sin: Math.sin(rad), f: 1, cx: 0, cy: 0 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of FIT) {
      const q = project(unit, p.x, p.y, p.z);
      minX = Math.min(minX, q.x - p.half * q.s);
      maxX = Math.max(maxX, q.x + p.half * q.s);
      minY = Math.min(minY, q.y - p.up * q.s);
      maxY = Math.max(maxY, q.y);
    }
    const f = Math.max(1, Math.min((w - 2 * margin.side) / (maxX - minX), (h - margin.top - margin.bottom) / (maxY - minY)));
    // Centred across, with the near rail at the bottom.
    cams.push({ w, h, ...unit, pitch, f, cx: w / 2 - (f * (minX + maxX)) / 2, cy: h - margin.bottom - f * maxY });
  }
  // The steepest view that loses little zoom: tall screens get a fuller view of the felt.
  const top = Math.max(...cams.map((c) => c.f));
  return cams.filter((c) => c.f >= top * 0.93).reduce((a, b) => (b.pitch > a.pitch ? b : a));
}
