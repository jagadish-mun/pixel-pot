/* Card positions on the table: face up, face down, or an empty slot. The art lives in Pixels.tsx. */

import { CardBack, PlayingCard } from './Pixels';
import { cardText, type Card } from '@/lib/cards';

/**
 * One card position. `card` shows it face up; `faceDown` draws a back;
 * otherwise the slot is empty, optionally labelled with the street a
 * cardless table has dealt. Without `width`, CSS sizes the slot.
 */
export function CardSlot({
  card,
  faceDown,
  label,
  width,
  win,
  flip,
}: {
  card?: Card | null;
  faceDown?: boolean;
  label?: string;
  width?: number;
  /** Part of a winning hand: highlighted. */
  win?: boolean;
  /** Turn over as it appears (showdown). */
  flip?: boolean;
}) {
  const style = width ? { width, height: (width * 14) / 10 } : undefined;
  if (faceDown) {
    return (
      <span className="cardSlot" style={style}>
        <CardBack />
      </span>
    );
  }
  if (card) {
    return (
      <span className="cardSlot face" style={style} data-win={win} data-flip={flip} role="img" aria-label={cardText(card)}>
        <PlayingCard card={card} />
      </span>
    );
  }
  return (
    <span className="cardSlot empty" style={style} data-dealt={Boolean(label)}>
      {label && <small>{label}</small>}
    </span>
  );
}

/** A player's hole cards, face down, fanned slightly. */
export function HoleCards({ count, width = 16 }: { count: number; width?: number }) {
  return (
    <span className="holeCards" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <CardSlot key={i} faceDown width={width} />
      ))}
    </span>
  );
}

/** Face-up hole cards in a row: mine all hand long, anyone's at showdown. */
export function FaceCards({ cards, width, winning, flip }: { cards: Card[]; width: number; winning?: Set<string>; flip?: boolean }) {
  return (
    <span className="faceCards" role="group" aria-label={cards.map(cardText).join(' ')}>
      {cards.map((card) => (
        <CardSlot key={card} card={card} width={width} win={winning?.has(card)} flip={flip} />
      ))}
    </span>
  );
}
