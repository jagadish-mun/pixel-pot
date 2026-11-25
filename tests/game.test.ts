import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cleanSettings,
  createParty,
  DEFAULT_SETTINGS,
  eligibleWinners,
  GameError,
  joinParty,
  legalActions,
  logKey,
  mergeLog,
  normalizeParty,
  potOf,
  potsOf,
  settingsSummary,
  tableLine,
  viewFor,
} from '../lib/game';
import { viewBody } from '../lib/server';
import { store } from '../lib/store';
import oldTables from './fixtures/old-tables.json';
import type { Action, LogEntry, PartyRecord, Settings } from '../lib/types';

const NOW = 1_700_000_000_000;

/** A free-play table (no turns), as every table was before turn order existed. */
function table(names: string[], settings: Partial<Settings> = { startingChips: 1000, smallBlind: 0, bigBlind: 0 }): PartyRecord {
  const rec = createParty('TEST', names[0], `tok-${names[0]}`, names[0], { turnOrder: false, ...settings }, NOW);
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

describe('table settings', () => {
  it('fills in defaults for anything not given', () => {
    expect(cleanSettings(undefined)).toEqual({
      mode: 'cardless',
      variant: 'holdem',
      betting: 'no-limit',
      turnOrder: true,
      actionTimer: 0,
      ante: 0,
      maxPlayers: 10,
      autoDeal: false,
      startingChips: 1000,
      smallBlind: 0,
      bigBlind: 0,
    });
    const rec = createParty('TEST', 'Mia', 'tok', 'Mia', {}, NOW);
    expect(rec.party.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the choices it is given', () => {
    const s = cleanSettings({
      mode: 'cards',
      variant: 'omaha',
      betting: 'pot-limit',
      actionTimer: 30,
      ante: 2,
      maxPlayers: 6,
      startingChips: 500,
      smallBlind: 5,
      bigBlind: 10,
    });
    expect(s).toMatchObject({ mode: 'cards', variant: 'omaha', betting: 'pot-limit', actionTimer: 30, ante: 2, maxPlayers: 6 });
    expect(settingsSummary(s)).toBe('Cards · PL Omaha · 5/10 · Ante 2 · 500 chips · 30s timer');
    expect(tableLine(s)).toBe('PL Omaha · Blinds 5/10 · Ante 2');
    expect(settingsSummary({ ...DEFAULT_SETTINGS, turnOrder: false, bigBlind: 0 })).toBe("Cardless · NL Hold'em · No blinds · 1,000 chips · Bet anytime");
  });

  it('always uses turn order in cards mode', () => {
    expect(cleanSettings({ mode: 'cards', turnOrder: false }).turnOrder).toBe(true);
    expect(cleanSettings({ mode: 'cardless', turnOrder: false }).turnOrder).toBe(false);
  });

  it('needs a big blind for fixed-limit', () => {
    expect(() => cleanSettings({ betting: 'fixed-limit', bigBlind: 0 })).toThrow(/Fixed-limit needs a big blind/);
    expect(cleanSettings({ betting: 'fixed-limit', smallBlind: 5, bigBlind: 10 }).betting).toBe('fixed-limit');
  });

  it("doesn't allow an ante bigger than the big blind", () => {
    expect(() => cleanSettings({ smallBlind: 5, bigBlind: 10, ante: 11 })).toThrow(/ante can't be bigger/);
    expect(() => cleanSettings({ ante: 1 })).toThrow(/ante can't be bigger/);
    expect(() => cleanSettings({ ante: -1 })).toThrow(GameError);
  });

  it('keeps max players between 2 and 10, and at least the players seated', () => {
    expect(() => cleanSettings({ maxPlayers: 1 })).toThrow(/Max players/);
    expect(() => cleanSettings({ maxPlayers: 11 })).toThrow(/Max players/);
    expect(() => cleanSettings({ maxPlayers: 2 }, 3)).toThrow(/3 players are already seated/);
    const rec = table(['Mia', 'Raj', 'Lee']);
    expect(() => act(rec, 'Mia', { type: 'settings', settings: { maxPlayers: 2 } })).toThrow(/already seated/);
  });

  it('rejects options that do not exist', () => {
    expect(() => cleanSettings({ mode: 'video' })).toThrow(/Cardless or Cards/);
    expect(() => cleanSettings({ variant: 'stud' })).toThrow(/Hold'em or Omaha/);
    expect(() => cleanSettings({ betting: 'spread' })).toThrow(/betting/);
    expect(() => cleanSettings({ actionTimer: 20 })).toThrow(/action timer/);
    expect(() => cleanSettings({ turnOrder: 'yes' })).toThrow(/Turn order/);
  });

  it('turns away players once the table reaches its max', () => {
    const rec = createParty('TEST', 'Mia', 'tok', 'Mia', { maxPlayers: 2 }, NOW);
    joinParty(rec, 'Raj', 'tok', 'Raj', NOW);
    expect(() => joinParty(rec, 'Lee', 'tok', 'Lee', NOW)).toThrow(/full \(2 players\)/);
  });

  it("doesn't let the host change the mode", () => {
    const rec = table(['Mia', 'Raj']);
    expect(() => act(rec, 'Mia', { type: 'settings', settings: { mode: 'cards' } })).toThrow(/can't be changed/);
    act(rec, 'Mia', { type: 'settings', settings: { mode: 'cardless', bigBlind: 20, smallBlind: 10 } });
    act(rec, 'Mia', { type: 'settings', settings: { variant: 'omaha' } });
    expect(rec.party.settings).toMatchObject({ mode: 'cardless', variant: 'omaha', smallBlind: 10, bigBlind: 20 });
  });

  it('only lets the host change settings, between hands', () => {
    const rec = table(['Mia', 'Raj']);
    expect(() => act(rec, 'Raj', { type: 'settings', settings: { ante: 0 } })).toThrow(/Only the host/);
    act(rec, 'Mia', { type: 'start_hand' });
    expect(() => act(rec, 'Mia', { type: 'settings', settings: { ante: 0 } })).toThrow(/between hands/);
  });

  it('gives old saved tables the new settings, with turn order off', () => {
    const rec = table(['Mia', 'Raj'], { startingChips: 500, smallBlind: 5, bigBlind: 10 });
    // A table saved before this release only had these three settings.
    const old = JSON.parse(JSON.stringify(rec)) as PartyRecord;
    old.party.settings = { startingChips: 500, smallBlind: 5, bigBlind: 10 } as PartyRecord['party']['settings'];
    normalizeParty(old.party);
    expect(old.party.settings).toEqual({
      mode: 'cardless',
      variant: 'holdem',
      betting: 'no-limit',
      turnOrder: false,
      actionTimer: 0,
      ante: 0,
      maxPlayers: 10,
      autoDeal: false,
      startingChips: 500,
      smallBlind: 5,
      bigBlind: 10,
    });
    // Changing one setting later keeps turn order off.
    act(old, 'Mia', { type: 'settings', settings: { bigBlind: 20 } });
    expect(old.party.settings.turnOrder).toBe(false);
    // Tables that already have the new fields are left alone.
    const fresh = createParty('TEST', 'Mia', 'tok', 'Mia', {}, NOW);
    normalizeParty(fresh.party);
    expect(fresh.party.settings.turnOrder).toBe(true);
  });

  it('normalizes old tables when the store reads or updates them', async () => {
    const old = table(['Mia', 'Raj']);
    old.party.code = 'OLDT';
    old.party.settings = { startingChips: 1000, smallBlind: 0, bigBlind: 0 } as PartyRecord['party']['settings'];
    expect(await store.create(old)).toBe(true);
    expect((await store.get('OLDT'))?.party.settings).toMatchObject({ mode: 'cardless', turnOrder: false, maxPlayers: 10 });
    const updated = await store.update('OLDT', (r) => applyAction(r, 'Mia', { type: 'start_hand' }, NOW));
    expect(updated?.party.settings.turnOrder).toBe(false);
  });

  // Saved by the original engine (before settings, turns, cards and AI existed): one idle, one mid-hand.
  it('loads and plays tables saved by the original version, in free-play', async () => {
    const { idle, live } = structuredClone(oldTables) as unknown as { idle: PartyRecord; live: PartyRecord };
    const total = (r: PartyRecord) => r.party.players.reduce((s, p) => s + p.stack + p.bet, 0);
    expect(await store.create(idle)).toBe(true);
    expect(await store.create(live)).toBe(true);

    // Mid-hand: anyone may bet at any time, the undo stack still works, the host awards.
    let rec = (await store.get('OLD2'))!;
    expect(rec.party.settings).toMatchObject({ mode: 'cardless', turnOrder: false });
    expect(rec.party.toActId).toBeNull();
    expect(viewFor(rec, 'Lee').myCards).toBeNull();
    const chipsBefore = total(rec);
    rec = (await store.update('OLD2', (r) => {
      applyAction(r, 'Lee', { type: 'undo' }, NOW);
      applyAction(r, 'Raj', { type: 'bet', amount: 50 }, NOW);
      applyAction(r, 'Lee', { type: 'call' }, NOW);
      applyAction(r, 'Mia', { type: 'fold' }, NOW);
      applyAction(r, 'Mia', { type: 'award', winners: ['Raj'] }, NOW);
    }))!;
    expect(rec.party.phase).toBe('idle');
    expect(rec.party.toActId).toBeNull();
    expect(total(rec)).toBe(chipsBefore);

    // Between hands: start a new one; still no turns, no cards.
    rec = (await store.update('OLD1', (r) => applyAction(r, 'Mia', { type: 'start_hand' }, NOW)))!;
    expect(rec.party.phase).toBe('live');
    expect([rec.party.toActId, rec.party.awaitingDeal, rec.hole]).toEqual([null, null, {}]);
    expect(rec.party.handNo).toBe(2);
  });
});

/* ------------------------------ turn-based tables ----------------------------- */

/** A turn-based table, blinds 5/10, 1,000 chips each. Seat order follows `names`; the first is the host. */
function turns(names: string[], settings: Partial<Settings> = {}): PartyRecord {
  const rec = createParty('TEST', names[0], `tok-${names[0]}`, names[0], { smallBlind: 5, bigBlind: 10, ...settings }, NOW);
  for (const n of names.slice(1)) joinParty(rec, n, `tok-${n}`, n, NOW);
  return rec;
}
const player = (rec: PartyRecord, id: string) => rec.party.players.find((p) => p.id === id)!;
const toAct = (rec: PartyRecord) => rec.party.toActId;
const legal = (rec: PartyRecord, id: string) => legalActions(rec.party, id);
const feedHas = (rec: PartyRecord, text: string) => rec.party.feed.some((f) => f.text === text);

describe('who acts first', () => {
  it('full ring: left of the big blind preflop, left of the button after the flop', () => {
    const rec = turns(['A', 'B', 'C', 'D']);
    act(rec, 'A', { type: 'start_hand' });
    expect([rec.party.dealerId, rec.party.sbId, rec.party.bbId]).toEqual(['A', 'B', 'C']);
    expect(toAct(rec)).toBe('D');
    act(rec, 'D', { type: 'call' });
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'call' });
    act(rec, 'C', { type: 'check' });
    expect(rec.party.awaitingDeal).toBe('flop');
    act(rec, 'A', { type: 'dealt' });
    expect(rec.party.street).toBe('flop');
    expect(toAct(rec)).toBe('B');
    expect(feedHas(rec, 'Flop is out')).toBe(true);
    expect(feedHas(rec, 'Flop: B to act')).toBe(true);
  });

  it('heads-up: the dealer (small blind) first preflop, the big blind first after the flop', () => {
    const rec = turns(['A', 'B']);
    act(rec, 'A', { type: 'start_hand' });
    expect([rec.party.dealerId, rec.party.sbId, rec.party.bbId]).toEqual(['A', 'A', 'B']);
    expect(toAct(rec)).toBe('A');
    act(rec, 'A', { type: 'call' });
    expect(toAct(rec)).toBe('B');
    act(rec, 'B', { type: 'check' });
    act(rec, 'A', { type: 'dealt' });
    expect(toAct(rec)).toBe('B');
  });

  it('moves the button and blinds each hand', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'fold' });
    act(rec, 'B', { type: 'fold' });
    act(rec, 'A', { type: 'start_hand' });
    expect([rec.party.dealerId, rec.party.sbId, rec.party.bbId, toAct(rec)]).toEqual(['B', 'C', 'A', 'B']);
  });
});

describe('betting rounds', () => {
  it('gives the big blind their option when everyone just calls', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'call' });
    expect(toAct(rec)).toBe('C');
    expect(rec.party.awaitingDeal).toBeNull();
    const c = legal(rec, 'C');
    expect(c.check).toBe(true);
    expect(c.call).toBeNull();
    expect(c.raise).toEqual({ min: 20, max: 1000 });
    act(rec, 'C', { type: 'raise', to: 30 });
    expect(toAct(rec)).toBe('A');
  });

  it('ends the round only when everyone still betting has acted and matched', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'raise', to: 30 });
    act(rec, 'B', { type: 'raise', to: 90 });
    act(rec, 'C', { type: 'fold' });
    expect(toAct(rec)).toBe('A');
    expect(rec.party.awaitingDeal).toBeNull();
    act(rec, 'A', { type: 'call' });
    expect(rec.party.awaitingDeal).toBe('flop');
    expect(potOf(rec.party)).toBe(190);
    expect(rec.party.players.map((p) => p.roundBet)).toEqual([0, 0, 0]);
  });

  it('posts antes into the pot without counting them toward the call', () => {
    const rec = turns(['A', 'B', 'C'], { ante: 1 });
    act(rec, 'A', { type: 'start_hand' });
    expect(potOf(rec.party)).toBe(18);
    expect(rec.party.players.map((p) => p.roundBet)).toEqual([0, 5, 10]);
    expect(legal(rec, 'A').call).toBe(10);
    act(rec, 'A', { type: 'call' });
    expect(stack(rec, 'A')).toBe(989);
  });

  it('rejects acting out of turn', () => {
    const rec = turns(['A', 'B', 'C', 'D']);
    act(rec, 'A', { type: 'start_hand' });
    expect(() => act(rec, 'B', { type: 'call' })).toThrow("It's D's turn.");
    expect(legal(rec, 'B')).toEqual({ fold: false, check: false, call: null, bet: null, raise: null, allin: null });
  });

  it('only lets you check when there is nothing to call', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    expect(() => act(rec, 'A', { type: 'check' })).toThrow(/10 to call/);
    expect(() => act(rec, 'A', { type: 'bet', amount: 20 })).toThrow(/already a bet/);
  });
});

