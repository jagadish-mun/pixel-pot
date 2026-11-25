/*
 * Poker hand evaluator. Scores any 1–5 cards so the same code names a hand
 * before the river ("Pair of Queens") and settles the showdown. Bigger score
 * wins; equal scores tie.
 */
import { rankOf, suitOf, type Card } from './cards';

export interface Hand {
  /** Compare with > and ===. */
  score: number;
  /** 0 high card … 8 straight flush. */
  category: number;
  /** "Flush, Ace high", "Two pair, Kings and Sevens". */
  name: string;
  /** The cards that make the hand. */
  cards: Card[];
}

const RANK_NAME = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const plural = (r: number) => (r === 6 ? 'Sixes' : `${RANK_NAME[r]}s`);

type Rated = { score: number; category: number; tiebreak: number[] };

/** Category and score of up to five cards, without building a name (hot path for simulations). */
function rate(cards: Card[]): Rated {
  const counts = new Array<number>(15).fill(0);
  const ranks: number[] = [];
  for (const c of cards) {
    const r = rankOf(c);
    counts[r] += 1;
    ranks.push(r);
  }
  ranks.sort((a, b) => b - a);
  // Groups by size, then rank: e.g. a full house gives [[K,3],[7,2]].
  const groups: [number, number][] = [];
  for (let size = 4; size >= 1; size--) for (let r = 14; r >= 2; r--) if (counts[r] === size) groups.push([r, size]);

  const five = cards.length === 5;
  const flush = five && cards.every((c) => suitOf(c) === suitOf(cards[0]));
  let straightTop = 0;
  if (five && groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
    // The wheel: A-2-3-4-5, where the ace counts low.
    else if (ranks[0] === 14 && ranks[1] === 5) straightTop = 5;
  }

  const [g0, g1] = groups;
  let category: number;
  let tiebreak: number[];
  if (straightTop && flush) [category, tiebreak] = [8, [straightTop]];
  else if (g0[1] === 4) [category, tiebreak] = [7, groups.map((g) => g[0])];
  else if (g0[1] === 3 && g1?.[1] === 2) [category, tiebreak] = [6, [g0[0], g1[0]]];
  else if (flush) [category, tiebreak] = [5, ranks];
  else if (straightTop) [category, tiebreak] = [4, [straightTop]];
  else if (g0[1] === 3) [category, tiebreak] = [3, groups.map((g) => g[0])];
  else if (g0[1] === 2 && g1?.[1] === 2) [category, tiebreak] = [2, groups.map((g) => g[0])];
  else if (g0[1] === 2) [category, tiebreak] = [1, groups.map((g) => g[0])];
  else [category, tiebreak] = [0, ranks];

  // Base 15 keeps every rank (2–14) in its own digit: category first, then tiebreaks in order.
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (tiebreak[i] ?? 0);
  return { score, category, tiebreak };
}

function handName({ category, tiebreak: [a, b] }: Rated): string {
  switch (category) {
    case 8:
      return a === 14 ? 'Royal flush' : `Straight flush, ${RANK_NAME[a]} high`;
    case 7:
      return `Four of a kind, ${plural(a)}`;
    case 6:
      return `Full house, ${plural(a)} full of ${plural(b)}`;
    case 5:
      return `Flush, ${RANK_NAME[a]} high`;
    case 4:
      return `Straight, ${RANK_NAME[a]} high`;
    case 3:
      return `Three of a kind, ${plural(a)}`;
    case 2:
      return `Two pair, ${plural(a)} and ${plural(b)}`;
    case 1:
      return `Pair of ${plural(a)}`;
    default:
      return `${RANK_NAME[a]} high`;
  }
}

/** Score and name one hand of up to five cards. */
export function evaluateFive(cards: Card[]): Hand {
  const rated = rate(cards);
  return { score: rated.score, category: rated.category, name: handName(rated), cards };
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

/** The best of several five-card hands. Only the winner gets a name. */
function best(hands: Card[][]): Hand {
  let top = -1;
  let topCards = hands[0];
  for (const h of hands) {
    const score = rate(h).score;
    if (score > top) [top, topCards] = [score, h];
  }
  return evaluateFive(topCards);
}

/** Just the score of the best hand: for simulations, which only compare. */
export function bestScore(hole: Card[], board: Card[], variant: 'holdem' | 'omaha'): number {
  let top = -1;
  for (const h of candidates(hole, board, variant)) top = Math.max(top, rate(h).score);
  return top;
}

function candidates(hole: Card[], board: Card[], variant: 'holdem' | 'omaha'): Card[][] {
  if (variant === 'omaha') {
    const boardPart = board.length >= 3 ? combinations(board, 3) : [board];
    return combinations(hole, 2).flatMap((pair) => boardPart.map((b) => [...pair, ...b]));
  }
  const all = [...hole, ...board];
  return all.length > 5 ? combinations(all, 5) : [all];
}

/**
 * The best hand from hole cards and the board. Hold'em: any 5 of the cards.
 * Omaha: exactly 2 hole cards with exactly 3 board cards (before the flop,
 * the best 2 hole cards with whatever board there is).
 */
export function bestHand(hole: Card[], board: Card[], variant: 'holdem' | 'omaha'): Hand {
  return best(candidates(hole, board, variant));
}

/** "a Flush, Ace high", "Two pair, …": the hand name as it reads after "with". */
export function withArticle(hand: Hand): string {
  return [1, 4, 5, 6, 8].includes(hand.category) ? `a ${hand.name}` : hand.name;
}
