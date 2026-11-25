/* Playing cards: rank + suit strings like 'As' (ace of spades) or 'Td' (ten of diamonds). */

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
type Suit = 's' | 'h' | 'd' | 'c';
export type Card = `${Rank}${Suit}`;

/** The 52 cards in a fixed order (2s 2h 2d 2c 3s …). Shuffle a copy before dealing. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}` as Card);
  return deck;
}

/** 2 … 14 (ace high). */
export const rankOf = (card: Card) => RANKS.indexOf(card[0]) + 2;
export const suitOf = (card: Card) => card[1] as Suit;

const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** 'Td' → '10♦', for the feed. */
export function cardText(card: Card): string {
  return `${card[0] === 'T' ? '10' : card[0]}${SUIT_SYMBOL[suitOf(card)]}`;
}