describe('bet sizes', () => {
  it('no-limit: a raise is at least the big blind and at least the last raise', () => {
    const rec = turns(['A', 'B', 'C', 'D']);
    act(rec, 'A', { type: 'start_hand' });
    expect(legal(rec, 'D').raise).toEqual({ min: 20, max: 1000 });
    expect(() => act(rec, 'D', { type: 'raise', to: 19 })).toThrow(/from 20 to 1,000/);
    act(rec, 'D', { type: 'raise', to: 25 });
    expect(legal(rec, 'A').raise?.min).toBe(40);
    act(rec, 'A', { type: 'raise', to: 60 });
    expect(legal(rec, 'B').raise?.min).toBe(95);
  });

  it("no-limit: a short all-in doesn't reopen betting for players who already acted", () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'chips', playerId: 'B', amount: -940 });
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'raise', to: 40 });
    act(rec, 'B', { type: 'allin' });
    expect(player(rec, 'B').roundBet).toBe(60);
    // C hasn't acted yet, so C may still raise.
    expect(legal(rec, 'C').raise).not.toBeNull();
    act(rec, 'C', { type: 'call' });
    const a = legal(rec, 'A');
    expect(a.call).toBe(20);
    expect(a.raise).toBeNull();
    expect(a.allin).toBeNull();
    expect(() => act(rec, 'A', { type: 'raise', to: 100 })).toThrow(/can't raise/);
    act(rec, 'A', { type: 'call' });
    expect(rec.party.awaitingDeal).toBe('flop');
  });

  it('no-limit: a full all-in raise does reopen betting', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'chips', playerId: 'B', amount: -900 });
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'raise', to: 40 });
    act(rec, 'B', { type: 'allin' });
    act(rec, 'C', { type: 'call' });
    expect(legal(rec, 'A').raise?.min).toBe(160);
  });

  it('pot-limit: the biggest raise is the pot after calling', () => {
    const rec = turns(['A', 'B', 'C'], { betting: 'pot-limit' });
    act(rec, 'A', { type: 'start_hand' });
    expect(legal(rec, 'A').raise).toEqual({ min: 20, max: 35 });
    expect(legal(rec, 'A').allin).toBeNull();
    expect(() => act(rec, 'A', { type: 'raise', to: 36 })).toThrow(/from 20 to 35/);
    act(rec, 'A', { type: 'raise', to: 35 });
    expect(legal(rec, 'B').raise?.max).toBe(115);
    act(rec, 'B', { type: 'call' });
    act(rec, 'C', { type: 'call' });
    act(rec, 'A', { type: 'dealt' });
    expect(legal(rec, 'B').bet).toEqual({ min: 10, max: 105 });
  });

  it('fixed-limit: one big blind preflop and on the flop, two on the turn and river, four bets a round', () => {
    const rec = turns(['A', 'B', 'C'], { betting: 'fixed-limit' });
    act(rec, 'A', { type: 'start_hand' });
    expect(legal(rec, 'A').raise).toEqual({ min: 20, max: 20 });
    expect(legal(rec, 'A').allin).toBeNull();
    expect(() => act(rec, 'A', { type: 'raise', to: 25 })).toThrow(/The raise is 20/);
    act(rec, 'A', { type: 'raise', to: 20 });
    act(rec, 'B', { type: 'raise', to: 30 });
    act(rec, 'C', { type: 'raise', to: 40 });
    // The big blind plus three raises: capped.
    expect(legal(rec, 'A').raise).toBeNull();
    expect(legal(rec, 'A').call).toBe(20);
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'call' });
    act(rec, 'A', { type: 'dealt' });
    expect(legal(rec, 'B').bet).toEqual({ min: 10, max: 10 });
    act(rec, 'B', { type: 'bet', amount: 10 });
    act(rec, 'C', { type: 'call' });
    act(rec, 'A', { type: 'call' });
    act(rec, 'A', { type: 'dealt' });
    expect(rec.party.street).toBe('turn');
    expect(legal(rec, 'B').bet).toEqual({ min: 20, max: 20 });
    act(rec, 'B', { type: 'bet', amount: 20 });
    expect(legal(rec, 'C').raise).toEqual({ min: 40, max: 40 });
  });
});

