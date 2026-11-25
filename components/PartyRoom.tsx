'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import ActionDock from './ActionDock';
import AwardDialog from './AwardDialog';
import Ledger from './Ledger';
import { ChipFace, Speaker } from './Pixels';
import { InviteDialog, TableMenu } from './TableMenu';
import TableView from './TableView';
import { api, blip, chips, loadMuted, loadName, loadSeat, saveMuted, saveName, saveSeat, useParty, type Seat } from '@/lib/client';
import { NAME_MAX, eligibleWinners, legalActions, tableLine, usesTurns } from '@/lib/game';
import type { Action, Party } from '@/lib/types';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };

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
  const full = party.players.length >= party.settings.maxPlayers;

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
  const [seat, setSeat] = useState<Seat | null>(null);
  const { party, myCards, sync, needsDatabase, apply, send } = useParty(code, seat);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'table' | 'log'>('table');
  const [dialog, setDialog] = useState<null | 'invite' | 'menu' | 'award'>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
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
    setMuted(loadMuted());
    setReady(true);
    return () => clearTimeout(toastTimer.current);
  }, [code]);

  const act = useCallback(
    async (action: Action): Promise<boolean> => {
      if (!seat) return false;
      setBusy(true);
      const res = await send(seat, action);
      setBusy(false);
      if (res.party) return true;
      notify(res.error ?? 'Try again.', 'error');
      return false;
    },
    [notify, send, seat],
  );

  // Serverless means no background timers: once a turn's time is up, every seated player's
  // browser asks the server once to apply the timeout. The server ignores it if time is left.
  const deadline = party?.phase === 'live' ? party.turnDeadline : null;
  const sentFor = useRef<number | null>(null);
  useEffect(() => {
    if (!seat || !deadline || sentFor.current === deadline) return;
    const t = setTimeout(async () => {
      sentFor.current = deadline;
      await send(seat, { type: 'timeout' });
    }, Math.max(0, deadline + 750 - Date.now()));
    return () => clearTimeout(t);
  }, [deadline, seat, send]);

  // Computer players move when a human's browser asks, once their "thinking" time is up.
  // Sent once per thinking deadline; several browsers sending at once is fine (only one move applies).
  const botActAt = party?.phase === 'live' ? party.botActAt : null;
  const botSentFor = useRef<number | null>(null);
  useEffect(() => {
    if (!seat || !botActAt || botSentFor.current === botActAt) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = async () => {
      botSentFor.current = botActAt;
      const res = await send(seat, { type: 'bot_step' });
      // Our clock may be a little ahead of the server's: try again shortly, a couple of times.
      if (!res.party && res.status === 400 && ++tries < 3) t = setTimeout(step, 700);
    };
    t = setTimeout(step, Math.max(0, botActAt + 100 - Date.now()));
    return () => clearTimeout(t);
  }, [botActAt, seat, send]);

  // Auto-deal (one human at a card table): the host's browser starts the next hand when it's due.
  const nextHandAt = party?.phase === 'idle' && party.hostId === seat?.playerId ? party.nextHandAt : null;
  const dealtFor = useRef<number | null>(null);
  useEffect(() => {
    if (!nextHandAt || dealtFor.current === nextHandAt) return;
    const t = setTimeout(() => {
      dealtFor.current = nextHandAt;
      void act({ type: 'start_hand' });
    }, Math.max(0, nextHandAt - Date.now()));
    return () => clearTimeout(t);
  }, [act, nextHandAt]);

  // When it becomes my turn: buzz, blip and flag the tab title.
  const myTurn = Boolean(party && seat && legalActions(party, seat.playerId).fold);
  useEffect(() => {
    const base = `Table ${code} | Pixel Pot`;
    if (!myTurn) {
      document.title = base;
      return;
    }
    document.title = '● Your turn · Pixel Pot';
    navigator.vibrate?.(80);
    if (!mutedRef.current) blip();
    // Phones: bring my seat, cards and the dock into view (the dock is sticky, so the bottom shows them all).
    if (window.matchMedia('(max-width: 899px)').matches) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
    return () => {
      document.title = base;
    };
  }, [code, myTurn]);

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
  const playing = party.phase !== 'idle';
  const lobby = !playing && party.handNo === 0;
  const feed = party.feed.slice(-3).reverse();

  // The banner says whose turn it is. Free-play tables have no turns, so no banner.
  let banner: { text: string; mine: boolean } | null = null;
  if (usesTurns(party) && party.phase === 'live') {
    const dealer = party.players.find((p) => p.id === party.dealerId);
    const acting = party.players.find((p) => p.id === party.toActId);
    if (party.awaitingDeal) {
      const mine = Boolean(me && (me.id === party.dealerId || isHost));
      banner = { mine, text: mine ? `Deal the ${party.awaitingDeal}` : `Waiting for ${dealer?.name ?? 'the dealer'} to deal the ${party.awaitingDeal}…` };
    } else if (myTurn) banner = { mine: true, text: 'Your turn' };
    else if (acting) banner = { mine: false, text: `Waiting for ${acting.name}…` };
  } else if (usesTurns(party) && party.phase === 'showdown') {
    banner = { mine: isHost, text: isHost ? 'Showdown: award the pot' : `Showdown · ${host?.name ?? 'the host'} awards the pot` };
  }
  // Card mode works out the winner itself, so the host never awards by hand.
  const showAward = party.settings.mode !== 'cards' && isHost && (party.phase === 'showdown' || (dialog === 'award' && playing));

  return (
    <div className="room" data-tab={tab}>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Pixel Pot home">
          <ChipFace size={24} />
          <span>Pixel Pot</span>
        </Link>
        <span className="syncDot" data-sync={sync} role="status" aria-label={sync === 'offline' ? 'Reconnecting' : 'Live'} />
        <button
          className="btn small quiet muteBtn"
          aria-pressed={muted}
          aria-label="Mute turn sound"
          title={muted ? 'Turn sound on' : 'Turn sound off'}
          onClick={() => {
            saveMuted(!muted);
            setMuted(!muted);
          }}
        >
          <Speaker muted={muted} />
        </button>
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
          {banner && (
            <p className="turnBanner" data-mine={banner.mine} role="status" aria-live="polite">
              {banner.text}
            </p>
          )}
          <div className="feltHead">
            <span>{playing ? `Hand ${party.handNo}` : lobby ? 'Lobby' : `After hand ${party.handNo}`}</span>
            <span className="feltGame">
              {tableLine(party.settings)
                .split(' · ')
                .map((part) => (
                  <span key={part}>{part}</span>
                ))}
            </span>
          </div>

          <TableView
            party={party}
            meId={me?.id ?? null}
            myCards={me ? myCards : null}
            busy={busy}
            act={me ? act : undefined}
            lobby={
              <div className="lobby">
                <p className="potLabel">Table code</p>
                <p className="lobbyCode" aria-label={code.split('').join(' ')}>
                  {code}
                </p>
                <p style={{ maxWidth: '24ch' }}>
                  {!isHost
                    ? `${host?.name ?? 'The host'} starts when everyone is in.`
                    : party.players.length > 1 && party.players.every((p) => p.bot || p.id === party.hostId)
                      ? 'Your AI opponents are ready. Start when you are.'
                      : 'Start the first hand when everyone has sat down.'}
                </p>
                <button className="btn small" onClick={() => setDialog('invite')}>
                  Invite players
                </button>
              </div>
            }
          />

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
