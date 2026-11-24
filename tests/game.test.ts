import { describe, expect, it } from 'vitest';
import { applyAction, createParty, GameError, joinParty, potOf } from '../lib/game';
import type { Action, PartyRecord } from '../lib/types';

const NOW = 1_700_000_000_000;

function table(names: string[], settings = { startingChips: 1000, smallBlind: 0, bigBlind: 0 }): PartyRecord {
  const rec = createParty('TEST', names[0], `tok-${names[0]}`, names[0], settings, NOW);
  for (const n of names.slice(1)) joinParty(rec, n, `tok-${n}`, n, NOW);
  return rec;
}
const act = (rec: PartyRecord, who: string, action: Action) => applyAction(rec, who, action, NOW);
const stack = (rec: PartyRecord, who: string) => rec.party.players.find((p) => p.id === who)!.stack;
const total = (rec: PartyRecord) => rec.party.players.reduce((s, p) => s + p.stack + p.bet, 0);

describe('joining', () => {
  it('gives every player the starting stack and rejects duplicate names', () => {
    const rec = table(['Mia', 'Raj']);
    expect(rec.party.players.map((p) => p.stack)).toEqual([1000, 1000]);
    expect(() => joinParty(rec, 'x', 't', ' mia ', NOW)).toThrow(GameError);
    expect(() => joinParty(rec, 'x', 't', '   ', NOW)).toThrow(GameError);
  });

  it('seats a late joiner out of the hand in progress', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'start_hand' });
    joinParty(rec, 'Lee', 'tok', 'Lee', NOW);
    expect(() => act(rec, 'Lee', { type: 'bet', amount: 10 })).toThrow(/next hand/);
  });
});

describe('a simple hand', () => {
  it('moves chips from bettors to the winner and logs the hand', () => {
    const rec = table(['Mia', 'Raj', 'Lee']);
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 50 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Lee', { type: 'fold' });
    expect(potOf(rec.party)).toBe(100);
    act(rec, 'Mia', { type: 'award', winners: ['Raj'] });

    expect(stack(rec, 'Mia')).toBe(950);
    expect(stack(rec, 'Raj')).toBe(1050);
    expect(stack(rec, 'Lee')).toBe(1000);
    expect(rec.party.phase).toBe('idle');
    const entry = rec.party.log.at(-1)!;
    expect(entry).toMatchObject({ kind: 'hand', n: 1, pot: 100, winners: ['Raj'] });
    expect(total(rec)).toBe(3000);
  });

  it('only lets the host start hands and award pots', () => {
    const rec = table(['Mia', 'Raj']);
    expect(() => act(rec, 'Raj', { type: 'start_hand' })).toThrow(/host/);
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Raj', { type: 'bet', amount: 10 });
    expect(() => act(rec, 'Raj', { type: 'award', winners: ['Raj'] })).toThrow(/host/);
  });

  it('rejects bets bigger than the stack, zero bets and fractions', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'start_hand' });
    expect(() => act(rec, 'Raj', { type: 'bet', amount: 1001 })).toThrow(/only have/);
    expect(() => act(rec, 'Raj', { type: 'bet', amount: 0 })).toThrow(GameError);
    expect(() => act(rec, 'Raj', { type: 'bet', amount: 2.5 })).toThrow(GameError);
    expect(() => act(rec, 'Raj', { type: 'bet', amount: -5 })).toThrow(GameError);
  });

  it('lets a player take back their last move', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Raj', { type: 'bet', amount: 40 });
    act(rec, 'Raj', { type: 'fold' });
    act(rec, 'Raj', { type: 'undo' });
    expect(rec.party.players[1].folded).toBe(false);
    act(rec, 'Raj', { type: 'undo' });
    expect(stack(rec, 'Raj')).toBe(1000);
    expect(() => act(rec, 'Raj', { type: 'undo' })).toThrow(/Nothing/);
  });

  it('call matches the highest bet, capped at the stack', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'chips', playerId: 'Raj', amount: -700 });
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 500 });
    act(rec, 'Raj', { type: 'call' });
    expect(rec.party.players[1]).toMatchObject({ stack: 0, bet: 300 });
  });
});

