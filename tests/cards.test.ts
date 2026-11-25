import { describe, expect, it } from 'vitest';
import { fullDeck, type Card } from '../lib/cards';
import { applyAction, createParty, joinParty, legalActions, viewFor } from '../lib/game';
import { bestHand, evaluateFive } from '../lib/hand';
import type { Action, PartyRecord, Settings } from '../lib/types';

const NOW = 1_700_000_000_000;
const c = (s: string) => s.split(' ') as Card[];

/* --------------------------------- evaluator -------------------------------- */

describe('hand evaluator', () => {
  const hands: [string, string][] = [
    ['As Ks Qs Js Ts', 'Royal flush'],
    ['9h 8h 7h 6h 5h', 'Straight flush, Nine high'],
    ['Qd Qc Qh Qs 3d', 'Four of a kind, Queens'],
    ['7s 7d 7c 2h 2d', 'Full house, Sevens full of Twos'],
    ['Ad Jd 8d 6d 3d', 'Flush, Ace high'],
    ['Tc 9d 8h 7s 6c', 'Straight, Ten high'],
    ['6s 6d 6h Kc 2d', 'Three of a kind, Sixes'],
    ['Ks Kd 7c 7h 2s', 'Two pair, Kings and Sevens'],
    ['Qs Qd 9c 5h 2s', 'Pair of Queens'],
    ['As Jd 8c 5h 2s', 'Ace high'],
  ];

  it('names every category and ranks them in order', () => {
    const scored = hands.map(([cards, name]) => {
      const h = evaluateFive(c(cards));
      expect(h.name).toBe(name);
      return h.score;
    });
    for (let i = 1; i < scored.length; i++) expect(scored[i - 1]).toBeGreaterThan(scored[i]);
  });

  it('counts the ace low in A-2-3-4-5, and only there', () => {
    const wheel = evaluateFive(c('As 2d 3c 4h 5s'));
    expect(wheel.name).toBe('Straight, Five high');
    expect(evaluateFive(c('2d 3c 4h 5s 6s')).score).toBeGreaterThan(wheel.score);
    expect(wheel.score).toBeGreaterThan(evaluateFive(c('As Ad Kc Qh Jh')).score);
    expect(evaluateFive(c('Kd As 2c 3h 4s')).name).toBe('Ace high');
    expect(evaluateFive(c('5h 4h 3h 2h Ah')).name).toBe('Straight flush, Five high');
  });

  it('uses kickers to break ties', () => {
    const better = (a: string, b: string) => expect(evaluateFive(c(a)).score).toBeGreaterThan(evaluateFive(c(b)).score);
    better('Ah Ad Kc 7s 2d', 'As Ac Qh 7d 2c'); // pair kicker
    better('Kh Kd 7c 7s Ad', 'Ks Kc 7h 7d Qc'); // two pair kicker
    better('Kh Kd 8c 8s 2d', 'Ks Kc 7h 7d Ac'); // second pair beats a kicker
    better('Ah Jd 8c 5s 3d', 'As Jc 8h 5d 2c'); // last high card
    better('9h 9d 9c 4s 4d', '8s 8c 8h Ad Ac'); // full house: trips first
    better('Ad Kd 9d 6d 3d', 'Ah Kh 9h 6h 2h'); // flush down to the last card
  });

  it('ties identical hands in different suits', () => {
    expect(evaluateFive(c('Ah Kd Qc Js 9d')).score).toBe(evaluateFive(c('Ad Kc Qs Jh 9c')).score);
    expect(evaluateFive(c('Tc 9d 8h 7s 6c')).score).toBe(evaluateFive(c('Th 9s 8d 7c 6h')).score);
  });

  it("Hold'em: best five of seven, and the board can play", () => {
    expect(bestHand(c('2c 7d'), c('Ah Kh Qh Jh Th'), 'holdem').name).toBe('Royal flush');
    expect(bestHand(c('As Ad'), c('Ah Kc Kd 9s 2h'), 'holdem').name).toBe('Full house, Aces full of Kings');
    expect(bestHand(c('Ks Qs'), c('As Js Ts 2d 3c'), 'holdem').name).toBe('Royal flush');
  });

  it('Omaha uses exactly two hole cards and three from the board', () => {
    // Four hearts on the board and one in hand is not a flush.
    expect(bestHand(c('Ah 2c 3d 4s'), c('Kh Qh 9h 5h 7c'), 'omaha').category).not.toBe(5);
    // Two hearts in hand is.
    expect(bestHand(c('Ah 2h 3d 4s'), c('Kh Qh 9h 5c 7c'), 'omaha').name).toBe('Flush, Ace high');
    // A straight on the board doesn't play by itself.
    expect(bestHand(c('Ac Kd 2s 2h'), c('5h 6c 7d 8s 9h'), 'omaha').category).toBeLessThan(4);
    // Four aces in hand is only a pair of aces.
    expect(bestHand(c('As Ah Ad Ac'), c('2s 7h 9d Jc 4s'), 'omaha').name).toBe('Pair of Aces');
    // Trips on the board plus a pair in hand is a full house.
    expect(bestHand(c('Ks Kd 7c 8c'), c('As Ah Ad 3c 2s'), 'omaha').name).toBe('Full house, Aces full of Kings');
  });

  it('names a hand before the river', () => {
    expect(bestHand(c('Qs Qd'), [], 'holdem').name).toBe('Pair of Queens');
    expect(bestHand(c('As 7d'), [], 'holdem').name).toBe('Ace high');
    expect(bestHand(c('As 7d'), c('Ad 7c 2h'), 'holdem').name).toBe('Two pair, Aces and Sevens');
    expect(bestHand(c('Ks Kd 2c 3h'), [], 'omaha').name).toBe('Pair of Kings');
  });
});

