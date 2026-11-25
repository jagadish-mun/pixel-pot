/* Face-up cards in the DOM: my own hand, and hands shown at showdown. The table's board and face-down cards are drawn on the canvas. */

import { PlayingCard } from './Pixels';
import { cardText, type Card } from '@/lib/cards';

/** One face-up card, `width` pixels wide. */
function FaceCard({ card, width, win, flip }: { card: Card; width: number; win?: boolean; flip?: boolean }) {
  return (
    <span className="cardSlot face" style={{ width, height: (width * 14) / 10 }} data-win={win} data-flip={flip} role="img" aria-label={cardText(card)}>
      <PlayingCard card={card} />
    </span>
  );
}

/** Face-up hole cards in a row: mine all hand long, anyone's at showdown. */
export function FaceCards({ cards, width, winning, flip }: { cards: Card[]; width: number; winning?: Set<string>; flip?: boolean }) {
  return (
    <span className="faceCards" role="group" aria-label={cards.map(cardText).join(' ')}>
      {cards.map((card) => (
        <FaceCard key={card} card={card} width={width} win={winning?.has(card)} flip={flip} />
      ))}
    </span>
  );
}
