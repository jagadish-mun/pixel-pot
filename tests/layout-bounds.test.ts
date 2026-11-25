import { describe, expect, it } from 'vitest';
import { PILES, chipsExtent, peopleBoxes, placePile } from '../components/scene/draw';
import { arrangeSeats, spots } from '../components/scene/layout';
import { fitCamera } from '../components/scene/project';
import { WEALTH } from '../lib/chips';

type Box = { left: number; right: number; top: number; bottom: number };
// Touching edges is fine; a pixel's overlap is not.
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('stacks and bets sit clear of the people', () => {
  // A phone, a landscape phone, a laptop and a wide desktop, in internal pixels.
  const screens = [
    [375, 640],
    [507, 300],
    [480, 300],
    [633, 364],
  ];
  // Amounts that split into few and into many towers.
  const amounts = [15, 990, 2_725, 25_000, 250_000];

  for (let n = 2; n <= 10; n++) {
    it(`${n} players`, () => {
      const seats = arrangeSeats(Array.from({ length: n }, (_, i) => i), 0);
      for (const [w, h] of screens) {
        const cam = fitCamera(w, h, { top: 20, side: 6, bottom: 60 });
        const people = peopleBoxes(cam, seats);
        for (const s of seats) {
          const at = spots(s.seat, s.me);
          for (const amount of amounts) {
            const target = s.me ? WEALTH.me : WEALTH.opponent;
            const stack = placePile(cam, amount, at.stack, target, s.me ? PILES.myStack : PILES.stack, s.seat, people);
            const bet = placePile(cam, amount, at.bet, WEALTH.bet, PILES.bet, s.seat, people);
            const piles = [chipsExtent(cam, amount, stack.at, target, stack.pile), chipsExtent(cam, amount, bet.at, WEALTH.bet, bet.pile)];
            for (const pile of piles)
              for (const body of people)
                expect(overlaps(pile, body), `${n} players, ${w}×${h}, seat ${s.index}, ${amount}: ${JSON.stringify({ pile, body })}`).toBe(false);
          }
        }
      }
    });
  }
});
