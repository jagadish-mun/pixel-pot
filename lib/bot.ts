/*
 * Computer players. `decide` is pure: it sees only a BotView (what that player
 * could see at a real table) and the legal actions, and always returns one of
 * those actions.
 */
import { fullDeck, rankOf, suitOf, type Card } from './cards';
import { bestScore } from './hand';
import type { Action, BotLevel, LegalActions, Move, MoveStats, Settings, Street } from './types';

/** Everything a computer player may know. Never the deck or anyone else's cards. */
export interface BotView {
  id: string;
  level: BotLevel;
  cards: Card[];
  board: Card[];
  street: Street;
  variant: Settings['variant'];
  betting: Settings['betting'];
  bigBlind: number;
  /** All chips in the pot, including this street's bets. */
  pot: number;
  /** The biggest street total so far, and mine. */
  high: number;
  roundBet: number;
  stack: number;
  /** Everyone still in the hand, in seat order. */
  players: { id: string; stack: number; roundBet: number; folded: boolean }[];
  /** Live players who act after me (fewer is better position). */
  playersAfterMe: number;
  history: Move[];
  /** Opponents' habits over the session. */
  stats: Record<string, MoveStats>;
}

/* ------------------------------- randomness -------------------------------- */

/** A small fast seeded random number generator (mulberry32), returning 0 ≤ x < 1. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* ------------------------------ hand strength ------------------------------ */

/** The Chen formula: a quick preflop score for two cards (about -1 … 20). */
export function chen(a: Card, b: Card): number {
  const points = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  const [hi, lo] = [rankOf(a), rankOf(b)].sort((x, y) => y - x);
  if (hi === lo) return Math.max(5, points(hi) * 2);
  let score = points(hi);
  if (suitOf(a) === suitOf(b)) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/** Preflop score on the Chen scale. Omaha: the best two-card pair, plus a little for other good pairs. */
function preflopScore(cards: Card[]): number {
  if (cards.length === 2) return chen(cards[0], cards[1]);
  const scores: number[] = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) scores.push(chen(cards[i], cards[j]));
  scores.sort((x, y) => y - x);
  return scores[0] + scores.slice(1).filter((s) => s >= 6).length * 0.5 - 1;
}

/**
 * Chance of winning at showdown against `opponents` random hands, by playing
 * the rest of the board out `samples` times. Ties count as a share.
 */
export function winChance(cards: Card[], board: Card[], opponents: number, variant: Settings['variant'], rng: () => number, samples: number): number {
  const known = new Set<string>([...cards, ...board]);
  const deck = fullDeck().filter((c) => !known.has(c));
  const holeCount = variant === 'omaha' ? 4 : 2;
  const need = opponents * holeCount + (5 - board.length);
  let wins = 0;
  for (let s = 0; s < samples; s++) {
    // Partial Fisher–Yates: only shuffle the cards we draw.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const fullBoard = board.concat(deck.slice(0, 5 - board.length));
    const mine = bestScore(cards, fullBoard, variant);
    let ahead = true;
    let tied = 1;
    for (let o = 0; o < opponents && ahead; o++) {
      const start = 5 - board.length + o * holeCount;
      const theirs = bestScore(deck.slice(start, start + holeCount), fullBoard, variant);
      if (theirs > mine) ahead = false;
      else if (theirs === mine) tied += 1;
    }
    if (ahead) wins += 1 / tied;
  }
  return wins / samples;
}

/** A flush or straight draw: one card away, with cards still to come. */
function hasDraw(cards: Card[], board: Card[]): boolean {
  if (board.length === 0 || board.length >= 5) return false;
  const all = [...cards, ...board];
  const suits = new Map<string, number>();
  for (const c of all) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1);
  const flushDraw = [...suits].some(([suit, n]) => n === 4 && cards.some((c) => suitOf(c) === suit));
  const ranks = new Set(all.map(rankOf));
  if (ranks.has(14)) ranks.add(1);
  let straightDraw = false;
  for (let low = 1; low <= 10; low++) {
    let n = 0;
    for (let r = low; r < low + 5; r++) if (ranks.has(r)) n++;
    if (n === 4) straightDraw = true;
  }
  return flushDraw || straightDraw;
}

/* --------------------------------- choices --------------------------------- */

/** What the player wants to do, before it is fitted to the legal actions. */
export type Intent = { kind: 'fold' | 'check' | 'call' | 'allin' } | { kind: 'raise'; to: number };

