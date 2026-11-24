'use client';

import { useState } from 'react';
import { ChipFace } from './Pixels';
import { chips } from '@/lib/client';
import { highBet, potOf } from '@/lib/game';
import type { Action, Party, Player } from '@/lib/types';

const CHIP_VALUES = [1, 5, 25, 100, 500, 1000, 5000, 25000];

/** Four chip sizes that suit this table's blinds. */
function chipChoices(party: Party): number[] {
  const unit = party.settings.smallBlind || party.settings.bigBlind || 5;
  let start = 0;
  CHIP_VALUES.forEach((v, i) => {
    if (v <= unit) start = i;
  });
  return CHIP_VALUES.slice(start, start + 4);
}

export default function ActionDock({
  party,
  me,
  isHost,
  busy,
  act,
  onAward,
}: {
  party: Party;
  me: Player;
  isHost: boolean;
  busy: boolean;
  act: (action: Action) => Promise<boolean>;
  onAward: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const host = party.players.find((p) => p.id === party.hostId);
  const pot = potOf(party);
  const nextHand = party.handNo + 1;

  /* ----- between hands ----- */
  if (party.phase === 'idle') {
    const ready = party.players.filter((p) => p.stack > 0).length >= 2;
    return (
      <div className="dock">
        {isHost ? (
          <>
            {!ready && (
              <p className="waiting dim">
                {party.players.length < 2
                  ? 'Share the table code. You can start once a second player sits down.'
                  : 'At least two players need chips to start a hand.'}
              </p>
            )}
            <div className="row">
              <button
                className="btn gold wide"
                disabled={busy || !ready}
                onClick={() => act({ type: 'start_hand' })}
              >
                Start hand {nextHand}
              </button>
            </div>
          </>
        ) : (
          <p className="waiting">
            {me.stack === 0
              ? `You're out of chips. Ask ${host?.name ?? 'the host'} for a rebuy.`
              : `Waiting for ${host?.name ?? 'the host'} to start hand ${nextHand}.`}
          </p>
        )}
      </div>
    );
  }

  const hostRow = isHost && (
    <div className="hostRow">
      <button className="btn gold wide" disabled={busy} onClick={onAward}>
        {party.phase === 'showdown' ? `Award side pot ${chips(pot)}` : `Award pot ${chips(pot)}`}
      </button>
    </div>
  );

  /* ----- showdown, sitting out, folded ----- */
  if (party.phase === 'showdown' || !me.inHand || me.folded) {
    let line: string;
    if (party.phase === 'showdown') line = `${host?.name ?? 'The host'} is awarding the pot.`;
    else if (!me.inHand) line = me.stack === 0 ? "You're out of chips this hand." : "You'll be dealt in next hand.";
    else line = 'You folded this hand.';
    return (
      <div className="dock">
        <div className="dockInfo">
          <span>{line}</span>
          {party.phase === 'live' && me.folded && (
            <button className="linkish" disabled={busy} onClick={() => act({ type: 'undo' })}>
              Take back fold
            </button>
          )}
        </div>
        {hostRow}
      </div>
    );
  }

  /* ----- betting ----- */
  const toCall = Math.min(me.stack, Math.max(0, highBet(party) - me.bet));
  const bet = Math.min(amount, me.stack);
  const add = (v: number) => setAmount((a) => Math.min(me.stack, a + v));
  const send = async (action: Action) => {
    if (await act(action)) setAmount(0);
  };

  const all = (n: number) => n === me.stack;

  return (
    <div className="dock">
      <div className="dockInfo">
        {me.stack === 0 ? (
          <span>You&apos;re all in.</span>
        ) : toCall > 0 ? (
          <span>
            <strong>{chips(toCall)}</strong> to call
          </span>
        ) : (
          <span>{me.bet > 0 ? `You have ${chips(me.bet)} in the pot.` : 'Nothing to call.'}</span>
        )}
        {me.undo.length > 0 && (
          <button className="linkish" disabled={busy} onClick={() => act({ type: 'undo' })}>
            Take back last move
          </button>
        )}
      </div>

      {me.stack > 0 && (
        <>
          <div className="chipRow">
            {chipChoices(party).map((v) => (
              <button
                key={v}
                className="chipBtn"
                disabled={bet + v > me.stack}
                onClick={() => add(v)}
                aria-label={`Add ${chips(v)} to your bet`}
              >
                <ChipFace value={v} size={36} />
                <span>+{v >= 1000 ? `${v / 1000}K` : v}</span>
              </button>
            ))}
            <button className="chipBtn" disabled={all(bet)} onClick={() => setAmount(me.stack)} aria-label="Bet your whole stack">
              <ChipFace value={1000} size={36} />
              <span>Max</span>
            </button>
            <label className="betField">
              <span className="sr">Bet amount</span>
              <input
                className="input num"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={bet === 0 ? '' : String(bet)}
                onChange={(e) => setAmount(Math.min(me.stack, Number(e.target.value.replace(/\D/g, '')) || 0))}
              />
            </label>
            <button
              className="closeX"
              style={{ visibility: bet > 0 ? 'visible' : 'hidden' }}
              onClick={() => setAmount(0)}
              aria-label="Clear bet amount"
            >
              X
            </button>
          </div>
          <div className="row">
            <button className="btn red wide stacked" style={{ flexGrow: 0.8 }} disabled={busy} onClick={() => send({ type: 'fold' })}>
              Fold
            </button>
            <button
              className="btn green wide stacked"
              aria-label={toCall === 0 ? 'Check' : `${all(toCall) ? 'All in' : 'Call'} ${chips(toCall)}`}
              disabled={busy}
              onClick={() => send({ type: 'call' })}
            >
              {toCall === 0 ? (
                'Check'
              ) : (
                <>
                  <span>{all(toCall) ? 'All in' : 'Call'}</span>
                  <span>{chips(toCall)}</span>
                </>
              )}
            </button>
            <button
              className="btn gold wide stacked"
              aria-label={bet === 0 ? 'Bet' : `${all(bet) ? 'All in' : 'Bet'} ${chips(bet)}`}
              disabled={busy || bet === 0}
              onClick={() => send({ type: 'bet', amount: bet })}
            >
              <span>{bet > 0 && all(bet) ? 'All in' : 'Bet'}</span>
              {bet > 0 && <span>{chips(bet)}</span>}
            </button>
          </div>
        </>
      )}
      {hostRow}
    </div>
  );
}