describe('side pots', () => {
  it('returns the uncalled part of a bet when a short stack wins', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'chips', playerId: 'Raj', amount: -940 }); // Raj has 60
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 100 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Mia', { type: 'award', winners: ['Raj'] });
    expect(stack(rec, 'Raj')).toBe(120);
    expect(stack(rec, 'Mia')).toBe(940);
    expect(rec.party.phase).toBe('idle');
    expect(rec.party.log.at(-1)).toMatchObject({ kind: 'hand', winners: ['Raj'] });
  });

  it('asks the host to pick again when two players contest a side pot', () => {
    const rec = table(['Mia', 'Raj', 'Lee']);
    act(rec, 'Mia', { type: 'chips', playerId: 'Lee', amount: -940 }); // Lee has 60
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 100 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Lee', { type: 'call' }); // all in for 60
    act(rec, 'Mia', { type: 'award', winners: ['Lee'] });

    expect(stack(rec, 'Lee')).toBe(180); // main pot: 60 x 3
    expect(rec.party.phase).toBe('showdown');
    expect(potOf(rec.party)).toBe(80);
    expect(() => act(rec, 'Raj', { type: 'bet', amount: 10 })).toThrow(/closed/);
    expect(() => act(rec, 'Mia', { type: 'award', winners: ['Lee'] })).toThrow(/can't win/);

    act(rec, 'Mia', { type: 'award', winners: ['Raj'] });
    expect(stack(rec, 'Raj')).toBe(980);
    expect(stack(rec, 'Mia')).toBe(900);
    expect(rec.party.phase).toBe('idle');
    expect(rec.party.log.at(-1)).toMatchObject({ kind: 'hand', pot: 260, winners: ['Lee', 'Raj'] });
    expect(total(rec)).toBe(2060);
  });

  it('splits the main pot, then gives the side pot to the deeper stack', () => {
    const rec = table(['Mia', 'Raj', 'Lee']);
    act(rec, 'Mia', { type: 'chips', playerId: 'Lee', amount: -940 });
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 100 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Lee', { type: 'call' });
    act(rec, 'Mia', { type: 'award', winners: ['Mia', 'Lee'] }); // split 180
    expect(rec.party.phase).toBe('showdown');
    act(rec, 'Mia', { type: 'award', winners: ['Mia'] }); // side pot 80
    expect(stack(rec, 'Mia')).toBe(900 + 90 + 80);
    expect(stack(rec, 'Lee')).toBe(90);
    expect(stack(rec, 'Raj')).toBe(900);
  });

  it('gives a side pot to the only player left in it, even if a folder paid into it', () => {
    const rec = table(['Mia', 'Raj', 'Lee']);
    act(rec, 'Mia', { type: 'chips', playerId: 'Lee', amount: -950 }); // Lee has 50
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 100 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Lee', { type: 'call' });
    act(rec, 'Raj', { type: 'fold' });
    act(rec, 'Mia', { type: 'award', winners: ['Lee'] });
    expect(stack(rec, 'Lee')).toBe(150);
    expect(stack(rec, 'Mia')).toBe(1000); // 900 + own 50 back + Raj's 50
    expect(stack(rec, 'Raj')).toBe(900);
    expect(rec.party.phase).toBe('idle');
  });

  it('hands out odd chips one at a time when a split is uneven', () => {
    const rec = table(['Mia', 'Raj', 'Lee']);
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 5 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Lee', { type: 'call' });
    act(rec, 'Lee', { type: 'fold' });
    act(rec, 'Mia', { type: 'award', winners: ['Mia', 'Raj'] });
    expect(stack(rec, 'Mia')).toBe(1003);
    expect(stack(rec, 'Raj')).toBe(1002);
    expect(total(rec)).toBe(3000);
  });
});

describe('blinds and the button', () => {
  const blinds = { startingChips: 1000, smallBlind: 5, bigBlind: 10 };

  it('posts blinds left of the button and moves the button each hand', () => {
    const rec = table(['Mia', 'Raj', 'Lee'], blinds);
    act(rec, 'Mia', { type: 'start_hand' });
    expect(rec.party).toMatchObject({ dealerId: 'Mia', sbId: 'Raj', bbId: 'Lee' });
    expect(potOf(rec.party)).toBe(15);
    act(rec, 'Mia', { type: 'award', winners: ['Lee'] });
    act(rec, 'Mia', { type: 'start_hand' });
    expect(rec.party).toMatchObject({ dealerId: 'Raj', sbId: 'Lee', bbId: 'Mia' });
  });

  it('has the dealer post the small blind heads-up', () => {
    const rec = table(['Mia', 'Raj'], blinds);
    act(rec, 'Mia', { type: 'start_hand' });
    expect(rec.party).toMatchObject({ dealerId: 'Mia', sbId: 'Mia', bbId: 'Raj' });
  });

  it('skips players with no chips', () => {
    const rec = table(['Mia', 'Raj', 'Lee'], blinds);
    act(rec, 'Mia', { type: 'chips', playerId: 'Raj', amount: -1000 });
    act(rec, 'Mia', { type: 'start_hand' });
    expect(rec.party.players[1].inHand).toBe(false);
    expect(rec.party).toMatchObject({ dealerId: 'Mia', sbId: 'Mia', bbId: 'Lee' });
  });
});