/** Turn an intent into a legal action. Amounts are clamped to the legal range; anything else falls back safely. */
export function makeLegal(intent: Intent, legal: LegalActions): Action {
  const passive = (): Action => (legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' });
  switch (intent.kind) {
    case 'fold':
      // Never fold when checking is free.
      return legal.check ? { type: 'check' } : { type: 'fold' };
    case 'check':
      return legal.check ? { type: 'check' } : { type: 'fold' };
    case 'call':
      return passive();
    case 'allin':
      if (legal.allin !== null) return { type: 'allin' };
      return makeLegal({ kind: 'raise', to: Infinity }, legal);
    case 'raise': {
      const range = legal.bet ?? legal.raise;
      if (!range) return passive();
      const to = Math.round(Math.min(range.max, Math.max(range.min, intent.to)));
      return legal.bet ? { type: 'bet', amount: to } : { type: 'raise', to };
    }
  }
}

/** Loose and passive: calls a lot, rarely raises, folds now and then for no reason. */
function easy(view: BotView, legal: LegalActions, rng: () => number): Intent {
  const r = rng();
  const minRaise = (legal.bet ?? legal.raise)?.min ?? 0;
  if (legal.check) return r < 0.1 ? { kind: 'raise', to: minRaise } : { kind: 'check' };
  const toCall = view.high - view.roundBet;
  if (r < 0.08) return { kind: 'fold' };
  if (r < 0.13) return { kind: 'raise', to: minRaise };
  if (toCall > view.stack * 0.5 && r < 0.45) return { kind: 'fold' };
  return { kind: 'call' };
}

/** Medium and hard: hand tiers preflop, simulated winning chances after the flop. */
function thinking(view: BotView, rng: () => number, samples: number, hard: boolean): Intent {
  const bb = Math.max(1, view.bigBlind);
  const toCall = view.high - view.roundBet;
  const opponents = view.players.filter((p) => p.id !== view.id && !p.folded).length;
  const potAfterCall = view.pot + toCall;
  const raiseBy = (fraction: number): Intent => ({ kind: 'raise', to: view.high + fraction * potAfterCall });

  // Hard: late position plays looser; aggressive opponents get called lighter, passive ones respected.
  let loosen = 0;
  if (hard) {
    if (view.playersAfterMe <= 1) loosen += 0.05;
    const aggressor = [...view.history]
      .reverse()
      .find((m) => m.street === view.street && m.id !== view.id && (m.type === 'bet' || m.type === 'raise' || m.type === 'allin'));
    const s = aggressor ? view.stats[aggressor.id] : undefined;
    if (s && s.aggressive + s.passive >= 6) {
      const aggression = s.aggressive / (s.aggressive + s.passive);
      if (aggression > 0.4) loosen += 0.06;
      else if (aggression < 0.15) loosen -= 0.06;
    }
    // Fixed-limit bets are small and capped, so pushing good hands costs little.
    if (view.betting === 'fixed-limit') loosen += 0.03;
  }

  /* ----- preflop: Chen tiers ----- */
  if (view.board.length === 0) {
    const score = preflopScore(view.cards) + (hard && view.playersAfterMe <= 1 ? 1.5 : 0);
    const raises = view.history.filter((m) => m.street === 'preflop' && (m.type === 'raise' || m.type === 'allin')).length;
    if (score >= 10) return raises >= 2 && score < 12 ? { kind: 'call' } : { kind: 'raise', to: view.high * 3 + toCall };
    if (score >= 8) {
      if (raises === 0) return { kind: 'raise', to: view.high + 2 * bb + toCall };
      return toCall <= 6 * bb ? { kind: 'call' } : { kind: 'fold' };
    }
    if (score >= 6) return toCall <= 2.5 * bb ? { kind: 'call' } : { kind: 'fold' };
    if (toCall === 0 && rng() < 0.05) return { kind: 'raise', to: view.high + 2 * bb };
    return toCall <= bb && score >= 4 ? { kind: 'call' } : { kind: 'fold' };
  }

  /* ----- after the flop: winning chance against the price ----- */
  const chance = winChance(view.cards, view.board, Math.max(1, opponents), view.variant, rng, samples);
  const draw = hard && hasDraw(view.cards, view.board);

  if (toCall === 0) {
    if (chance > 0.7) return raiseBy(0.5 + (chance - 0.7));
    if (chance > 0.5 - loosen && rng() < 0.6) return raiseBy(0.5);
    if (draw && rng() < 0.4) return raiseBy(0.6); // semi-bluff
    if (rng() < 0.07) return raiseBy(0.5); // bluff
    return { kind: 'check' };
  }

  const price = toCall / potAfterCall;
  if (chance > 0.8) return raiseBy(0.75);
  if (chance > 0.65 && rng() < 0.35) return raiseBy(0.6);
  if (draw && chance >= price - 0.1 && rng() < 0.25) return raiseBy(0.6); // semi-bluff raise
  if (chance >= price + 0.05 - loosen) return { kind: 'call' };
  if (draw && chance >= price - 0.08) return { kind: 'call' };
  if (rng() < 0.03) return raiseBy(0.6); // bluff
  return { kind: 'fold' };
}

/** Pick an action. Always one of `legal`. `samples` sets how many simulated runouts medium and hard use. */
export function decide(view: BotView, legal: LegalActions, rng: () => number, options: { samples?: number } = {}): Action {
  const samples = options.samples ?? 400;
  const intent = view.level === 'easy' ? easy(view, legal, rng) : thinking(view, rng, samples, view.level === 'hard');
  return makeLegal(intent, legal);
}

/** Fun names for computer players. */
export const BOT_NAMES = [
  'Pixel Pete',
  'Bitsy',
  'Chiptune',
  'Glitch',
  '8-Bit Bev',
  'Joystick',
  'Arcade Ada',
  'Mega Max',
  'Byte',
  'Cartridge',
  'Pong',
  'Sprite',
];