describe('ending a hand', () => {
  it('gives the pot to the last player left when everyone else folds', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'fold' });
    act(rec, 'B', { type: 'fold' });
    expect(rec.party.phase).toBe('idle');
    expect([stack(rec, 'A'), stack(rec, 'B'), stack(rec, 'C')]).toEqual([1000, 995, 1005]);
    const last = rec.party.log[rec.party.log.length - 1];
    expect(last).toMatchObject({ kind: 'hand', n: 1, pot: 15, winners: ['C'] });
    expect(feedHas(rec, 'C wins 15')).toBe(true);
  });

  it('runs the board out when everyone is all in, then goes to showdown', () => {
    const rec = turns(['A', 'B']);
    act(rec, 'A', { type: 'chips', playerId: 'A', amount: -500 });
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'allin' });
    act(rec, 'B', { type: 'call' });
    // B still has chips but nobody is left to bet against.
    for (const street of ['flop', 'turn', 'river'] as const) {
      expect(rec.party.awaitingDeal).toBe(street);
      expect(toAct(rec)).toBeNull();
      act(rec, 'A', { type: 'dealt' });
    }
    expect(rec.party.phase).toBe('showdown');
    expect(rec.party.potAtShowdown).toBe(1000);
    act(rec, 'A', { type: 'award', winners: ['A'] });
    expect([stack(rec, 'A'), stack(rec, 'B')]).toEqual([1000, 500]);
  });

  it('goes to showdown after the river betting, and the host awards side pots as before', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'chips', playerId: 'A', amount: -900 });
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'allin' });
    act(rec, 'B', { type: 'call' });
    act(rec, 'C', { type: 'call' });
    act(rec, 'A', { type: 'dealt' });
    // A is all in, so B and C build a side pot on the flop.
    act(rec, 'B', { type: 'bet', amount: 200 });
    act(rec, 'C', { type: 'call' });
    for (let i = 0; i < 2; i++) {
      act(rec, 'A', { type: 'dealt' });
      act(rec, 'B', { type: 'check' });
      act(rec, 'C', { type: 'check' });
    }
    expect(rec.party.phase).toBe('showdown');
    act(rec, 'A', { type: 'award', winners: ['A'] });
    expect(rec.party.phase).toBe('showdown');
    act(rec, 'A', { type: 'award', winners: ['C'] });
    expect(rec.party.phase).toBe('idle');
    expect([stack(rec, 'A'), stack(rec, 'B'), stack(rec, 'C')]).toEqual([300, 700, 1100]);
  });

  it('lets the host cancel a turn-based hand and get every chip back', () => {
    const rec = turns(['A', 'B', 'C'], { ante: 2 });
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'raise', to: 50 });
    act(rec, 'A', { type: 'void_hand' });
    expect(rec.party.players.map((p) => p.stack)).toEqual([1000, 1000, 1000]);
    expect([rec.party.phase, rec.party.toActId, rec.party.handNo]).toEqual(['idle', null, 0]);
  });
});