/* ---------------------------------- dealing --------------------------------- */

function cardsTable(names: string[], settings: Partial<Settings> = {}): PartyRecord {
  const rec = createParty('CARD', names[0], `tok-${names[0]}`, names[0], { mode: 'cards', smallBlind: 5, bigBlind: 10, ...settings }, NOW);
  for (const n of names.slice(1)) joinParty(rec, n, `tok-${n}`, n, NOW);
  return rec;
}

/**
 * A deck that deals the given hole cards and board. `order` is the deal order
 * (left of the button first). Burns and the rest are unused cards.
 */
function stackedDeck(order: string[], holes: Record<string, string>, board: string): Card[] {
  const per = c(holes[order[0]]).length;
  const used = new Set<string>([...Object.values(holes).flatMap(c), ...c(board)]);
  const spare = fullDeck().filter((x) => !used.has(x));
  const deck: Card[] = [];
  for (let r = 0; r < per; r++) for (const id of order) deck.push(c(holes[id])[r]);
  const [f1, f2, f3, t, rv] = c(board);
  deck.push(spare.shift()!, f1, f2, f3, spare.shift()!, t, spare.shift()!, rv);
  return [...deck, ...spare];
}

const act = (rec: PartyRecord, who: string, action: Action) => applyAction(rec, who, action, NOW);

describe('dealing', () => {
  it('deals one card at a time from left of the button, and burns before each street', () => {
    const rec = cardsTable(['A', 'B', 'C']);
    const deck = fullDeck();
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, deck);
    // A has the button, so B is dealt first.
    expect(rec.hole).toEqual({ B: [deck[0], deck[3]], C: [deck[1], deck[4]], A: [deck[2], deck[5]] });
    expect(rec.deck).toHaveLength(46);
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'call' });
    act(rec, 'C', { type: 'check' });
    // Burn deck[6], flop deck[7..9]; no waiting for a dealer in card mode.
    expect(rec.party.board).toEqual(deck.slice(7, 10));
    expect(rec.party.awaitingDeal).toBeNull();
    expect(rec.party.toActId).toBe('B');
    for (const id of ['B', 'C', 'A']) act(rec, id, { type: 'check' });
    expect(rec.party.board).toEqual([...deck.slice(7, 10), deck[11]]);
    for (const id of ['B', 'C', 'A']) act(rec, id, { type: 'check' });
    expect(rec.party.board).toEqual([...deck.slice(7, 10), deck[11], deck[13]]);
  });

  it('deals four cards each in Omaha', () => {
    const rec = cardsTable(['A', 'B'], { variant: 'omaha', betting: 'pot-limit' });
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    expect(Object.values(rec.hole).map((h) => h.length)).toEqual([4, 4]);
  });

  it('needs a 52-card deck to deal', () => {
    const rec = cardsTable(['A', 'B']);
    expect(() => act(rec, 'A', { type: 'start_hand' })).toThrow(/deck/);
  });

  it("leaves cardless tables without cards, still waiting for 'dealt'", () => {
    const rec = cardsTable(['A', 'B'], { mode: 'cardless' });
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'check' });
    expect([rec.deck.length, Object.keys(rec.hole).length, rec.party.board.length, rec.party.awaitingDeal]).toEqual([0, 0, 0, 'flop']);
  });
});

/* --------------------------------- security --------------------------------- */

