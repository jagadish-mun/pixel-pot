import { describe, expect, it } from 'vitest';
import { decide, seededRandom } from '../lib/bot';
import { fullDeck, type Card } from '../lib/cards';
import { addBot, applyAction, botView, createParty, joinParty, legalActions } from '../lib/game';
import type { BotLevel, PartyRecord, Settings } from '../lib/types';

const NOW = 1_700_000_000_000;

function shuffler(seed: number) {
  const rng = seededRandom(seed);
  return (): Card[] => {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  };
}

/** A card table: the human host 'Me' plus computer players at the given levels. */
function botTable(levels: BotLevel[], settings: Partial<Settings> = {}): PartyRecord {
  const rec = createParty('BOTS', 'Me', 'tok-me', 'Me', { mode: 'cards', smallBlind: 5, bigBlind: 10, startingChips: 500, ...settings }, NOW);
  for (const level of levels) addBot(rec, level, NOW);
  return rec;
}

const total = (rec: PartyRecord) => rec.party.players.reduce((s, p) => s + p.stack + p.bet, 0);

/**
 * Play AI-only hands (the host sits out with no chips). Every decision goes
 * through applyAction, which throws on anything illegal.
 */
function playBotsOnly(rec: PartyRecord, hands: number, seed: number, samples: number): { hands: number; showdowns: number } {
  const deal = shuffler(seed);
  const rng = seededRandom(seed + 1);
  applyAction(rec, 'Me', { type: 'chips', playerId: 'Me', amount: -rec.party.players[0].stack }, NOW);
  let expected = total(rec);
  let played = 0;
  let showdowns = 0;
  while (played < hands) {
    // Rebuy anyone who went broke so the table keeps going.
    for (const p of rec.party.players.filter((x) => x.bot && x.stack === 0)) {
      applyAction(rec, 'Me', { type: 'chips', playerId: p.id, amount: 500 }, NOW);
      expected += 500;
    }
    applyAction(rec, 'Me', { type: 'start_hand' }, NOW, deal());
    played += 1;
    let steps = 0;
    while (rec.party.phase === 'live') {
      const id = rec.party.toActId!;
      expect(rec.party.players.find((p) => p.id === id)?.bot).toBeTruthy();
      const action = decide(botView(rec, id), legalActions(rec.party, id), rng, { samples });
      applyAction(rec, id, action, NOW);
      expect(total(rec)).toBe(expected);
      if (++steps > 300) throw new Error('A hand never finished.');
    }
    if (rec.party.handResults.length) showdowns += 1;
  }
  return { hands: played, showdowns };
}

describe('computer players: random hands', () => {
  for (const level of ['easy', 'medium', 'hard'] as const) {
    it(`${level}: 2,100 AI-only hands, always legal, chips add up, every hand finishes`, { timeout: 120_000 }, () => {
      const formats: Partial<Settings>[] = [
        { variant: 'holdem', betting: 'no-limit' },
        { variant: 'omaha', betting: 'pot-limit' },
        { variant: 'holdem', betting: 'fixed-limit', ante: 1 },
      ];
      let hands = 0;
      let showdowns = 0;
      formats.forEach((format, i) => {
        const rec = botTable([level, level, level, level, level], format);
        // Few simulated runouts: this checks legality, not skill, and keeps the test quick.
        const r = playBotsOnly(rec, 700, 100 + i, 6);
        hands += r.hands;
        showdowns += r.showdowns;
      });
      expect(hands).toBe(2100);
      expect(showdowns).toBeGreaterThan(200);
    });
  }
});

describe('what a computer player can see', () => {
  it("never includes the deck or another player's cards", () => {
    const rec = botTable(['easy', 'medium', 'hard']);
    applyAction(rec, 'Me', { type: 'start_hand' }, NOW, fullDeck());
    for (const p of rec.party.players.filter((x) => x.bot)) {
      const view = botView(rec, p.id);
      const json = JSON.stringify(view);
      expect(view.cards).toEqual(rec.hole[p.id]);
      for (const [id, cards] of Object.entries(rec.hole)) {
        if (id !== p.id) for (const card of cards) expect(json).not.toContain(`"${card}"`);
      }
      for (const card of rec.deck) expect(json).not.toContain(`"${card}"`);
      expect(json).not.toMatch(/"deck"|"hole"|"tokens"|tok-/);
    }
  });
});

