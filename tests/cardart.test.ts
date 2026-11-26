import { describe, expect, it } from 'vitest';
import { CARD_ART, pipSpots } from '../components/scene/cardart';
import { rotatePixels, scale2x } from '../components/scene/rotsprite';

describe('pip layouts', () => {
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T'];
  for (const layout of ['upright', 'flat'] as const) {
    const size = layout === 'upright' ? 7 : 5;
    const { w, h } = CARD_ART[layout];
    it(`${layout}: one pip per spot, inside the face, clear of the indexes and of each other`, () => {
      ranks.forEach((rank, i) => {
        const spots = pipSpots(rank, layout);
        expect(spots).toHaveLength(i + 2);
        for (const p of spots) {
          expect(p.x).toBeGreaterThanOrEqual(10); // the top-left index column ends at x 8
          expect(p.x + size).toBeLessThanOrEqual(w - 10); // and the bottom-right one starts there
          expect(p.y).toBeGreaterThanOrEqual(2);
          expect(p.y + size).toBeLessThanOrEqual(h - 3);
        }
        for (const a of spots)
          for (const b of spots) if (a !== b) expect(Math.abs(a.x - b.x) >= size || Math.abs(a.y - b.y) >= size).toBe(true);
      });
    });
    it(`${layout}: pips below the middle are turned, as on a real card`, () => {
      const ten = pipSpots('T', layout);
      expect(ten.filter((p) => p.turned)).toHaveLength(5);
      expect(pipSpots('3', layout).filter((p) => p.turned)).toHaveLength(1);
    });
  }
  it('aces and court cards have no pip layout (one big pip, or a figure)', () => {
    for (const r of ['A', 'J', 'Q', 'K']) expect(pipSpots(r, 'upright')).toEqual([]);
  });
});

describe('RotSprite', () => {
  const A = 0xff0000ff;
  const B = 0xffffffff;
  const sprite = (rows: string[]) => ({ px: Uint32Array.from(rows.join('').split('').map((c) => (c === 'X' ? A : B))), w: rows[0].length, h: rows.length });

  it('Scale2x keeps a single pixel square and rounds a diagonal step', () => {
    const one = scale2x(sprite(['...', '.X.', '...']));
    expect([...one.px].filter((v) => v === A)).toHaveLength(4);
    const diag = scale2x(sprite(['....', '.X..', '..X.', '....']));
    // EPX fills the inner corners where the diagonal meets: more than the 8 pixels of plain doubling.
    expect([...diag.px].filter((v) => v === A).length).toBeGreaterThan(8);
  });

  it('0° is the sprite itself and 180° turns it exactly; only the sprite’s own colours appear', () => {
    const s = sprite(['XX...', 'X....', '.....', '....X', '...XX']);
    expect(rotatePixels(s, 0)).toBe(s);
    const r = rotatePixels(s, 180);
    expect(new Set(r.px).size).toBeLessThanOrEqual(3); // A, B and transparent edge
    // The turned sprite sits in the middle of the result: compare its centre 5×5.
    const ox = (r.w - 5) / 2;
    const oy = (r.h - 5) / 2;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) expect(r.px[(oy + y) * r.w + ox + x]).toBe(s.px[(4 - y) * 5 + (4 - x)]);
  });

  it('a small tilt keeps the shape: about as many pixels of each colour', () => {
    const rows = Array.from({ length: 14 }, (_, y) => Array.from({ length: 10 }, (_, x) => (x > 0 && x < 9 && y > 0 && y < 13 ? 'X' : '.')).join(''));
    const s = sprite(rows);
    const before = [...s.px].filter((v) => v === A).length;
    const after = [...rotatePixels(s, 7).px].filter((v) => v === A).length;
    expect(Math.abs(after - before) / before).toBeLessThan(0.12);
  });
});
