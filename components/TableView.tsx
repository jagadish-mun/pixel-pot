'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CardSlot, FaceCards, HoleCards } from './Cards';
import { ChipStack, Face, RobotFace } from './Pixels';
import { chips, signed } from '@/lib/client';
import type { Card } from '@/lib/cards';
import { potOf, potsOf, usesTurns } from '@/lib/game';
import { bestHand } from '@/lib/hand';
import type { Action, Party, Player, Street } from '@/lib/types';

/*
 * Seat geometry. Seats sit on an ellipse, evenly spaced by distance along it
 * (not by angle, which bunches seats at the narrow ends). The ring's width ÷
 * height differs between the tall portrait oval and the wide landscape one, so
 * both layouts are computed and CSS picks one with a media query.
 */
const TALL_RING = 0.62; // portrait phones: the seat ring is about 0.62 as wide as it is tall
const WIDE_RING = 1.9; // landscape and desktop

/** `n` points on an ellipse with width/height `ratio`, starting at the bottom and going clockwise. */
function ring(n: number, ratio: number): [number, number][] {
  const steps = 720;
  const at = (i: number) => Math.PI / 2 + (i / steps) * Math.PI * 2;
  const lengths = [0];
  for (let i = 1; i <= steps; i++) {
    const dx = ratio * (Math.cos(at(i)) - Math.cos(at(i - 1)));
    const dy = Math.sin(at(i)) - Math.sin(at(i - 1));
    lengths.push(lengths[i - 1] + Math.hypot(dx, dy));
  }
  const total = lengths[steps];
  const out: [number, number][] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    while (lengths[i] < want) i++;
    out.push([Math.cos(at(i)), Math.sin(at(i))]);
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * How far (in px, x and y) to move a bet from its seat toward the middle so it
 * just clears the seat box. `x, y` is the seat's place on the ring and `ratio`
 * the ring's width/height, so the direction is right on a tall or a wide oval.
 */
function betShift(x: number, y: number, ratio: number, halfW: number, halfH: number): [string, string] {
  const len = Math.hypot(x * ratio, y) || 1;
  const ux = (x * ratio) / len;
  const uy = y / len;
  const d = Math.min(Math.abs(ux) > 0.01 ? halfW / Math.abs(ux) : Infinity, Math.abs(uy) > 0.01 ? halfH / Math.abs(uy) : Infinity);
  return [`${Math.round(ux * d)}px`, `${Math.round(uy * d)}px`];
}

// Seat box sizes (px) as styled in globals.css, plus room for half a bet beside it (bets are taller than wide).
const SEAT = { tall: [78, 83], crowd: [64, 73], wide: [96, 83] };
const BET_ROOM_X = 16;
const BET_ROOM_Y = 24;

/** Chips this player has in front of them: this street's bets, or the whole hand on free-play tables. */
const inFront = (party: Party, p: Player) => (usesTurns(party) ? p.roundBet : p.bet);

/** A player's bet on the felt. When it drops to zero the chips slide into the pot before disappearing. */
function BetChips({ amount, style }: { amount: number; style: CSSProperties }) {
  const [shown, setShown] = useState(amount);
  const [sweeping, setSweeping] = useState(false);
  useEffect(() => {
    if (amount > 0) {
      setShown(amount);
      setSweeping(false);
      return;
    }
    setSweeping(true);
    const t = setTimeout(() => setShown(0), 450);
    return () => clearTimeout(t);
  }, [amount]);
  if (shown <= 0) return null;
  return (
    <div className="tvBet" style={style} data-sweep={sweeping} aria-hidden="true">
      <ChipStack amount={shown} scale={2} maxColumns={1} maxPerColumn={4} />
      <span>{chips(shown)}</span>
    </div>
  );
}

/** A square ring of pixels around a face that empties as the turn timer runs down. */
function TimerRing({ deadline, seconds }: { deadline: number; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  // The 40 border cells of an 11×11 grid, clockwise from the top middle.
  const cells: [number, number][] = [];
  for (let x = 5; x <= 10; x++) cells.push([x, 0]);
  for (let y = 1; y <= 10; y++) cells.push([10, y]);
  for (let x = 9; x >= 0; x--) cells.push([x, 10]);
  for (let y = 9; y >= 0; y--) cells.push([0, y]);
  for (let x = 1; x <= 4; x++) cells.push([x, 0]);
  const left = Math.max(0, Math.min(1, (deadline - now) / (seconds * 1000)));
  const lit = Math.ceil(left * cells.length);
  const color = left > 0.25 ? '#f5b83d' : '#e2483d';
  return (
    <svg className="timerRing" viewBox="0 0 11 11" preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={`${Math.ceil((deadline - now) / 1000)} seconds left`}>
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill={i < lit ? color : 'rgba(12,9,22,.55)'} />
      ))}
    </svg>
  );
}