describe("'dealt'", () => {
  it('pauses betting until the dealer or the host says the cards are out', () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'fold' });
    act(rec, 'B', { type: 'fold' });
    act(rec, 'A', { type: 'start_hand' });
    // Hand 2: B deals, C small blind, A big blind and host.
    act(rec, 'B', { type: 'call' });
    act(rec, 'C', { type: 'call' });
    act(rec, 'A', { type: 'check' });
    expect(rec.party.awaitingDeal).toBe('flop');
    expect(() => act(rec, 'C', { type: 'bet', amount: 10 })).toThrow(/Wait for the flop/);
    expect(() => act(rec, 'C', { type: 'dealt' })).toThrow(/dealer or the host/);
    act(rec, 'B', { type: 'dealt' });
    expect(toAct(rec)).toBe('C');
    expect(() => act(rec, 'A', { type: 'dealt' })).toThrow(/nothing to deal/);
  });

  it("isn't used on free-play tables, which keep betting in any order", () => {
    const rec = table(['A', 'B']);
    act(rec, 'A', { type: 'start_hand' });
    expect(() => act(rec, 'B', { type: 'check' })).toThrow(/doesn't take turns/);
    expect(() => act(rec, 'B', { type: 'dealt' })).toThrow(/doesn't take turns/);
    act(rec, 'B', { type: 'bet', amount: 50 });
    expect(rec.party.toActId).toBeNull();
  });
});

