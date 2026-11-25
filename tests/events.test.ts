import { describe, expect, it } from 'vitest';
import { AnimQueue, diffSnapshots, EVENT_MS, showOrder, type SceneEvent } from '../components/scene/events';
import { fullDeck } from '../lib/cards';
import { applyAction, createParty, joinParty, legalActions } from '../lib/game';
import type { Party, PartyRecord } from '../lib/types';

const NOW = 1_700_000_000_000;
const snap = (rec: PartyRecord): Party => structuredClone(rec.party);

function table(names: string[]): PartyRecord {
  const rec = createParty('EVTS', names[0], 't', names[0], { mode: 'cards', smallBlind: 5, bigBlind: 10, startingChips: 1000 }, NOW);
  for (const n of names.slice(1)) joinParty(rec, n, 't', n, NOW);
  applyAction(rec, names[0], { type: 'start_hand' }, NOW, fullDeck());
  return rec;
}

const act = (rec: PartyRecord, type: 'check' | 'call' | 'allin' | 'fold') => applyAction(rec, rec.party.toActId!, { type }, NOW);
const passive = (rec: PartyRecord) =>
  applyAction(rec, rec.party.toActId!, legalActions(rec.party, rec.party.toActId!).check ? { type: 'check' } : { type: 'call' }, NOW);
const ids = (events: SceneEvent[], type: SceneEvent['type']) => events.filter((e) => e.type === type).map((e) => (e as { id: string }).id);

describe('diffSnapshots', () => {
  it('sees a player go all in, with the chips they put in', () => {
    const rec = table(['A', 'B', 'C']);
    const before = snap(rec);
    const who = rec.party.toActId!;
    act(rec, 'allin');
    expect(diffSnapshots(before, snap(rec))).toEqual([{ type: 'allin', hand: 1, id: who, amount: 1000 }]);
  });

  it('several all-ins in one poll come in table order, from left of the dealer', () => {
    const rec = table(['A', 'B', 'C', 'D']);
    const before = snap(rec);
    const first = rec.party.toActId!;
    act(rec, 'allin');
    const second = rec.party.toActId!;
    act(rec, 'allin');
    const order = ids(diffSnapshots(before, snap(rec)), 'allin');
    const seats = ['A', 'B', 'C', 'D'];
    const d = seats.indexOf(rec.party.dealerId!);
    const rank = (id: string) => (seats.indexOf(id) - d - 1 + 4) % 4;
    expect(order).toEqual([first, second].sort((x, y) => rank(x) - rank(y)));
  });

  it('a showdown turns cards over starting with the last bettor, then clockwise, then pays the pot', () => {
    const rec = table(['A', 'B', 'C']);
    while (rec.party.street !== 'river') passive(rec);
    const bettor = rec.party.toActId!;
    applyAction(rec, bettor, { type: 'bet', amount: 20 }, NOW);
    passive(rec);
    const before = snap(rec);
    passive(rec); // the last call ends the hand
    const after = snap(rec);
    const events = diffSnapshots(before, after);
    const shows = ids(events, 'show');
    expect(shows[0]).toBe(bettor);
    expect(shows).toEqual(showOrder(after, shows));
    expect(new Set(shows)).toEqual(new Set(['A', 'B', 'C']));
    // Shows first, the pot last, to whoever's stack grew.
    const pot = events[events.length - 1];
    expect(pot.type).toBe('potToWinner');
    if (pot.type === 'potToWinner') {
      expect(pot.winners.reduce((s, w) => s + w.amount, 0)).toBe(90);
      expect(pot.best).toHaveLength(5);
    }
  });

  it('with no bet on the river, the first player left of the dealer shows first', () => {
    const rec = table(['A', 'B', 'C']);
    while (rec.party.street !== 'river') passive(rec);
    passive(rec);
    passive(rec);
    const before = snap(rec);
    passive(rec);
    const seats = ['A', 'B', 'C'];
    expect(ids(diffSnapshots(before, snap(rec)), 'show')[0]).toBe(seats[(seats.indexOf(rec.party.dealerId!) + 1) % 3]);
  });

  it('the first snapshot, or one from another hand, gives nothing', () => {
    const rec = table(['A', 'B']);
    expect(diffSnapshots(null, snap(rec))).toEqual([]);
    const old = snap(rec);
    old.handNo = 0;
    expect(diffSnapshots(old, snap(rec))).toEqual([]);
  });

  it('a reconnect mid-hand catches up on what it missed, without replaying what already played', () => {
    const rec = table(['A', 'B', 'C', 'D']);
    const queue = new AnimQueue();
    const start = snap(rec);
    const first = rec.party.toActId!;
    act(rec, 'allin');
    expect(queue.push(diffSnapshots(start, snap(rec)))).toHaveLength(1);
    // The connection drops; back again, the browser compares its last good snapshot with a much later one.
    act(rec, 'allin');
    act(rec, 'allin');
    const caughtUp = queue.push(diffSnapshots(start, snap(rec)));
    expect(caughtUp).toHaveLength(2);
    expect(caughtUp.some((e) => e.type === 'allin' && e.id === first)).toBe(false);
    // And the same snapshots again (a re-render) add nothing.
    expect(queue.push(diffSnapshots(start, snap(rec)))).toHaveLength(0);
  });
});

describe('AnimQueue', () => {
  const show = (id: string): SceneEvent => ({ type: 'show', hand: 1, id, cards: [] });

  it('plays events once each, in order', () => {
    const q = new AnimQueue();
    expect(q.push([show('A'), show('B')])).toHaveLength(2);
    expect(q.push([show('A')])).toHaveLength(0);
    expect(q.step(0)?.event).toEqual(show('A'));
    expect(q.step(EVENT_MS.show + 1)?.event).toEqual(show('B'));
    expect(q.step(3 * EVENT_MS.show)).toBeNull();
  });

  it('never falls more than about 2 seconds behind: it speeds up, and skips the oldest when far behind', () => {
    const q = new AnimQueue();
    q.push(['A', 'B', 'C', 'D', 'E'].map(show)); // 3.5 s of showing
    let now = 0;
    while (q.step(now) && now < 10_000) now += 16;
    expect(now).toBeLessThanOrEqual(2200);

    const far = new AnimQueue();
    far.push(Array.from({ length: 20 }, (_, i) => show(`P${i}`))); // 14 s
    const seen = new Set<string>();
    now = 0;
    for (let p = far.step(now); p; p = far.step((now += 16))) seen.add((p.event as { id: string }).id);
    expect(now).toBeLessThanOrEqual(2600);
    expect(seen.has('P19')).toBe(true);
    expect(seen.has('P0')).toBe(false);
  });
});