const DEALT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const SLOT_STREET = ['Flop', 'Flop', 'Flop', 'Turn', 'River'];
const DEAL_HOW: Record<string, string> = { flop: 'Burn 1, deal 3', turn: 'Burn 1, deal 1', river: 'Burn 1, deal 1' };

/**
 * Reveal a board that arrives several streets at once (an all-in runout) one
 * street at a time. Returns how many cards to show.
 */
function useBoardReveal(length: number): number {
  const [visible, setVisible] = useState(length);
  const seen = useRef(length);
  useEffect(() => {
    if (length < visible) {
      // A new hand: start over.
      seen.current = length;
      setVisible(length);
      return;
    }
    if (visible >= length) return;
    // The first street of a change appears at once; any more follow with a pause.
    const first = seen.current !== length;
    seen.current = length;
    const t = setTimeout(() => setVisible((v) => (v < 3 ? 3 : v + 1)), first ? 0 : 900);
    return () => clearTimeout(t);
  }, [length, visible]);
  return Math.min(visible, length);
}

function Seat({
  p,
  party,
  isMe,
  style,
  faceUp,
  winning,
  won,
}: {
  p: Player;
  party: Party;
  isMe: boolean;
  style: CSSProperties;
  /** Hole cards to show face up: mine, or anyone's at showdown. */
  faceUp: Card[] | null;
  winning: Set<string>;
  won: boolean;
}) {
  const playing = party.phase !== 'idle';
  const turns = usesTurns(party);
  const acting = turns && party.phase === 'live' && !party.awaitingDeal && party.toActId === p.id;
  const out = playing ? !p.inHand || p.folded : p.stack === 0;

  let status: ReactNode = null;
  if (playing) {
    if (!p.inHand) status = <span className="dim">{p.stack === 0 ? 'Out' : 'Next hand'}</span>;
    else if (p.folded) status = <span className="tag folded">Folded</span>;
    else if (p.stack === 0) status = <span className="tag allin">All in</span>;
    else if (p.lastAction) status = <span className="tag move">{p.lastAction}</span>;
  } else if (p.stack === 0) {
    status = <span className="dim">Out</span>;
  } else if (p.lastDelta !== null && party.handNo > 0) {
    status = <span className={p.lastDelta > 0 ? 'up' : p.lastDelta < 0 ? 'down' : 'dim'}>{p.lastDelta === 0 ? 'Even' : signed(p.lastDelta)}</span>;
  }

  const roles = [
    party.dealerId === p.id && ['D', 'dealer', 'Dealer'],
    party.sbId === p.id && ['SB', 'blind', 'Small blind'],
    party.bbId === p.id && ['BB', 'blind', 'Big blind'],
  ].filter(Boolean) as [string, string, string][];

  const omaha = party.settings.variant === 'omaha';
  const timer = acting && party.turnDeadline && party.settings.actionTimer > 0 && (
    <TimerRing deadline={party.turnDeadline} seconds={party.settings.actionTimer} />
  );

  const label = [
    p.name,
    `${chips(p.stack)} chips`,
    ...(playing ? roles.map((r) => r[2]) : []),
    acting && 'to act',
    playing && p.folded && 'folded',
    playing && p.lastAction && !p.folded && p.lastAction,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li className="tvSeat" style={style} data-me={isMe} data-out={out} data-turn={acting} data-won={won} aria-label={label}>
      {acting && <span className="tvPointer" aria-hidden="true" />}
      {!faceUp && playing && p.inHand && !p.folded && <HoleCards count={omaha ? 4 : 2} width={12} />}
      <span className={faceUp ? 'tvFace tvCards' : 'tvFace'}>
        {faceUp ? (
          // My own cards, big; anyone else's flip over at showdown.
          <FaceCards cards={faceUp} width={isMe ? (omaha ? 20 : 28) : omaha ? 15 : 22} winning={winning} flip={!isMe} />
        ) : (
          p.bot ? <RobotFace seed={p.id + p.name} size={28} /> : <Face seed={p.id + p.name} size={28} />
        )}
        {timer}
      </span>
      <span className="tvName">
        {p.bot && (
          <span className="tag botTag" title={`Computer player (${p.bot.level})`}>
            AI
          </span>
        )}
        {p.name}
      </span>
      <span className="tvStack">{chips(p.stack)}</span>
      <span className="tvTags">
        {playing &&
          roles.map(([text, kind, title]) => (
            <span key={text} className={`tag ${kind}`} title={title}>
              {text}
            </span>
          ))}
        {acting && p.bot ? (
          <span className="tag thinking" aria-label="thinking">
            thinking<i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        ) : (
          status
        )}
      </span>
    </li>
  );
}