describe('what each browser can see', () => {
  const quoted = (json: string, card: Card) => json.includes(`"${card}"`);

  it("never sends a seat another player's cards or the deck", () => {
    const rec = cardsTable(['A', 'B', 'C']);
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    for (const viewer of ['A', 'B', 'C', null]) {
      const view = viewFor(rec, viewer);
      const json = JSON.stringify(view);
      expect(view.myCards).toEqual(viewer ? rec.hole[viewer] : null);
      for (const [id, cards] of Object.entries(rec.hole)) {
        if (id !== viewer) for (const card of cards) expect(quoted(json, card)).toBe(false);
      }
      for (const card of rec.deck) expect(quoted(json, card)).toBe(false);
      expect(json).not.toMatch(/"deck"|"hole"|"tokens"|tok-/);
    }
  });

  it("shows hands at showdown, but never a folded player's", () => {
    const rec = cardsTable(['A', 'B', 'C']);
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    act(rec, 'A', { type: 'fold' });
    act(rec, 'B', { type: 'call' });
    act(rec, 'C', { type: 'check' });
    for (let street = 0; street < 3; street++) for (const id of ['B', 'C']) act(rec, id, { type: 'check' });
    expect(rec.party.phase).toBe('idle');
    expect(Object.keys(rec.party.shown).sort()).toEqual(['B', 'C']);
    const json = JSON.stringify(viewFor(rec, 'B'));
    for (const card of rec.hole.A) expect(quoted(json, card)).toBe(false);
  });
});

/* --------------------------------- showdown --------------------------------- */

const total = (rec: PartyRecord) => rec.party.players.reduce((s, p) => s + p.stack + p.bet, 0);
const stacks = (rec: PartyRecord) => rec.party.players.map((p) => p.stack);
const feed = (rec: PartyRecord) => rec.party.feed.map((f) => f.text);

describe('automatic showdown', () => {
  it('pays a three-way all-in: the main pot and the side pot to different players', () => {
    const rec = cardsTable(['A', 'B', 'C']);
    act(rec, 'A', { type: 'chips', playerId: 'A', amount: -900 });
    act(rec, 'A', { type: 'chips', playerId: 'B', amount: -700 });
    // A: 100 chips and the best hand. B: 300 and the second best. C: 1,000 and the worst.
    const deck = stackedDeck(['B', 'C', 'A'], { A: 'As Ad', B: 'Ks Kd', C: '7c 2h' }, 'Ah Kc 9d 5s 3c');
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, deck);
    act(rec, 'A', { type: 'allin' });
    act(rec, 'B', { type: 'allin' });
    act(rec, 'C', { type: 'call' });

    // Nobody can bet any more, so the board runs out and the showdown pays itself.
    expect(rec.party.phase).toBe('idle');
    expect(rec.party.board).toEqual(c('Ah Kc 9d 5s 3c'));
    expect(stacks(rec)).toEqual([300, 400, 700]);
    expect(feed(rec)).toContain('A wins 300 with Three of a kind, Aces');
    expect(feed(rec)).toContain('B wins 400 with Three of a kind, Kings');
    expect(rec.party.handResults).toEqual([
      expect.objectContaining({ id: 'A', amount: 300, hand: 'Three of a kind, Aces' }),
      expect.objectContaining({ id: 'B', amount: 400, hand: 'Three of a kind, Kings' }),
      expect.objectContaining({ id: 'C', amount: 0, hand: 'Ace high' }),
    ]);
    expect(rec.party.handResults[0].best.sort()).toEqual(c('Ad Ah As Kc 9d').sort());
    expect(Object.keys(rec.party.shown).sort()).toEqual(['A', 'B', 'C']);
    expect(rec.party.log[rec.party.log.length - 1]).toMatchObject({ kind: 'hand', pot: 700, winners: ['A', 'B'] });
  });

  it('returns uncalled chips when the caller is all in for less', () => {
    const rec = cardsTable(['A', 'B']);
    act(rec, 'A', { type: 'chips', playerId: 'B', amount: -800 });
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    act(rec, 'A', { type: 'raise', to: 500 });
    act(rec, 'B', { type: 'call' });
    expect(rec.party.board).toHaveLength(5);
    expect(rec.party.phase).toBe('idle');
    expect(feed(rec)).toContain('300 uncalled goes back to A');
    expect(total(rec)).toBe(1200);
  });

  it('splits a tie, with the odd chip to the first winner in seat order', () => {
    const rec = cardsTable(['A', 'B', 'C'], { smallBlind: 1, bigBlind: 2 });
    const deck = stackedDeck(['B', 'C', 'A'], { A: '2c 3d', B: '2d 3c', C: '4h 4s' }, 'Ah Kh Qh Jh Th');
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, deck);
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'fold' });
    act(rec, 'C', { type: 'check' });
    for (let street = 0; street < 3; street++) for (const id of ['C', 'A']) act(rec, id, { type: 'check' });
    // The board is a royal flush, so A and C split the 5 chip pot; A, first in seat order, gets the odd chip.
    expect(feed(rec)).toContain('A and C split 5 with a Royal flush');
    expect(stacks(rec)).toEqual([1001, 999, 1000]);
  });

  it("doesn't use the host's award in card mode", () => {
    const rec = cardsTable(['A', 'B']);
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    expect(() => act(rec, 'A', { type: 'award', winners: ['A'] })).toThrow(/works out who won/);
  });

  it('lets a winner without a showdown show their cards, or not', () => {
    const rec = cardsTable(['A', 'B']);
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    act(rec, 'A', { type: 'fold' });
    expect([rec.party.phase, rec.party.canShow, Object.keys(rec.party.shown).length]).toEqual(['idle', 'B', 0]);
    expect(() => act(rec, 'A', { type: 'show' })).toThrow(/no cards to show/);
    act(rec, 'B', { type: 'show' });
    expect(rec.party.shown.B).toEqual(rec.hole.B);
    expect(rec.party.canShow).toBeNull();
  });

  it('throws the cards away when the host cancels the hand', () => {
    const rec = cardsTable(['A', 'B']);
    applyAction(rec, 'A', { type: 'start_hand' }, NOW, fullDeck());
    act(rec, 'A', { type: 'call' });
    act(rec, 'B', { type: 'check' });
    act(rec, 'A', { type: 'void_hand' });
    expect([rec.deck.length, Object.keys(rec.hole).length, rec.party.board.length]).toEqual([0, 0, 0]);
    expect(stacks(rec)).toEqual([1000, 1000]);
  });
});

