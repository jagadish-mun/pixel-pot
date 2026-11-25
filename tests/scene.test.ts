import { describe, expect, it } from 'vitest';
import { arrangeSeats, BET_INSET, MY_SEAT, onFelt, seatLayout, STACK_INSET } from '../components/scene/layout';
import { fitCamera, project, TABLE_R } from '../components/scene/project';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('seatLayout', () => {
  it('never puts two seats (or a seat and me) on top of each other, for 1 to 9 opponents', () => {
    for (let count = 1; count <= 9; count++) {
      const seats = [MY_SEAT, ...seatLayout(count)];
      expect(seats).toHaveLength(count + 1);
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          // A seat is about 0.3 wide.
          expect(dist(seats[i], seats[j])).toBeGreaterThan(0.32);
        }
        // Stacks and bets stay apart too.
        for (let j = i + 1; j < seats.length; j++) {
          expect(dist(onFelt(seats[i], STACK_INSET), onFelt(seats[j], STACK_INSET))).toBeGreaterThan(0.2);
          expect(dist(onFelt(seats[i], BET_INSET), onFelt(seats[j], BET_INSET))).toBeGreaterThan(0.12);
        }
      }
    }
  });

  it('goes round in table order from my left: left end, far side, right end', () => {
    for (let count = 2; count <= 9; count++) {
      const seats = seatLayout(count);
      expect(seats[0].x).toBeLessThan(0);
      expect(seats[count - 1].x).toBeGreaterThan(0);
      // Mirror image: the layout is symmetric left to right.
      seats.forEach((s, i) => {
        expect(s.x).toBeCloseTo(-seats[count - 1 - i].x, 6);
        expect(s.z).toBeCloseTo(seats[count - 1 - i].z, 6);
      });
      // Nobody sits on my side of the table.
      for (const s of seats) expect(s.z).toBeGreaterThan(-TABLE_R);
    }
    // One opponent sits straight across.
    expect(seatLayout(1)[0].x).toBeCloseTo(0, 6);
    expect(seatLayout(1)[0].z).toBeGreaterThan(TABLE_R);
  });

  it('seats the players rotated so I come first, then clockwise from my left', () => {
    const players = ['A', 'B', 'C', 'D', 'E'];
    const seats = arrangeSeats(players, 2);
    expect(seats.map((s) => s.player)).toEqual(['C', 'D', 'E', 'A', 'B']);
    expect(seats[0]).toMatchObject({ me: true, seat: MY_SEAT });
    expect(seats.slice(1).map((s) => s.seat)).toEqual(seatLayout(4));
    expect(seats.map((s) => s.index)).toEqual([2, 3, 4, 0, 1]);
  });
});

describe('projection', () => {
  const cam = fitCamera(480, 640, { top: 20, side: 30, bottom: 4 });

  it('draws further things smaller and higher on screen', () => {
    const near = project(cam, 0, 0, -0.5);
    const far = project(cam, 0, 0, 0.5);
    expect(far.s).toBeLessThan(near.s);
    expect(far.y).toBeLessThan(near.y);
    // Height goes up the screen.
    expect(project(cam, 0, 0.2, 0).y).toBeLessThan(project(cam, 0, 0, 0).y);
  });

  it('fits the table and every seat on screen, at any shape', () => {
    for (const [w, h] of [
      [480, 640],
      [480, 260],
      [480, 300],
      [480, 900],
    ]) {
      const c = fitCamera(w, h, { top: 20, side: 30, bottom: 4 });
      expect(c.pitch).toBeGreaterThanOrEqual(36);
      expect(c.pitch).toBeLessThanOrEqual(62);
      for (const s of seatLayout(9)) {
        const p = project(c, s.x, 0.3, s.z);
        expect(p.x).toBeGreaterThanOrEqual(29);
        expect(p.x).toBeLessThanOrEqual(w - 29);
        expect(p.y).toBeGreaterThanOrEqual(19);
      }
      // The near rail is at the bottom.
      expect(project(c, 0, 0, -TABLE_R - 0.03).y).toBeLessThanOrEqual(h - 3);
      expect(project(c, 0, 0, -TABLE_R - 0.03).y).toBeGreaterThan(h - 40);
    }
  });
});
