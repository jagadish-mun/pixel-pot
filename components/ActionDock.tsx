'use client';

import { useEffect, useState } from 'react';
import { ChipFace } from './Pixels';
import { CHIP_VALUES } from '@/lib/chips';
import { chips } from '@/lib/client';
import { awardingSidePot, highBet, legalActions, potOf, usesTurns } from '@/lib/game';
import type { Action, Party, Player } from '@/lib/types';

/** Four chip sizes that suit this table's blinds. */
function chipChoices(party: Party): number[] {
  const unit = party.settings.smallBlind || party.settings.bigBlind || 5;
  // Smallest first, starting at the biggest chip that fits the blind (four of the five chips).
  const up = [...CHIP_VALUES].reverse();
  let start = 0;
  up.forEach((v, i) => {
    if (v <= unit) start = i;
  });
  return up.slice(Math.min(start, up.length - 4), Math.min(start, up.length - 4) + 4);
}

type DockProps = {
  party: Party;
  me: Player;
  isHost: boolean;
  busy: boolean;
  act: (action: Action) => Promise<boolean>;
  onAward: () => void;
};

/** The chip buttons plus a number box, adding to `value` (capped at `max`). */
function ChipPicker({ party, value, max, onChange, label }: { party: Party; value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="chipRow">
      {chipChoices(party).map((v) => (
        <button
          key={v}
          className="chipBtn"
          disabled={value + v > max}
          onClick={() => onChange(Math.min(max, value + v))}
          aria-label={`Add ${chips(v)} to your bet`}
        >
          <ChipFace value={v} size={36} />
          <span>+{v}</span>
        </button>
      ))}
      <label className="betField">
        <span className="sr">{label}</span>
        <input
          className="input num"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="0"
          value={value === 0 ? '' : String(value)}
          onChange={(e) => onChange(Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0))}
        />
      </label>
    </div>
  );
}

export default function ActionDock(props: DockProps) {
  const { party, me, isHost, busy, act } = props;
  const host = party.players.find((p) => p.id === party.hostId);
  const [mucked, setMucked] = useState(0);

  if (party.phase === 'idle') {
    const ready = party.players.filter((p) => p.stack > 0).length >= 2;
    const nextHand = party.handNo + 1;
    // Card mode: I won without a showdown, so I may show my cards or muck them.
    const mayShow = party.canShow === me.id && mucked !== party.handNo;
    return (
      <div className="dock">
        {mayShow && (
          <div className="dockInfo">
            <span>You won without a showdown.</span>
            <span className="row">
              <button className="btn small" disabled={busy} onClick={() => act({ type: 'show' })}>
                Show cards
              </button>
              <button className="btn small quiet" onClick={() => setMucked(party.handNo)}>
                Muck
              </button>
            </span>
          </div>
        )}
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
              <button className="btn gold wide" disabled={busy || !ready} onClick={() => act({ type: 'start_hand' })}>
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

  return usesTurns(party) ? <TurnDock {...props} /> : <FreeDock {...props} />;
}

function HostRow({ party, busy, onAward }: { party: Party; busy: boolean; onAward: () => void }) {
  const pot = potOf(party);
  return (
    <div className="hostRow">
      <button className="btn gold wide" disabled={busy} onClick={onAward}>
        {awardingSidePot(party) ? `Award side pot ${chips(pot)}` : `Award pot ${chips(pot)}`}
      </button>
    </div>
  );
}

/* ================================ free play ================================ */

/** Tables without turn order: anyone bets any time, exactly as before. */
function FreeDock({ party, me, isHost, busy, act, onAward }: DockProps) {
  const [amount, setAmount] = useState(0);
  const host = party.players.find((p) => p.id === party.hostId);
  const hostRow = isHost && <HostRow party={party} busy={busy} onAward={onAward} />;

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

  const toCall = Math.min(me.stack, Math.max(0, highBet(party) - me.bet));
  const bet = Math.min(amount, me.stack);
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
                onClick={() => setAmount((a) => Math.min(me.stack, a + v))}
                aria-label={`Add ${chips(v)} to your bet`}
              >
                <ChipFace value={v} size={36} />
                <span>+{v}</span>
              </button>
            ))}
            <button className="chipBtn" disabled={all(bet)} onClick={() => setAmount(me.stack)} aria-label="Bet your whole stack">
              <ChipFace value={500} size={36} />
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

/* ================================ turn based =============================== */

