'use client';

import { useState, type FormEvent } from 'react';
import Dialog from './Dialog';
import { Face } from './Pixels';
import { Choice, SettingsFields, fromDraft, toDraft, type Draft } from './SettingsFields';
import { chips, copyText, type Seat } from '@/lib/client';
import { gameName } from '@/lib/game';
import type { Action, BotLevel, Party, Player, Settings } from '@/lib/types';

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

function SettingsList({ s }: { s: Settings }) {
  const rows: [string, string][] = [
    ['Game', `${s.mode === 'cards' ? 'Cards' : 'Cardless'} · ${gameName(s)}`],
    ['Blinds', s.bigBlind > 0 ? `${chips(s.smallBlind)}/${chips(s.bigBlind)}` : 'None'],
    ['Ante', s.ante > 0 ? chips(s.ante) : 'None'],
    ['Starting chips', chips(s.startingChips)],
    ['Turns', s.mode === 'cards' || s.turnOrder ? 'Take turns' : 'Anytime'],
    ['Action timer', s.actionTimer > 0 ? `${s.actionTimer}s` : 'Off'],
    ['Max players', String(s.maxPlayers)],
  ];
  return (
    <>
      <h3 className="sectionTitle">Table settings</h3>
      <dl className="settingsList">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="dim">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </>
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
  const [draft, setDraft] = useState<Draft>(() => toDraft(party.settings));
  const [botLevel, setBotLevel] = useState<BotLevel>('medium');
  const cards = party.settings.mode === 'cards';
  const full = party.players.length >= party.settings.maxPlayers;
  const locked = party.phase !== 'idle';

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    // Mode is fixed when the table is created, so it isn't sent.
    const settings: Partial<Settings> = fromDraft(draft);
    delete settings.mode;
    const ok = await act({ type: 'settings', settings });
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

      {!isHost && <SettingsList s={party.settings} />}

      {isHost && (
        <>
          {locked && (
            <div className="formError">
              <p>Stacks, players and settings can be changed between hands.</p>
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
                  {p.name} {p.bot && <span className="tag botTag">AI</span>} <span className="dim">has {chips(p.stack)}</span>
                </span>
                <button className="btn small quiet" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? 'Done' : 'Edit'}
                </button>
                {open === p.id && <PlayerTools player={p} party={party} locked={locked} busy={busy} act={act} />}
              </li>
            ))}
          </ul>

          {cards && (
            <>
              <h3 className="sectionTitle">AI players</h3>
              <Choice
                label="AI level"
                value={botLevel}
                onChange={setBotLevel}
                disabled={locked || busy}
                options={[
                  { value: 'easy', label: 'Easy' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'hard', label: 'Hard' },
                ]}
              />
              <button className="btn" disabled={locked || busy || full} onClick={() => act({ type: 'add_bot', level: botLevel })}>
                {full ? 'The table is full' : 'Add AI player'}
              </button>
              <p className="dim">Remove an AI player from its Edit button above.</p>
              <button
                className="btn quiet"
                aria-pressed={party.settings.autoDeal}
                disabled={busy}
                onClick={() => act({ type: 'auto_deal', on: !party.settings.autoDeal })}
              >
                {party.settings.autoDeal ? 'Pause auto-deal' : 'Deal hands automatically'}
              </button>
              <p className="dim">With only one person at the table, the next hand starts 3 seconds after the last.</p>
            </>
          )}

          <h3 className="sectionTitle">Table settings</h3>
          <form onSubmit={saveSettings} style={{ display: 'grid', gap: 12 }}>
            <p>
              {party.settings.mode === 'cards' ? 'Cards' : 'Cardless'} <span className="dim">(set when the table opened)</span>
            </p>
            <SettingsFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} disabled={locked || busy} />
            <button className="btn" disabled={locked || busy}>
              Save settings
            </button>
          </form>
        </>
      )}
    </Dialog>
  );
}
