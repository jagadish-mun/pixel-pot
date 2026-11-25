/* Where everyone sits, and where their cards, chips and bets go on the felt. */
import { RAIL_W, SEAT_GAP, TABLE_R, opponentArc, stadiumAt, type Vec } from './project';

export interface SeatSpot extends Vec {
  /** Outward normal: away from the table's centre. */
  nx: number;
  nz: number;
}

/**
 * Seats for `count` opponents (1–9), in table order starting on my left: up my
 * left end, along the far side, down the right end. Evenly spaced along that
 * stretch of the seat ring, so one opponent sits straight across from me.
 */
export function seatLayout(count: number): SeatSpot[] {
  const [from, to] = opponentArc();
  const step = (to - from) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => {
    const p = stadiumAt(TABLE_R + SEAT_GAP, from + (i + 0.5) * step);
    return { x: p.x, z: p.z, nx: p.nx, nz: p.nz };
  });
}

/** My seat: the middle of the near long side. */
export const MY_SEAT: SeatSpot = { x: 0, z: -(TABLE_R + SEAT_GAP), nx: 0, nz: -1 };

/** A point on the felt `inset` in from the rail, in front of a seat. */
export function onFelt(seat: SeatSpot, inset: number): Vec {
  const d = SEAT_GAP + RAIL_W + inset;
  return { x: seat.x - seat.nx * d, z: seat.z - seat.nz * d };
}

/** How far in from the rail: face-down cards, the chip stack, and this street's bet. */
export const CARDS_INSET = 0.05;
export const STACK_INSET = 0.17;
export const BET_INSET = 0.31;

/**
 * Where a seat's chips, cards and bet sit on the felt. Mine sit on the line
 * between my hands and the middle, at `myZ`, with the bet a little further in.
 */
export function spots(seat: SeatSpot, me: boolean, myZ = -0.42): { cards: Vec; stack: Vec; bet: Vec } {
  if (me) return { cards: onFelt(seat, CARDS_INSET), stack: { x: 0, z: myZ }, bet: { x: 0, z: myZ + 0.15 } };
  return { cards: onFelt(seat, CARDS_INSET + 0.03), stack: onFelt(seat, STACK_INSET), bet: onFelt(seat, BET_INSET) };
}

/** The top of the rail in front of a seat, where an opponent rests their arms. */
export function railPoint(seat: SeatSpot): Vec {
  return onFelt(seat, -RAIL_W / 2);
}

/** The board lies across the middle; the pot sits beside it, on my right. */
export const BOARD_Z = 0.1;
export const POT_SPOT: Vec = { x: 0.5, z: BOARD_Z };

/**
 * Seats for a table seen from `meIndex`'s chair: the players rotated so I come
 * first, then each opponent with their seat in table order.
 */
export function arrangeSeats<T>(players: T[], meIndex: number): { player: T; index: number; seat: SeatSpot; me: boolean }[] {
  const n = players.length;
  const layout = seatLayout(n - 1);
  return players.map((_, k) => {
    const index = (meIndex + k) % n;
    return { player: players[index], index, seat: k === 0 ? MY_SEAT : layout[k - 1], me: k === 0 };
  });
}