/* ------------------------------------ fuzz ---------------------------------- */

/** Cards burned so far: one before each street. */
const burned = (board: number) => ({ 0: 0, 3: 1, 4: 2, 5: 3 })[board]!;

describe('chips and cards are conserved in card mode', () => {
  for (const variant of ['holdem', 'omaha'] as const) {
    it(`${variant}: random play to showdown never creates chips or duplicates cards`, () => {
      let seed = 23;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const shuffled = () => {
        const d = fullDeck();
        for (let i = d.length - 1; i > 0; i--) {
          const j = rnd(i + 1);
          [d[i], d[j]] = [d[j], d[i]];
        }
        return d;
      };
      const ids = ['A', 'B', 'C', 'D', 'E'];
      const rec = cardsTable(ids, { startingChips: 400, ante: 1, variant, betting: variant === 'omaha' ? 'pot-limit' : 'no-limit' });
      let hands = 0;
      let showdowns = 0;
      let expected = 2000;
      for (let step = 0; step < 20_000 && hands < 150; step++) {
        const party = rec.party;
        if (party.phase === 'idle') {
          if (party.handResults.length) showdowns += 1;
          // Rebuy anyone who went broke, so play keeps going.
          for (const p of party.players.filter((x) => x.stack === 0)) {
            act(rec, 'A', { type: 'chips', playerId: p.id, amount: 400 });
            expected += 400;
          }
          applyAction(rec, 'A', { type: 'start_hand' }, NOW, shuffled());
          hands += 1;
        } else {
          const id = party.toActId!;
          expect(id).toBeTruthy();
          const l = legalActions(party, id);
          const options: Action[] = [];
          if (l.check) options.push({ type: 'check' }, { type: 'check' }, { type: 'check' });
          if (l.call !== null) options.push({ type: 'call' }, { type: 'call' }, { type: 'call' });
          if (l.bet) options.push({ type: 'bet', amount: l.bet.min + rnd(l.bet.max - l.bet.min + 1) });
          if (l.raise) options.push({ type: 'raise', to: l.raise.min + rnd(l.raise.max - l.raise.min + 1) });
          if (l.allin !== null && rnd(6) === 0) options.push({ type: 'allin' });
          if (rnd(8) === 0) options.push({ type: 'fold' });
          if (options.length === 0) options.push({ type: 'fold' });
          act(rec, id, options[rnd(options.length)]);
        }
        expect(total(rec)).toBe(expected);
        if (rec.party.phase === 'live') {
          // Every card is somewhere exactly once: the deck, the board, a hand, or burned.
          const all = [...rec.deck, ...rec.party.board, ...Object.values(rec.hole).flat()];
          expect(new Set(all).size).toBe(all.length);
          expect(all.length).toBe(52 - burned(rec.party.board.length));
        }
      }
      expect(hands).toBe(150);
      expect(showdowns).toBeGreaterThan(20);
    });
  }
});
