'use client';

import { useState, type FormEvent } from 'react';
import Dialog from './Dialog';
import { Face } from './Pixels';
import { chips, copyText, type Seat } from '@/lib/client';
import type { Action, Party, Player } from '@/lib/types';

export function InviteDialog({
  code,
  notify,
  onClose,
}: {
  code: string;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  onClose: () => void;
}) {
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/p/${code}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Dialog title="Invite players" onClose={onClose}>
      <p>Read out the code, or send the link. Either one gets people to this table.</p>
      <p className="lobbyCode" style={{ textAlign: 'center' }} aria-label={`Table code ${code.split('').join(' ')}`}>
        {code}
      </p>
      <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Table link" />
      <div className="row">
        <button
          className="btn gold wide"
          onClick={async () => notify((await copyText(link)) ? 'Link copied' : 'Copy the link from the box above', 'ok')}
        >
          Copy link
        </button>
        {canShare && (
          <button
            className="btn wide"
            onClick={() => navigator.share({ title: 'Pixel Pot', text: `Join my poker table: ${code}`, url: link }).catch(() => {})}
          >
            Share
          </button>
        )}
      </div>
    </Dialog>
  );
}

function PlayerTools({
  player,
  party,
  locked,
  busy,
  act,
}: {
  player: Player;
  party: Party;
  locked: boolean;
  busy: boolean;
  act: (action: Action) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState(String(party.settings.startingChips));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const n = Number(amount) || 0;
  return (
    <div className="tools">
      <div className="row">
        <label style={{ flex: '1 1 0', minWidth: 0 }}>
          <span className="sr">Chips to add or take from {player.name}</span>
          <input
            className="input num"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <button
          className="btn small green"
          disabled={locked || busy || n <= 0}
          onClick={() => act({ type: 'chips', playerId: player.id, amount: n })}
        >
          Add
        </button>
        <button
          className="btn small quiet"
          disabled={locked || busy || n <= 0 || n > player.stack}
          onClick={() => act({ type: 'chips', playerId: player.id, amount: -n })}
        >
          Take
        </button>
      </div>
      {player.id !== party.hostId && (
        <button
          className="linkish"
          style={{ color: 'var(--rose)' }}
          disabled={locked || busy}
          onClick={() => (confirmRemove ? act({ type: 'kick', playerId: player.id }) : setConfirmRemove(true))}
        >
          {confirmRemove ? `Tap again to remove ${player.name}` : `Remove ${player.name} from the table`}
        </button>
      )}
    </div>
  );
}

export function TableMenu({
  party,
  seat,
  isHost,
  busy,
  act,
  notify,
  onInvite,
  onClose,
}: {
  party: Party;
  seat: Seat | null;
  isHost: boolean;
  busy: boolean;
  act: (action: Action) => Promise<boolean>;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  onInvite: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sb, setSb] = useState(String(party.settings.smallBlind));
  const [bb, setBb] = useState(String(party.settings.bigBlind));
  const [start, setStart] = useState(String(party.settings.startingChips));
  const locked = party.phase !== 'idle';

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act({
      type: 'settings',
      settings: { startingChips: Number(start), smallBlind: Number(sb || 0), bigBlind: Number(bb || 0) },
    });
    if (ok) notify('Table settings saved');
  };

  const copySeatLink = async () => {
    if (!seat) return;
    const link = `${window.location.origin}/p/${party.code}#seat=${seat.playerId}.${seat.token}`;
    notify(
      (await copyText(link)) ? 'Seat link copied. Open it on your other device.' : "Couldn't copy the link on this device.",
      'ok',
    );
  };

  return (
    <Dialog title={`Table ${party.code}`} onClose={onClose}>
      <div className="row wrap">
        <button className="btn wide" onClick={onInvite}>
          Invite players
        </button>
      </div>
      {seat && (
        <div>
          <button className="linkish" onClick={copySeatLink}>
            Move my seat to another device
          </button>
          <p className="dim">Copies a private link that carries your seat. Don&apos;t share it with other players.</p>
        </div>
      )}

      {isHost && (
        <>
          {locked && (
            <div className="formError">
              <p>Stacks, players and blinds can be changed between hands.</p>
              <button
                className="linkish"
                style={{ color: '#ffd9d4' }}
                disabled={busy}
                onClick={async () => {
                  if (!confirmCancel) return setConfirmCancel(true);
                  if (await act({ type: 'void_hand' })) onClose();
                }}
              >
                {confirmCancel ? 'Tap again to cancel the hand and return all chips' : `Cancel hand ${party.handNo}`}
              </button>
            </div>
          )}

          <h3 className="sectionTitle">Players and chips</h3>
          <ul className="manageList">
            {party.players.map((p) => (
              <li key={p.id}>
                <Face seed={p.id + p.name} size={28} />
                <span>
                  {p.name} <span className="dim">has {chips(p.stack)}</span>
                </span>
                <button className="btn small quiet" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? 'Done' : 'Edit'}
                </button>
                {open === p.id && <PlayerTools player={p} party={party} locked={locked} busy={busy} act={act} />}
              </li>
            ))}
          </ul>

          <h3 className="sectionTitle">Blinds and buy-in</h3>
          <form onSubmit={saveSettings} style={{ display: 'grid', gap: 12 }}>
            <div className="row split">
              <label className="field">
                <span>Small blind</span>
                <input className="input num" inputMode="numeric" value={sb} onChange={(e) => setSb(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="field">
                <span>Big blind</span>
                <input className="input num" inputMode="numeric" value={bb} onChange={(e) => setBb(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <label className="field">
              <span>Starting chips for new players</span>
              <input className="input num" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
            </label>
            <button className="btn" disabled={locked || busy}>
              Save settings
            </button>
          </form>
        </>
      )}
    </Dialog>
  );
}
