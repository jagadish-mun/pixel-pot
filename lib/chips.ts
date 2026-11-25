/* Chip denominations, how an amount is split into chips and towers, and how a chip looks. */

export interface ChipDenom {
  value: number;
  /** The chip's base colour (its face), and the darker colour of its side. */
  face: string;
  side: string;
  /** The edge inserts and the dashed inner ring, on the face and on the side. */
  stripe: string;
  sideStripe: string;
}

/** Biggest first. Classic "dice" clay chips: a base colour with six contrasting edge inserts. */
export const CHIP_DENOMS: ChipDenom[] = [
  { value: 500, face: '#2f2a36', side: '#1c1922', stripe: '#f4ead5', sideStripe: '#cfc5b0' },
  { value: 100, face: '#3f7fe0', side: '#2a5bad', stripe: '#f4ead5', sideStripe: '#cfc5b0' },
  { value: 25, face: '#2fa56d', side: '#1f7349', stripe: '#f4ead5', sideStripe: '#cfc5b0' },
  { value: 10, face: '#e2483d', side: '#a82f27', stripe: '#f4ead5', sideStripe: '#cfc5b0' },
  { value: 5, face: '#f4ead5', side: '#c9bea6', stripe: '#3f7fe0', sideStripe: '#2f63b5' },
];

export const CHIP_VALUES = CHIP_DENOMS.map((d) => d.value);

export const denom = (value: number): ChipDenom => CHIP_DENOMS.find((d) => d.value === value) ?? CHIP_DENOMS[3];

/** One chip broken into smaller ones. */
const SPLITS: Record<number, number[]> = {
  500: [100, 100, 100, 100, 100],
  100: [25, 25, 25, 25],
  25: [10, 10, 5],
  10: [5, 5],
};

/**
 * Chips for an amount. Without `targetCount`, the fewest chips (greedy, biggest
 * first). With it, start from the fewest and keep breaking one chip into
 * smaller ones, the biggest value first, while the count stays at or under
 * `targetCount`. Whatever is under the smallest chip is the remainder.
 */
export function chipBreakdown(amount: number, targetCount?: number): { chips: { value: number; count: number }[]; remainder: number } {
  let rest = Math.max(0, Math.floor(amount));
  const counts = new Map<number, number>();
  for (const value of CHIP_VALUES) {
    const count = Math.floor(rest / value);
    if (count > 0) counts.set(value, count);
    rest -= count * value;
  }
  if (targetCount !== undefined) {
    let total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (;;) {
      const value = CHIP_VALUES.find((v) => SPLITS[v] && (counts.get(v) ?? 0) > 0 && total + SPLITS[v].length - 1 <= targetCount);
      if (value === undefined) break;
      counts.set(value, counts.get(value)! - 1);
      for (const smaller of SPLITS[value]) counts.set(smaller, (counts.get(smaller) ?? 0) + 1);
      total += SPLITS[value].length - 1;
    }
  }
  const chips = CHIP_VALUES.filter((v) => (counts.get(v) ?? 0) > 0).map((value) => ({ value, count: counts.get(value)! }));
  return { chips, remainder: rest };
}

/** Chip counts: from `min` for the poorest to the richest at the table; bets and the pot at most `bet`. */
export const WEALTH = { min: 2, opponent: 12, me: 16, bet: 8 };
/** Chips a tower: stacks, and bets or the pot. */
export const PER_TOWER = { stack: 6, bet: 4 };

/**
 * How many chips a pile should have so piles show relative wealth: from `min`
 * for the poorest to `max` for the richest stack at the table. Any chips at all
 * get at least one; none get none.
 */
export function wealthTarget(amount: number, richest: number, max: number, min = WEALTH.min): number {
  if (amount <= 0) return 0;
  return Math.max(1, Math.round(min + ((max - min) * amount) / Math.max(1, richest, amount)));
}

/** Most chips ever drawn in one pile, however the amount splits. */
const MAX_DRAWN = 90;

/**
 * Towers to draw: one colour per tower, at most `perTower` chips each (more
 * towers of a colour side by side), biggest values first. `undrawn` is the
 * value not shown as chips: the remainder under 5, plus anything over the cap.
 */
export function chipTowers(
  amount: number,
  { target, perTower = 15, maxChips = MAX_DRAWN }: { target?: number; perTower?: number; maxChips?: number } = {},
): { towers: { value: number; count: number }[]; undrawn: number } {
  const { chips, remainder } = chipBreakdown(amount, target);
  const towers: { value: number; count: number }[] = [];
  let budget = maxChips;
  let undrawn = remainder;
  for (const { value, count } of chips) {
    const drawn = Math.min(count, budget);
    budget -= drawn;
    undrawn += (count - drawn) * value;
    for (let left = drawn; left > 0; left -= perTower) towers.push({ value, count: Math.min(perTower, left) });
  }
  return { towers, undrawn };
}

/**
 * A chip seen from above, `d` pixels across, as rows of one-letter colours:
 * '.' none, 'o' outline, 'b' base, 'i' edge insert, 'r' dashed inner ring.
 * Six rectangular inserts round the rim, a thin dashed ring, a plain centre.
 * The SVG chip icon and the table's canvas both draw from this.
 */
export function chipFaceRows(d: number): string[] {
  const rows: string[] = [];
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    let row = '';
    for (let x = 0; x < d; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const dist = Math.hypot(dx, dy) / r;
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      if (dist > 1) row += '.';
      else if (dist > 1 - Math.max(1, d * 0.07) / r) row += 'o';
      else if (dist > 0.62 && Math.abs(((angle + 30) % 60) - 30) < 11) row += 'i';
      else if (d >= 10 && dist > 0.46 && dist < 0.46 + Math.max(1.2, d * 0.06) / r && Math.floor(angle / 20) % 2 === 0) row += 'r';
      else row += 'b';
    }
    rows.push(row);
  }
  return rows;
}
