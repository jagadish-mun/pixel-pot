'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import ActionDock from './ActionDock';
import AwardDialog from './AwardDialog';
import Ledger from './Ledger';
import { ChipFace, ChipStack, Face } from './Pixels';
import { InviteDialog, TableMenu } from './TableMenu';
import { api, chips, loadName, loadSeat, saveName, saveSeat, sendAction, signed, useParty, type Seat } from '@/lib/client';
import { MAX_PLAYERS, NAME_MAX, eligibleWinners, potOf } from '@/lib/game';
import type { Action, Party, Player } from '@/lib/types';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };

function SeatCard({ p, party, isMe }: { p: Player; party: Party; isMe: boolean }) {
  const playing = party.phase !== 'idle';
  const out = playing ? !p.inHand || p.folded : p.stack === 0;
  let foot: React.ReactNode = null;
  if (playing) {
    if (!p.inHand) foot = <span className="dim">{p.stack === 0 ? 'Out of chips' : 'In next hand'}</span>;
    else if (p.folded) foot = <span className="tag folded">Folded</span>;
    else
      foot = (
        <>
          {p.stack === 0 && <span className="tag allin">All in</span>}
          {p.bet > 0 ? <span>{chips(p.bet)} in</span> : <span className="dim">Yet to bet</span>}
        </>
      );
  } else if (p.stack === 0) {
    foot = <span className="dim">Out of chips</span>;
  } else if (p.lastDelta !== null && party.handNo > 0) {
    foot = (
      <span className={p.lastDelta > 0 ? 'up' : p.lastDelta < 0 ? 'down' : 'dim'}>
        {p.lastDelta === 0 ? 'Even' : signed(p.lastDelta)} last hand
      </span>
    );
  }
  return (
    <li className="seat" data-me={isMe} data-out={out}>
      <Face seed={p.id + p.name} size={32} />
      <div style={{ minWidth: 0 }}>
        <div className="seatName">
          <span>{p.name}</span>
          {playing && party.dealerId === p.id && (
            <span className="tag dealer" title="Dealer button">
              D
            </span>
          )}
          {playing && party.sbId === p.id && (
            <span className="tag blind" title="Small blind">
              SB
            </span>
          )}
          {playing && party.bbId === p.id && (
            <span className="tag blind" title="Big blind">
              BB
            </span>
          )}
        </div>
        <div className="seatStack">{chips(p.stack)}</div>
      </div>
      <div className="seatFoot">
        <span className="seatStatus">{foot}</span>
        {playing && <ChipStack amount={p.bet} scale={2} maxColumns={3} maxPerColumn={4} />}
      </div>
    </li>
  );
}

function JoinDock({
  party,
  onJoined,
  notify,
}: {
  party: Party;
  onJoined: (seat: Seat, party: Party) => void;
  notify: (text: string, kind?: 'ok' | 'error') => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(loadName()), []);
  const full = party.players.length >= MAX_PLAYERS;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api(`/api/party/${party.code}/join`, { name });
    setBusy(false);
    if (res.party && res.playerId && res.token) {
      saveName(name.trim());
      onJoined({ playerId: res.playerId, token: res.token }, res.party);
    } else notify(res.error ?? 'Try again.', 'error');
  };

  if (full) {
    return (
      <div className="dock">
        <p className="waiting">This table is full. You can still watch the chips from here.</p>
      </div>
    );
  }
  return (
    <form className="dock" onSubmit={join}>
      <label className="field">
        <span>
          Your name, to sit down with {chips(party.settings.startingChips)} chips
          {party.phase !== 'idle' && '. You’ll be dealt in next hand'}
        </span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          required
        />
      </label>
      <div className="row">
        <button className="btn gold wide" disabled={busy}>
          {busy ? 'Sitting down…' : 'Sit down'}
        </button>
      </div>
    </form>
  );
}