describe('action timer', () => {
  it('folds or checks for a slow player, but only after the deadline', () => {
    const rec = turns(['A', 'B', 'C'], { actionTimer: 30 });
    act(rec, 'A', { type: 'start_hand' });
    expect(rec.party.turnDeadline).toBe(NOW + 30_000);
    expect(() => applyAction(rec, 'B', { type: 'timeout' }, NOW + 30_000)).toThrow(/still time/);
    applyAction(rec, 'B', { type: 'timeout' }, NOW + 30_001);
    expect(player(rec, 'A').folded).toBe(true);
    expect(feedHas(rec, 'A ran out of time and folds')).toBe(true);
    expect(toAct(rec)).toBe('B');
    expect(rec.party.turnDeadline).toBe(NOW + 60_001);
    act(rec, 'B', { type: 'call' });
    // The big blind can check, so timing out checks for them and ends the round.
    applyAction(rec, 'A', { type: 'timeout' }, NOW + 40_000);
    expect(player(rec, 'C').folded).toBe(false);
    expect(rec.party.awaitingDeal).toBe('flop');
    expect(rec.party.turnDeadline).toBeNull();
  });

  it('has no deadline when the timer is off', () => {
    const rec = turns(['A', 'B']);
    act(rec, 'A', { type: 'start_hand' });
    expect(rec.party.turnDeadline).toBeNull();
    expect(() => applyAction(rec, 'B', { type: 'timeout' }, NOW + 1e9)).toThrow(/still time/);
  });
});

