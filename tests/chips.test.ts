import { describe, expect, it } from 'vitest';
import { chipBreakdown, chipTowers } from '../lib/chips';

describe('chipBreakdown', () => {
  it('splits greedily into 500, 100, 25, 10 and 5, with a remainder under 5', () => {
    expect(chipBreakdown(15)).toEqual({ chips: [{ value: 10, count: 1 }, { value: 5, count: 1 }], remainder: 0 });
    expect(chipBreakdown(2725)).toEqual({
      chips: [
        { value: 500, count: 5 },
        { value: 100, count: 2 },
        { value: 25, count: 1 },
      ],
      remainder: 0,
    });
    expect(chipBreakdown(1044)).toEqual({
      chips: [
        { value: 500, count: 2 },
        { value: 25, count: 1 },
        { value: 10, count: 1 },
        { value: 5, count: 1 },
      ],
      remainder: 4,
    });
    expect(chipBreakdown(3)).toEqual({ chips: [], remainder: 3 });
    expect(chipBreakdown(0)).toEqual({ chips: [], remainder: 0 });
  });

  it('always adds back up to the amount', () => {
    for (let n = 0; n < 3000; n += 7) {
      const { chips, remainder } = chipBreakdown(n);
      expect(chips.reduce((s, c) => s + c.value * c.count, 0) + remainder).toBe(n);
      expect(remainder).toBeLessThan(5);
    }
  });
});

describe('chipTowers', () => {
  it('gives each colour its own tower, at most 20 high, with more towers side by side', () => {
    expect(chipTowers(450).towers).toEqual([
      { value: 100, count: 4 },
      { value: 25, count: 2 },
    ]);
    // 45 blue chips: 20 + 20 + 5.
    expect(chipTowers(4500).towers).toEqual([
      { value: 500, count: 9 },
    ]);
    expect(chipTowers(4500, { perTower: 4 }).towers).toEqual([
      { value: 500, count: 4 },
      { value: 500, count: 4 },
      { value: 500, count: 1 },
    ]);
  });

  it('caps the chips drawn and counts the rest as undrawn', () => {
    // 250,000 is 500 black chips: draw 120 (six towers of 20); the rest is undrawn.
    const big = chipTowers(250_000);
    expect(big.towers).toHaveLength(6);
    expect(big.towers.every((t) => t.value === 500 && t.count === 20)).toBe(true);
    expect(big.undrawn).toBe(250_000 - 120 * 500);
    // The remainder under 5 is undrawn too.
    expect(chipTowers(13)).toEqual({ towers: [{ value: 10, count: 1 }], undrawn: 3 });
  });

  it('drawn plus undrawn always equals the amount', () => {
    for (const n of [0, 4, 15, 2725, 9_999, 61_234, 250_000]) {
      const { towers, undrawn } = chipTowers(n);
      expect(towers.reduce((s, t) => s + t.value * t.count, 0) + undrawn).toBe(n);
      expect(towers.reduce((s, t) => s + t.count, 0)).toBeLessThanOrEqual(120);
      expect(towers.every((t) => t.count >= 1 && t.count <= 20)).toBe(true);
    }
  });
});
