import { describe, expect, it } from 'vitest';
import { seededRandom } from '../lib/bot';
import { chipBreakdown, chipFaceRows, chipTowers, wealthTarget, WEALTH } from '../lib/chips';

const sum = (chips: { value: number; count: number }[]) => chips.reduce((s, c) => s + c.value * c.count, 0);
const count = (chips: { value: number; count: number }[]) => chips.reduce((s, c) => s + c.count, 0);

describe('chipBreakdown', () => {
  it('without a target: the fewest chips, biggest first, with a remainder under 5', () => {
    expect(chipBreakdown(15)).toEqual({ chips: [{ value: 10, count: 1 }, { value: 5, count: 1 }], remainder: 0 });
    expect(chipBreakdown(2725)).toEqual({
      chips: [
        { value: 500, count: 5 },
        { value: 100, count: 2 },
        { value: 25, count: 1 },
      ],
      remainder: 0,
    });
    expect(chipBreakdown(1044).remainder).toBe(4);
    expect(chipBreakdown(3)).toEqual({ chips: [], remainder: 3 });
  });

  it('with a target: breaks the biggest chips into smaller ones until it reaches the target', () => {
    // 500 is one chip; 5 chips means one 500 became five 100s.
    expect(chipBreakdown(500, 5)).toEqual({ chips: [{ value: 100, count: 5 }], remainder: 0 });
    // 8 chips: 5×100, then one 100 into 4×25.
    expect(chipBreakdown(500, 8)).toEqual({
      chips: [
        { value: 100, count: 4 },
        { value: 25, count: 4 },
      ],
      remainder: 0,
    });
    // A target the next split would overshoot uses a smaller split: 10 → 5 + 5 adds one chip.
    expect(chipBreakdown(15, 3)).toEqual({ chips: [{ value: 5, count: 3 }], remainder: 0 });
  });

  it('always adds up, reaches the target when it can, and never goes over it', () => {
    const rng = seededRandom(7);
    for (let i = 0; i < 3000; i++) {
      const amount = Math.floor(rng() * 30_000);
      const target = 1 + Math.floor(rng() * 80);
      const fewest = count(chipBreakdown(amount).chips);
      const { chips, remainder } = chipBreakdown(amount, target);
      expect(sum(chips) + remainder).toBe(amount);
      expect(remainder).toBeLessThan(5);
      const n = count(chips);
      // Never over the target, unless even the fewest chips are more than it.
      expect(n).toBeLessThanOrEqual(Math.max(target, fewest));
      // Short of the target only when breaking up any chip left would overshoot it (or there's nothing to break).
      const adds: Record<number, number> = { 500: 4, 100: 3, 25: 2, 10: 1 };
      if (n < target) for (const c of chips) if (adds[c.value]) expect(n + adds[c.value]).toBeGreaterThan(target);
    }
  });
});

describe('wealth', () => {
  it('gives richer players more chips at the same table, and anyone with chips at least one', () => {
    const rng = seededRandom(11);
    for (let t = 0; t < 400; t++) {
      const stacks = Array.from({ length: 2 + Math.floor(rng() * 9) }, () => 1 + Math.floor(rng() * 50_000));
      const richest = Math.max(...stacks);
      const piles = stacks.map((s) => {
        const { chips, remainder } = chipBreakdown(s, wealthTarget(s, richest, WEALTH.opponent));
        expect(sum(chips) + remainder).toBe(s);
        return count(chips);
      });
      stacks.forEach((a, i) =>
        stacks.forEach((b, j) => {
          // A clearly richer player never shows fewer chips (allowing for tiny stacks that can't split).
          if (a >= b * 2 && b >= 25 && a >= 100) expect(piles[i]).toBeGreaterThanOrEqual(Math.min(piles[j], wealthTarget(a, richest, WEALTH.opponent)));
        }),
      );
    }
    expect(wealthTarget(0, 1000, 60)).toBe(0);
    expect(wealthTarget(1, 1_000_000, 60)).toBe(4);
    expect(wealthTarget(1000, 1000, 60)).toBe(60);
  });
});

describe('chipTowers', () => {
  it('one colour per tower, at most 15 high, more towers of a colour side by side', () => {
    expect(chipTowers(450).towers).toEqual([
      { value: 100, count: 4 },
      { value: 25, count: 2 },
    ]);
    expect(chipTowers(500 * 32).towers).toEqual([
      { value: 500, count: 15 },
      { value: 500, count: 15 },
      { value: 500, count: 2 },
    ]);
  });

  it('caps the chips drawn and counts the rest as undrawn; drawn plus undrawn is the amount', () => {
    const big = chipTowers(250_000);
    expect(big.towers.reduce((s, t) => s + t.count, 0)).toBe(90);
    expect(big.undrawn).toBe(250_000 - 90 * 500);
    for (const n of [0, 4, 15, 2725, 9_999, 61_234, 250_000]) {
      const { towers, undrawn } = chipTowers(n, { target: 40 });
      expect(sum(towers) + undrawn).toBe(n);
      expect(towers.every((t) => t.count >= 1 && t.count <= 15)).toBe(true);
    }
  });
});

describe('chip face', () => {
  it('has six edge inserts round the rim and a plain centre', () => {
    const rows = chipFaceRows(24);
    expect(rows).toHaveLength(24);
    expect(rows[12][12]).toBe('b');
    // Inserts sit at 0°, 60°, … : straight right of the centre is one.
    expect(rows[12].slice(18, 22)).toContain('i');
    expect(rows.join('')).toContain('r');
  });
});