describe('taking a move back on a turn-based table', () => {
  it('only works for the last move, before anyone else acts', () => {
    const rec = turns(['A', 'B', 'C', 'D']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'D', { type: 'raise', to: 40 });
    act(rec, 'D', { type: 'undo' });
    expect([stack(rec, 'D'), player(rec, 'D').roundBet, toAct(rec)]).toEqual([1000, 0, 'D']);
    act(rec, 'D', { type: 'call' });
    act(rec, 'A', { type: 'fold' });
    expect(() => act(rec, 'D', { type: 'undo' })).toThrow(/own last move/);
    expect(() => act(rec, 'B', { type: 'undo' })).toThrow(/own last move/);
    act(rec, 'A', { type: 'undo' });
    expect([player(rec, 'A').folded, toAct(rec)]).toEqual([false, 'A']);
    expect(() => act(rec, 'A', { type: 'undo' })).toThrow(/own last move/);
  });

  it("can't take back the move that closed the round", () => {
    const rec = turns(['A', 'B']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'check' });
    expect(() => act(rec, 'B', { type: 'undo' })).toThrow(/own last move/);
  });
});

describe('chips are conserved in turn-based play', () => {
  for (const betting of ['no-limit', 'pot-limit', 'fixed-limit'] as const) {
    it(`${betting}: random legal play never creates or destroys chips`, () => {
      let seed = 11;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const ids = ['A', 'B', 'C', 'D', 'E'];
      const rec = turns(ids, { startingChips: 400, smallBlind: 5, bigBlind: 10, ante: 1, actionTimer: 15, betting });
      const expected = 2000;
      let hands = 0;
      for (let step = 0; step < 20_000 && hands < 150; step++) {
        const party = rec.party;
        if (party.phase === 'idle') {
          if (party.players.filter((p) => p.stack > 0).length < 2) break;
          act(rec, 'A', { type: 'start_hand' });
          hands += 1;
        } else if (party.phase === 'showdown') {
          const e = eligibleWinners(party);
          const winners = e.filter(() => rnd(2) === 0);
          act(rec, 'A', { type: 'award', winners: (winners.length ? winners : e.slice(0, 1)).map((p) => p.id) });
        } else if (party.awaitingDeal) {
          act(rec, rnd(2) ? party.dealerId! : 'A', { type: 'dealt' });
        } else {
          const id = party.toActId;
          expect(id).not.toBeNull();
          const roll = rnd(20);
          if (roll === 0 && party.undoSnapshot) {
            act(rec, party.undoSnapshot.by, { type: 'undo' });
          } else if (roll === 1 && party.turnDeadline) {
            applyAction(rec, 'B', { type: 'timeout' }, party.turnDeadline + 1);
          } else {
            const l = legalActions(party, id!);
            const options: Action[] = [];
            if (l.check) options.push({ type: 'check' }, { type: 'check' });
            if (l.call !== null) options.push({ type: 'call' }, { type: 'call' });
            if (l.bet) options.push({ type: 'bet', amount: l.bet.min + rnd(l.bet.max - l.bet.min + 1) });
            if (l.raise) options.push({ type: 'raise', to: l.raise.min + rnd(l.raise.max - l.raise.min + 1) });
            if (l.allin !== null && rnd(4) === 0) options.push({ type: 'allin' });
            if (rnd(5) === 0) options.push({ type: 'fold' });
            if (options.length === 0) options.push({ type: 'fold' });
            act(rec, id!, options[rnd(options.length)]);
          }
        }
        expect(total(rec)).toBe(expected);
        for (const p of rec.party.players) {
          expect(p.stack).toBeGreaterThanOrEqual(0);
          expect(p.roundBet).toBeLessThanOrEqual(p.bet);
        }
      }
      expect(hands).toBeGreaterThan(20);
    });
  }
});