type PreAction = { kind: 'checkFold' | 'callAny'; street: string; hand: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Tables with turn order: everything comes from legalActions. */
function TurnDock({ party, me, isHost, busy, act, onAward }: DockProps) {
  const legal = legalActions(party, me.id);
  const myTurn = legal.fold;
  const high = Math.max(...party.players.map((p) => p.roundBet));
  const facing = Math.max(0, high - me.roundBet);
  const canUndo = party.undoSnapshot?.by === me.id;
  const [pre, setPre] = useState<PreAction | null>(null);

  // Pre-actions fire when my turn comes, and are dropped when the street or hand moves on.
  // A bet doesn't drop them: Check/Fold then folds, and Call any calls whatever it is.
  useEffect(() => {
    if (!pre) return;
    if (party.street !== pre.street || party.handNo !== pre.hand) {
      setPre(null);
      return;
    }
    if (!myTurn) return;
    setPre(null);
    let action: Action | null = null;
    if (pre.kind === 'checkFold') action = legal.check ? { type: 'check' } : { type: 'fold' };
    else if (legal.call !== null) action = { type: 'call' };
    else if (legal.check) action = { type: 'check' };
    if (action) void act(action);
  }, [act, legal.call, legal.check, myTurn, party.handNo, party.street, pre]);

  // At showdown the host gets the big award button; mid-hand it's a small override link,
  // so the dock doesn't cover the table on a phone.
  const hostRow =
    isHost &&
    party.settings.mode !== 'cards' &&
    (party.phase === 'showdown' ? (
      <HostRow party={party} busy={busy} onAward={onAward} />
    ) : (
      <div className="hostLink">
        <button className="linkish" disabled={busy} onClick={onAward}>
          Award the pot now
        </button>
      </div>
    ));
  const undo = canUndo && (
    <button className="linkish" disabled={busy} onClick={() => act({ type: 'undo' })}>
      Take back
    </button>
  );
  const acting = party.players.find((p) => p.id === party.toActId);

  if (myTurn) {
    return (
      <div className="dock" data-myturn="true">
        <MyTurn key={`${party.handNo}-${party.street}-${party.version}`} party={party} me={me} busy={busy} act={act} />
        {hostRow}
      </div>
    );
  }

  let line: string;
  if (party.phase === 'showdown') line = `${party.players.find((p) => p.id === party.hostId)?.name ?? 'The host'} is awarding the pot.`;
  else if (!me.inHand) line = me.stack === 0 ? "You're out of chips this hand." : "You'll be dealt in next hand.";
  else if (me.folded) line = 'You folded this hand.';
  else if (me.stack === 0) line = "You're all in.";
  else if (party.awaitingDeal) line = `The ${party.awaitingDeal} is being dealt.`;
  else line = acting ? `Waiting for ${acting.name}…` : 'Waiting…';

  const canPre = party.phase === 'live' && me.inHand && !me.folded && me.stack > 0;
  const toggle = (kind: PreAction['kind']) =>
    setPre(pre?.kind === kind ? null : { kind, street: party.street, hand: party.handNo });

  return (
    <div className="dock">
      <div className="dockInfo">
        <span>
          {line}
          {canPre && facing > 0 && (
            <>
              {' '}
              <strong>{chips(Math.min(facing, me.stack))}</strong> to call
            </>
          )}
        </span>
        {undo}
      </div>
      {canPre && (
        <div className="preActions">
          <label className="preCheck">
            <input type="checkbox" checked={pre?.kind === 'checkFold'} onChange={() => toggle('checkFold')} />
            <span>Check/Fold</span>
          </label>
          <label className="preCheck">
            <input type="checkbox" checked={pre?.kind === 'callAny'} onChange={() => toggle('callAny')} />
            <span>Call any</span>
          </label>
        </div>
      )}
      {hostRow}
    </div>
  );
}

/** The controls on my turn. Keyed per turn, so the bet size resets each time. */
function MyTurn({ party, me, busy, act }: { party: Party; me: Player; busy: boolean; act: (action: Action) => Promise<boolean> }) {
  const legal = legalActions(party, me.id);
  const high = Math.max(...party.players.map((p) => p.roundBet));
  const facing = Math.max(0, high - me.roundBet);
  const range = legal.bet ?? legal.raise;
  const allInTo = me.roundBet + me.stack;
  const [raw, setRaw] = useState<number | null>(null);
  // Sizing a bet opens a second step, so the everyday dock stays one row high.
  const [sizing, setSizing] = useState(false);
  const target = range ? (raw ?? range.min) : 0;
  const valid = range !== null && target >= range.min && target <= range.max;
  const canUndo = party.undoSnapshot?.by === me.id;

  // Presets are fractions of the pot after calling, kept inside the legal range.
  const potAfterCall = potOf(party) + facing;
  const presets: [string, number][] = range
    ? [
        ['Min', range.min],
        ['½ pot', clamp(Math.round(high + potAfterCall / 2), range.min, range.max)],
        ['¾ pot', clamp(Math.round(high + (potAfterCall * 3) / 4), range.min, range.max)],
        ['Pot', clamp(high + potAfterCall, range.min, range.max)],
        ...(range.max === allInTo ? ([['All in', allInTo]] as [string, number][]) : []),
      ]
    : [];

  const betAction = (to: number): Action => {
    if (to === allInTo && legal.allin !== null) return { type: 'allin' };
    return legal.bet ? { type: 'bet', amount: to } : { type: 'raise', to };
  };
  const verb = legal.bet ? 'Bet' : 'Raise to';
  // A short all-in (less than a full raise) is the only way to put more in.
  const shortAllIn = !range && legal.allin !== null && legal.allin > high && legal.call !== legal.allin - me.roundBet;

  return (
    <>
      <div className="dockInfo">
        <span className="dockTurn">
          Your turn
          {facing > 0 && (
            <>
              {' · '}
              <strong>{chips(Math.min(facing, me.stack))}</strong> to call
            </>
          )}
        </span>
        {canUndo && (
          <button className="linkish" disabled={busy} onClick={() => act({ type: 'undo' })}>
            Take back
          </button>
        )}
      </div>

      {sizing && range ? (
        <>
          <div className="betPresets">
            {presets.map(([name, to]) => (
              <button key={name} className="btn small quiet" data-pressed={target === to} aria-pressed={target === to} onClick={() => setRaw(to)}>
                {name}
              </button>
            ))}
          </div>
          <label className="slider">
            <span className="sr">{verb}</span>
            <input type="range" min={range.min} max={range.max} step={1} value={target} onChange={(e) => setRaw(Number(e.target.value))} />
          </label>
          <ChipPicker party={party} value={target} max={range.max} onChange={(n) => setRaw(n)} label={`${verb} amount`} />
          <div className="row">
            <button className="btn quiet wide stacked" style={{ flexGrow: 0.6 }} disabled={busy} onClick={() => setSizing(false)}>
              Back
            </button>
            <button
              className="btn gold wide stacked"
              disabled={busy || !valid}
              onClick={() => act(betAction(target))}
              aria-label={`${target === allInTo ? 'All in' : verb} ${chips(target)}`}
            >
              <span>{target === allInTo ? 'All in' : verb}</span>
              <span>{chips(target)}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button className="btn red wide stacked" style={{ flexGrow: 0.8 }} disabled={busy} onClick={() => act({ type: 'fold' })}>
            Fold
          </button>
          {legal.check ? (
            <button className="btn green wide stacked" disabled={busy} onClick={() => act({ type: 'check' })}>
              Check
            </button>
          ) : (
            legal.call !== null && (
              <button
                className="btn green wide stacked"
                disabled={busy}
                onClick={() => act({ type: 'call' })}
                aria-label={`${legal.call === me.stack ? 'All in' : 'Call'} ${chips(legal.call)}`}
              >
                <span>{legal.call === me.stack ? 'All in' : 'Call'}</span>
                <span>{chips(legal.call)}</span>
              </button>
            )
          )}
          {range &&
            (range.min === range.max ? (
              // Fixed size (limit betting, or only one legal amount): one tap.
              <button className="btn gold wide stacked" disabled={busy} onClick={() => act(betAction(range.min))}>
                <span>{range.min === allInTo ? 'All in' : verb}</span>
                <span>{chips(range.min)}</span>
              </button>
            ) : (
              <button className="btn gold wide stacked" disabled={busy} onClick={() => setSizing(true)} aria-label={`${legal.bet ? 'Bet' : 'Raise'}: choose an amount`}>
                <span>{legal.bet ? 'Bet' : 'Raise'}</span>
                <span className="dockSub">{chips(range.min)}+</span>
              </button>
            ))}
          {shortAllIn && (
            <button className="btn gold wide stacked" disabled={busy} onClick={() => act({ type: 'allin' })}>
              <span>All in</span>
              <span>{chips(legal.allin!)}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