describe('host tools', () => {
  it('cancels a hand and puts every chip back, even mid-showdown', () => {
    const rec = table(['Mia', 'Raj', 'Lee'], { startingChips: 1000, smallBlind: 5, bigBlind: 10 });
    act(rec, 'Mia', { type: 'chips', playerId: 'Lee', amount: -940 });
    act(rec, 'Mia', { type: 'start_hand' });
    act(rec, 'Mia', { type: 'bet', amount: 100 });
    act(rec, 'Raj', { type: 'call' });
    act(rec, 'Lee', { type: 'call' });
    act(rec, 'Mia', { type: 'award', winners: ['Lee'] });
    act(rec, 'Mia', { type: 'void_hand' });
    expect(rec.party.players.map((p) => p.stack)).toEqual([1000, 1000, 60]);
    expect(rec.party).toMatchObject({ phase: 'idle', handNo: 0, dealerId: null });
    expect(rec.party.log.filter((e) => e.kind === 'hand')).toHaveLength(0);
  });

  it('tracks rebuys so net winnings stay right', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'chips', playerId: 'Raj', amount: 500 });
    expect(rec.party.players[1]).toMatchObject({ stack: 1500, buyIn: 1500 });
    expect(rec.party.log.at(-1)).toMatchObject({ kind: 'chips', name: 'Raj', amount: 500, after: 1500 });
    expect(() => act(rec, 'Mia', { type: 'chips', playerId: 'Raj', amount: -2000 })).toThrow(/only has/);
  });

  it('removes a player and their seat key, but never the host', () => {
    const rec = table(['Mia', 'Raj']);
    expect(() => act(rec, 'Mia', { type: 'kick', playerId: 'Mia' })).toThrow(/host/);
    act(rec, 'Mia', { type: 'kick', playerId: 'Raj' });
    expect(rec.party.players).toHaveLength(1);
    expect(rec.tokens.Raj).toBeUndefined();
  });

  it('keeps table changes for between hands', () => {
    const rec = table(['Mia', 'Raj']);
    act(rec, 'Mia', { type: 'start_hand' });
    expect(() => act(rec, 'Mia', { type: 'kick', playerId: 'Raj' })).toThrow(/between hands/);
    expect(() => act(rec, 'Mia', { type: 'chips', playerId: 'Raj', amount: 5 })).toThrow(/between hands/);
  });
});

describe('chips are conserved', () => {
  it('never creates or destroys chips across random play', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const rec = table(ids, { startingChips: 300, smallBlind: 5, bigBlind: 10 });
    const expected = 1500;
    for (let hand = 0; hand < 300; hand++) {
      if (rec.party.players.filter((p) => p.stack > 0).length < 2) break;
      act(rec, 'A', { type: 'start_hand' });
      for (let step = 0; step < 12; step++) {
        const p = rec.party.players[rnd(ids.length)];
        if (!p.inHand || p.folded) continue;
        const roll = rnd(10);
        if (roll < 4 && p.stack > 0) act(rec, p.id, { type: 'bet', amount: 1 + rnd(p.stack) });
        else if (roll < 7) act(rec, p.id, { type: 'call' });
        else if (roll < 8) act(rec, p.id, { type: 'fold' });
        else if (p.undo.length) act(rec, p.id, { type: 'undo' });
        expect(total(rec)).toBe(expected);
      }
      let guard = 0;
      while (rec.party.phase !== 'idle') {
        const live = rec.party.players.filter((p) => p.inHand && !p.folded && p.bet > 0);
        if (potOf(rec.party) > 0 && live.length === 0) {
          act(rec, 'A', { type: 'void_hand' });
          break;
        }
        const picks = live.filter(() => rnd(2) === 0);
        act(rec, 'A', { type: 'award', winners: (picks.length ? picks : live.slice(0, 1)).map((p) => p.id) });
        expect(total(rec)).toBe(expected);
        expect(++guard).toBeLessThan(10);
      }
      expect(rec.party.players.every((p) => p.bet === 0 && p.stack >= 0)).toBe(true);
    }
    expect(total(rec)).toBe(expected);
    expect(rec.party.log.length).toBeGreaterThan(20);
  });
});