describe('computer players at the table', () => {
  it('only sit at card tables, have no seat key, and can be given chips, removed, and cancelled', () => {
    const cardless = createParty('X', 'Me', 't', 'Me', { mode: 'cardless' }, NOW);
    expect(() => addBot(cardless, 'easy', NOW)).toThrow(/card tables/);
    expect(() => applyAction(cardless, 'Me', { type: 'add_bot', level: 'easy' }, NOW)).toThrow(/card tables/);

    const rec = botTable([]);
    applyAction(rec, 'Me', { type: 'add_bot', level: 'hard' }, NOW);
    applyAction(rec, 'Me', { type: 'add_bot', level: 'easy' }, NOW);
    const [, a, b] = rec.party.players;
    expect([a.name, a.bot, b.bot]).toEqual(['Pixel Pete', { level: 'hard' }, { level: 'easy' }]);
    expect(Object.keys(rec.tokens)).toEqual(['Me']);
    applyAction(rec, 'Me', { type: 'chips', playerId: a.id, amount: 100 }, NOW);
    expect(a.stack).toBe(600);
    applyAction(rec, 'Me', { type: 'start_hand' }, NOW, fullDeck());
    expect(() => applyAction(rec, 'Me', { type: 'add_bot', level: 'easy' }, NOW)).toThrow(/between hands/);
    applyAction(rec, 'Me', { type: 'void_hand' }, NOW);
    expect(rec.party.players.map((p) => p.stack)).toEqual([500, 600, 500]);
    applyAction(rec, 'Me', { type: 'kick', playerId: b.id }, NOW);
    expect(rec.party.players).toHaveLength(2);
  });

  it('a solo table with auto-deal plays itself through, driven only by bot_step and start_hand', () => {
    const rec = botTable(['easy', 'medium', 'hard'], { autoDeal: true });
    const deal = shuffler(7);
    let now = NOW;
    let finished = 0;
    applyAction(rec, 'Me', { type: 'start_hand' }, now, deal());
    for (let step = 0; step < 400 && finished < 5; step++) {
      const party = rec.party;
      if (party.phase === 'idle') {
        finished += 1;
        expect(party.nextHandAt).toBe(now + 3000);
        now = party.nextHandAt!;
        applyAction(rec, 'Me', { type: 'start_hand' }, now, deal());
        continue;
      }
      if (party.toActId === 'Me') {
        expect(party.botActAt).toBeNull();
        expect(() => applyAction(rec, 'Me', { type: 'bot_step' }, now + 10_000)).toThrow(/No computer player/);
        applyAction(rec, 'Me', legalActions(party, 'Me').check ? { type: 'check' } : { type: 'call' }, now);
        continue;
      }
      // A computer player's turn: it "thinks" for 0.8–2.5 s, then exactly one move applies.
      const due = party.botActAt!;
      expect(due - now).toBeGreaterThanOrEqual(800);
      expect(due - now).toBeLessThanOrEqual(2500);
      expect(() => applyAction(rec, 'Me', { type: 'bot_step' }, due - 1)).toThrow(/No computer player/);
      const moves = rec.history.length;
      now = due;
      applyAction(rec, 'Me', { type: 'bot_step' }, now);
      expect(rec.history.length).toBe(moves + 1);
      // A second browser asking at the same moment gets nothing: the next move isn't due yet.
      expect(() => applyAction(rec, 'Me', { type: 'bot_step' }, now)).toThrow(/No computer player/);
    }
    expect(finished).toBe(5);

    // The host can pause auto-deal.
    applyAction(rec, 'Me', { type: 'auto_deal', on: false }, now);
    expect(rec.party.settings.autoDeal).toBe(false);
    if (rec.party.phase === 'idle') expect(rec.party.nextHandAt).toBeNull();
  });

  it("doesn't auto-deal with two humans at the table", () => {
    const rec = botTable(['easy'], { autoDeal: true });
    joinParty(rec, 'Friend', 'tok-friend', 'Friend', NOW);
    applyAction(rec, 'Me', { type: 'start_hand' }, NOW, fullDeck());
    applyAction(rec, 'Me', { type: 'void_hand' }, NOW);
    applyAction(rec, 'Me', { type: 'auto_deal', on: true }, NOW);
    expect(rec.party.nextHandAt).toBeNull();
  });
});

describe('strength', () => {
  it('medium beats easy over many heads-up hands (fixed seed, slow)', { timeout: 180_000 }, () => {
    const rec = botTable(['medium', 'easy']);
    playBotsOnly(rec, 1500, 42, 120);
    const [, medium, easy] = rec.party.players;
    const net = (p: (typeof rec.party.players)[number]) => p.stack - p.buyIn;
    expect(net(medium)).toBeGreaterThan(0);
    expect(net(medium)).toBeGreaterThan(net(easy));
  });
});