describe('table display helpers', () => {
  it('splits the pot into main and side pots by all-in level', () => {
    const rec = turns(['A', 'B', 'C', 'D']);
    act(rec, 'A', { type: 'chips', playerId: 'B', amount: -900 });
    act(rec, 'A', { type: 'chips', playerId: 'C', amount: -700 });
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'D', { type: 'call' });
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'allin' });
    act(rec, 'C', { type: 'allin' });
    act(rec, 'D', { type: 'call' });
    act(rec, 'A', { type: 'fold' });
    // A folded 10 into the main pot; B is all in for 100, C for 300, D covers.
    expect(potsOf(rec.party)).toEqual([
      { amount: 310, eligible: ['B', 'C', 'D'] },
      { amount: 400, eligible: ['C', 'D'] },
    ]);
    expect(potsOf(rec.party).reduce((s, p) => s + p.amount, 0)).toBe(potOf(rec.party));
  });

  it("records each player's last move for the seat tags, and clears it each street", () => {
    const rec = turns(['A', 'B', 'C']);
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'A', { type: 'raise', to: 60 });
    act(rec, 'B', { type: 'fold' });
    expect([player(rec, 'A').lastAction, player(rec, 'B').lastAction]).toEqual(['Raise 60', 'Fold']);
    act(rec, 'C', { type: 'call' });
    expect(player(rec, 'C').lastAction).toBeNull();
    act(rec, 'A', { type: 'dealt' });
    act(rec, 'C', { type: 'check' });
    expect(player(rec, 'C').lastAction).toBe('Check');
    act(rec, 'C', { type: 'undo' });
    expect(player(rec, 'C').lastAction).toBeNull();
  });
});

