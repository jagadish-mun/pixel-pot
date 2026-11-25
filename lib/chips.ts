/* Chip denominations and how an amount is split into chips and towers. */

export interface ChipDenom {
  value: number;
  /** Top face. */
  face: string;
  /** The darker side of the chip. */
  side: string;
  /** Edge stripes ("the classic white dashes"). */
  stripe: string;
}

/** Biggest first. */
export const CHIP_DENOMS: ChipDenom[] = [
  { value: 500, face: '#36313f', side: '#1d1a24', stripe: '#f4ead5' },
  { value: 100, face: '#3f7fe0', side: '#2a56a0', stripe: '#f4ead5' },
  { value: 25, face: '#2fa56d', side: '#1f7049', stripe: '#f4ead5' },
  { value: 10, face: '#e2483d', side: '#9c2a2a', stripe: '#f4ead5' },
  { value: 5, face: '#f4ead5', side: '#b9ad94', stripe: '#3f7fe0' },
];

export const CHIP_VALUES = CHIP_DENOMS.map((d) => d.value);

export const denom = (value: number): ChipDenom => CHIP_DENOMS.find((d) => d.value === value) ?? CHIP_DENOMS[3];

/** Greedy split into chips, biggest first, plus whatever is left under the smallest chip. */
export function chipBreakdown(amount: number): { chips: { value: number; count: number }[]; remainder: number } {
  let rest = Math.max(0, Math.floor(amount));
  const chips: { value: number; count: number }[] = [];
  for (const { value } of CHIP_DENOMS) {
    const count = Math.floor(rest / value);
    if (count > 0) {
      chips.push({ value, count });
      rest -= count * value;
    }
  }
  return { chips, remainder: rest };
}

/**
 * Towers to draw for an amount: one colour per tower, at most `perTower` chips
 * each (more towers of the same colour side by side), at most `maxChips` in all.
 * `undrawn` is the value not shown as chips: the remainder plus any chips over the cap.
 */
export function chipTowers(
  amount: number,
  { perTower = 20, maxChips = 120 }: { perTower?: number; maxChips?: number } = {},
): { towers: { value: number; count: number }[]; undrawn: number } {
  const { chips, remainder } = chipBreakdown(amount);
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