export default function PartyRoom({ code }: { code: string }) {
  const { party, sync, needsDatabase, apply } = useParty(code);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'table' | 'log'>('table');
  const [dialog, setDialog] = useState<null | 'invite' | 'menu' | 'award'>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, kind });
    toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 4200 : 2400);
  }, []);

  useEffect(() => {
    // A "move my seat" link carries the seat key after the #, which never reaches the server.
    const moved = window.location.hash.match(/^#seat=([a-f0-9]+)\.([\w-]+)$/);
    if (moved) {
      saveSeat(code, { playerId: moved[1], token: moved[2] });
      window.history.replaceState(null, '', window.location.pathname);
    }
    setSeat(loadSeat(code));
    setReady(true);
    return () => clearTimeout(toastTimer.current);
  }, [code]);

  const act = useCallback(
    async (action: Action): Promise<boolean> => {
      if (!seat) return false;
      setBusy(true);
      const res = await sendAction(code, seat, action);
      setBusy(false);
      if (res.party) {
        apply(res.party);
        return true;
      }
      notify(res.error ?? 'Try again.', 'error');
      return false;
    },
    [apply, code, notify, seat],
  );

  if (sync === 'missing') {
    return (
      <main className="center">
        <ChipFace size={64} />
        <h1 className="display" style={{ fontSize: 16 }}>
          No table called {code || 'that'}
        </h1>
        <p>The code may be mistyped, or the table closed after three days without a hand.</p>
        <Link className="btn gold" href="/">
          Host or join a table
        </Link>
      </main>
    );
  }

  if (!party || !ready) {
    return (
      <main className="center">
        <ChipFace size={64} />
        <p className="display" style={{ fontSize: 12 }}>
          {sync === 'offline' ? "Can't reach the table. Retrying…" : 'Finding your table…'}
        </p>
      </main>
    );
  }

  const me = party.players.find((p) => p.id === seat?.playerId) ?? null;
  const isHost = Boolean(me && me.id === party.hostId);
  const host = party.players.find((p) => p.id === party.hostId);
  const pot = potOf(party);
  const playing = party.phase !== 'idle';
  const lobby = !playing && party.handNo === 0;
  const feed = party.feed.slice(-3).reverse();
  const { smallBlind, bigBlind } = party.settings;
  // Between hands the felt shows how the last hand ended.
  const lastHand = [...party.log].reverse().find((e) => e.kind === 'hand');
  const shownPot = playing ? pot : lastHand?.kind === 'hand' ? lastHand.pot : 0;
  let lastResult = 'Deal the next hand';
  if (!playing && lastHand?.kind === 'hand') {
    const names = lastHand.rows.filter((r) => lastHand.winners.includes(r.id)).map((r) => r.name);
    if (names.length === 1) lastResult = `went to ${names[0]}`;
    else if (names.length > 1) lastResult = `went to ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    else lastResult = 'pot last hand';
  }
  const showAward = isHost && (party.phase === 'showdown' || (dialog === 'award' && playing));

  return (
    <div className="room" data-tab={tab}>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Pixel Pot home">
          <ChipFace size={24} />
          <span>Pixel Pot</span>
        </Link>
        <span className="syncDot" data-sync={sync} role="status" aria-label={sync === 'offline' ? 'Reconnecting' : 'Live'} />
        <button className="btn small quiet codeTag" onClick={() => setDialog('invite')} aria-label={`Table code ${code}. Invite players`}>
          <b>{code}</b>
        </button>
        <button className="btn small quiet" onClick={() => setDialog('menu')}>
          Menu
        </button>
      </header>

      {needsDatabase && (
        <p className="banner" role="alert">
          This site has no database connected yet, so tables won&apos;t stay in sync between players. The site owner
          needs to connect Upstash Redis in Vercel (see the README).
        </p>
      )}

      <nav className="tabs" aria-label="View">
        <button className="btn small quiet" data-pressed={tab === 'table'} aria-pressed={tab === 'table'} onClick={() => setTab('table')}>
          Table
        </button>
        <button className="btn small quiet" data-pressed={tab === 'log'} aria-pressed={tab === 'log'} onClick={() => setTab('log')}>
          Hand log
        </button>
      </nav>

      <main className="panes">
        <section className="tablePane" aria-label="Table">
          <div className="felt">
            <div className="feltHead">
              <span>{playing ? `Hand ${party.handNo}` : lobby ? 'Lobby' : `After hand ${party.handNo}`}</span>
              <span>{bigBlind > 0 ? `Blinds ${chips(smallBlind)}/${chips(bigBlind)}` : 'No blinds'}</span>
            </div>

            {lobby ? (
              <div className="lobby">
                <p className="potLabel">Table code</p>
                <p className="lobbyCode" aria-label={code.split('').join(' ')}>
                  {code}
                </p>
                <p style={{ maxWidth: '32ch' }}>
                  {isHost
                    ? 'Read the code out, or send the link. Start the first hand when everyone has sat down.'
                    : `${host?.name ?? 'The host'} starts the first hand when everyone has sat down.`}
                </p>
                <button className="btn small" onClick={() => setDialog('invite')}>
                  Invite players
                </button>
              </div>
            ) : (
              <div className="pot" aria-live="polite">
                {playing && (
                  <div className="potPile">
                    <ChipStack amount={pot} scale={3} maxColumns={4} maxPerColumn={8} />
                  </div>
                )}
                <div className="potText">
                  <p className="potAmount" key={shownPot} data-bump={playing && pot > 0}>
                    {chips(shownPot)}
                  </p>
                  <p className="potLabel">
                    {party.phase === 'showdown' ? 'left in the side pot' : playing ? 'in the pot' : lastResult}
                  </p>
                </div>
              </div>
            )}

            <ul className="seats">
              {party.players.map((p) => (
                <SeatCard key={p.id} p={p} party={party} isMe={p.id === me?.id} />
              ))}
            </ul>
          </div>

          <ol className="feed" aria-label="Latest moves">
            {feed.map((f) => (
              <li key={f.id} data-kind={f.kind}>
                {f.text}
              </li>
            ))}
          </ol>

          {me ? (
            <ActionDock party={party} me={me} isHost={isHost} busy={busy} act={act} onAward={() => setDialog('award')} />
          ) : (
            <JoinDock
              party={party}
              notify={notify}
              onJoined={(s, p) => {
                saveSeat(code, s);
                setSeat(s);
                apply(p);
              }}
            />
          )}
        </section>

        <section className="logPane" aria-label="Hand log">
          <Ledger party={party} meId={me?.id} />
        </section>
      </main>

      {showAward && (
        <AwardDialog
          key={`${party.phase}:${eligibleWinners(party)
            .map((p) => p.id)
            .join(',')}`}
          party={party}
          busy={busy}
          act={act}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'invite' && <InviteDialog code={code} notify={notify} onClose={() => setDialog(null)} />}
      {dialog === 'menu' && (
        <TableMenu
          party={party}
          seat={me ? seat : null}
          isHost={isHost}
          busy={busy}
          act={act}
          notify={notify}
          onInvite={() => setDialog('invite')}
          onClose={() => setDialog(null)}
        />
      )}
      {toast && (
        <div className="toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