describe('poll size', () => {
  it('sends only new hand-log entries, so a 10-player table with a full log stays small', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const rec = table(names, { startingChips: 1_000_000, smallBlind: 0, bigBlind: 0 });
    const hand = (n: number) => {
      act(rec, 'A', { type: 'start_hand' });
      for (const id of names) act(rec, id, { type: 'bet', amount: 10 + n });
      act(rec, 'A', { type: 'award', winners: [names[n % 10]] });
    };
    for (let n = 0; n < 310; n++) hand(n);
    expect(rec.party.log).toHaveLength(300);

    // A browser that has never seen the table gets everything.
    const first = await (await viewBody(rec, 'A')).json();
    expect(first.party.log).toHaveLength(300);
    let mine: LogEntry[] = first.party.log;
    const key = () => logKey(mine[mine.length - 1]);

    // Mid-hand, nothing new in the log: no log entries at all.
    act(rec, 'A', { type: 'start_hand' });
    act(rec, 'B', { type: 'bet', amount: 50 });
    const midHand = await (await viewBody(rec, 'A', {}, key())).text();
    expect(JSON.parse(midHand).party.log).toEqual([]);
    expect(midHand.length).toBeLessThan(8_000);
    expect(JSON.stringify(first).length).toBeGreaterThan(150_000);

    // The hand ends: just that entry, and merging gives the browser the same log as the server.
    act(rec, 'A', { type: 'award', winners: ['B'] });
    const after = await (await viewBody(rec, 'A', {}, key())).json();
    expect(after.party.log).toHaveLength(1);
    mine = mergeLog(mine, after.logAfter, after.party.log)!;
    expect(mine).toEqual(rec.party.log);

    // A key the server no longer has (trimmed away, or made up): the whole log again.
    expect((await (await viewBody(rec, 'A', {}, 'nope')).json()).party.log).toHaveLength(300);
    expect(mergeLog(mine, 'nope', [])).toBeNull();
  });
});