export default function TableView({
  party,
  meId,
  busy = false,
  act,
  lobby,
  myCards = null,
}: {
  party: Party;
  meId: string | null;
  busy?: boolean;
  act?: (action: Action) => Promise<boolean>;
  /** Shown in the middle of the table before the first hand. */
  lobby?: ReactNode;
  /** Cards mode: my own hole cards, which only my browser receives. */
  myCards?: Card[] | null;
}) {
  const n = party.players.length;
  const turns = usesTurns(party);
  const playing = party.phase !== 'idle';

  // I sit at the bottom. Spectators see the table from the host's seat.
  let bottom = party.players.findIndex((p) => p.id === meId);
  if (bottom < 0) bottom = Math.max(0, party.players.findIndex((p) => p.id === party.hostId));
  const tall = ring(n, TALL_RING);
  const wide = ring(n, WIDE_RING);
  const seatTall = n >= 7 ? SEAT.crowd : SEAT.tall;
  const place = (i: number): CSSProperties => {
    const k = (i - bottom + n) % n;
    const [tx, ty] = tall[k];
    const [wx, wy] = wide[k];
    // Bets sit at their seat's place, shifted toward the middle just past the seat box.
    const [tbx, tby] = betShift(tx, ty, TALL_RING, seatTall[0] / 2 + BET_ROOM_X, seatTall[1] / 2 + BET_ROOM_Y);
    const [wbx, wby] = betShift(wx, wy, WIDE_RING, SEAT.wide[0] / 2 + BET_ROOM_X, SEAT.wide[1] / 2 + BET_ROOM_Y);
    return {
      '--sx': round(tx),
      '--sy': round(ty),
      '--wx': round(wx),
      '--wy': round(wy),
      '--tbx': tbx,
      '--tby': tby,
      '--wbx': wbx,
      '--wby': wby,
    } as CSSProperties;
  };

  const total = potOf(party);
  const middle = total - party.players.reduce((sum, p) => sum + inFront(party, p), 0);
  // Side pots only once this street's chips are in the middle; mid-street, uncalled bets would look like pots.
  const sidePots = middle === total ? potsOf(party).filter((pot) => pot.eligible.length >= 2) : [];

  // Between hands, the middle says how the last hand ended.
  const lastHand = [...party.log].reverse().find((e) => e.kind === 'hand');
  let potLine = playing ? 'Pot' : 'Deal the next hand';
  if (!playing && lastHand?.kind === 'hand') {
    const names = lastHand.rows.filter((r) => lastHand.winners.includes(r.id)).map((r) => r.name);
    potLine = names.length ? `Last pot went to ${names.join(' & ')}` : 'Last pot';
  }
  const shownPot = playing ? total : lastHand?.kind === 'hand' ? lastHand.pot : 0;

  // Cards mode: the board as revealed so far, and once it's all out, the showdown.
  const cardsMode = party.settings.mode === 'cards';
  const visible = useBoardReveal(party.board.length);
  const revealed = visible === party.board.length;
  const board = party.board.slice(0, visible);
  const winners = revealed ? party.handResults.filter((r) => r.amount > 0) : [];
  const winning = new Set<string>(winners.flatMap((r) => r.best));
  const me = party.players.find((p) => p.id === meId);
  const faceUp = (p: Player): Card[] | null => {
    if (revealed && party.shown[p.id]) return party.shown[p.id];
    if (p.id === meId && myCards?.length) return myCards;
    return null;
  };
  const myHand =
    cardsMode && myCards?.length && playing && me?.inHand && !me.folded ? bestHand(myCards, board, party.settings.variant).name : null;

  const awaiting = turns && party.phase === 'live' ? party.awaitingDeal : null;
  const dealer = party.players.find((p) => p.id === party.dealerId);
  const canDeal = Boolean(meId && (meId === party.dealerId || meId === party.hostId));
  let dealt = turns && playing ? DEALT[party.street] : 0;
  if (awaiting) dealt -= awaiting === 'flop' ? 3 : 1;

  let centre: ReactNode;
  if (lobby && !playing && party.handNo === 0) {
    centre = lobby;
  } else if (awaiting) {
    centre = (
      <div className="dealPrompt" role="status">
        <p className="dealTitle">Deal the {awaiting}</p>
        <p>{DEAL_HOW[awaiting]}</p>
        {canDeal ? (
          <button className="btn green" disabled={busy || !act} onClick={() => act?.({ type: 'dealt' })}>
            {awaiting[0].toUpperCase() + awaiting.slice(1)} is out
          </button>
        ) : (
          <p className="dim">
            Waiting for {dealer?.name ?? 'the dealer'} to deal the {awaiting}
          </p>
        )}
      </div>
    );
  } else {
    centre = (
      <>
        {cardsMode ? (
          <div className="tvBoard" role="group" aria-label="Board">
            {SLOT_STREET.map((_, i) => (
              <CardSlot key={i} card={board[i]} win={board[i] ? winning.has(board[i]) : false} />
            ))}
          </div>
        ) : (
          <div className="tvBoard" aria-label={dealt ? `Board: ${SLOT_STREET[dealt - 1].toLowerCase()} dealt` : 'Board'}>
            {SLOT_STREET.map((street, i) => (
              <CardSlot key={i} label={i < dealt ? street : undefined} />
            ))}
          </div>
        )}
        <div className="tvPot" aria-live="polite">
          {middle > 0 && <ChipStack amount={middle} scale={2} maxColumns={3} maxPerColumn={6} />}
          <p className="tvPotAmount">{chips(shownPot)}</p>
          <p className="tvPotLine">{party.phase === 'showdown' ? 'Showdown' : potLine}</p>
          {sidePots.length > 1 && (
            <p className="tvSidePots">
              {sidePots.map((pot, i) => (
                <span key={i}>
                  {i === 0 ? 'Main' : `Side ${i}`} {chips(pot.amount)}
                </span>
              ))}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
    <div className="tv" data-turns={turns} data-crowd={n >= 7} data-cards={cardsMode}>
      <div className="tvFelt" aria-hidden="true" />
      <div className="tvCentre">{centre}</div>
      {party.players.map((p, i) => (
        <BetChips key={p.id} amount={inFront(party, p)} style={place(i)} />
      ))}
      <ul className="tvSeats" aria-label="Players">
        {party.players.map((p, i) => (
          <Seat
            key={p.id}
            p={p}
            party={party}
            isMe={p.id === meId}
            style={place(i)}
            faceUp={faceUp(p)}
            winning={winning}
            won={winners.some((r) => r.id === p.id)}
          />
        ))}
      </ul>
    </div>
    {myHand && (
      <p className="myHand" aria-live="polite">
        You have: <b>{myHand}</b>
      </p>
    )}
    </>
  );
}
