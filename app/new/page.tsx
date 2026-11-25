'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Choice, SettingsFields, fromDraft, type Draft } from '@/components/SettingsFields';
import { api, loadName, saveName, saveSeat } from '@/lib/client';
import { NAME_MAX, settingsSummary } from '@/lib/game';

type Preset = Pick<Draft, 'variant' | 'betting' | 'smallBlind' | 'bigBlind' | 'ante' | 'startingChips' | 'actionTimer'>;

const PRESETS: { name: string; detail: string; values: Preset }[] = [
  {
    name: 'Home game',
    detail: "NL Hold'em",
    values: { variant: 'holdem', betting: 'no-limit', smallBlind: '5', bigBlind: '10', ante: '0', startingChips: '1000', actionTimer: 0 },
  },
  {
    name: 'Pot-Limit Omaha',
    detail: 'PL Omaha',
    values: { variant: 'omaha', betting: 'pot-limit', smallBlind: '5', bigBlind: '10', ante: '0', startingChips: '1000', actionTimer: 0 },
  },
  {
    name: 'Turbo',
    detail: '30s timer',
    values: { variant: 'holdem', betting: 'no-limit', smallBlind: '10', bigBlind: '20', ante: '0', startingChips: '1000', actionTimer: 30 },
  },
];

const START: Draft = { mode: 'cardless', turnOrder: true, maxPlayers: 10, autoDeal: false, ...PRESETS[0].values };

type AiLevel = 'easy' | 'medium' | 'hard' | 'mixed';
const digits = (v: string) => v.replace(/\D/g, '');

export default function NewTable() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Draft>(START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // "Play vs AI" (/new?ai=1): a card table with computer opponents that deals itself.
  const [ai, setAi] = useState(false);
  const [aiCount, setAiCount] = useState(3);
  const [aiLevel, setAiLevel] = useState<AiLevel>('medium');

  useEffect(() => {
    setName(loadName());
    if (new URLSearchParams(window.location.search).get('ai') === '1') {
      setAi(true);
      setDraft((d) => ({ ...d, mode: 'cards', autoDeal: true }));
    }
  }, []);

  const change = (patch: Partial<Draft>) => {
    setError('');
    setDraft((d) => ({ ...d, ...patch }));
  };
  const isPreset = (p: Preset) => (Object.keys(p) as (keyof Preset)[]).every((k) => draft[k] === p[k]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await api('/api/party', {
      name,
      settings: fromDraft(draft),
      ...(ai ? { bots: { count: aiCount, level: aiLevel } } : {}),
    });
    if (res.party && res.playerId && res.token) {
      saveName(name.trim());
      saveSeat(res.party.code, { playerId: res.playerId, token: res.token });
      router.push(`/p/${res.party.code}`);
      return;
    }
    setBusy(false);
    setError(res.error ?? 'Something went wrong. Try again.');
  }

  return (
    <main className="home setup">
      <Link className="linkish" href="/">
        ← Back
      </Link>
      <h1 className="setupTitle">{ai ? 'Play vs AI' : 'Host a table'}</h1>

      <form className="frame door" onSubmit={create}>
        {ai ? (
          <>
            <fieldset className="setupSection">
              <legend>AI opponents</legend>
              <label className="field">
                <span className="sr">Number of AI opponents</span>
                <select className="input num" value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'opponent' : 'opponents'}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <fieldset className="setupSection">
              <legend>Difficulty</legend>
              <Choice
                label="Difficulty"
                value={aiLevel}
                onChange={setAiLevel}
                options={[
                  { value: 'easy', label: 'Easy' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'hard', label: 'Hard' },
                  { value: 'mixed', label: 'Mixed' },
                ]}
              />
              <p className="dim">
                {aiLevel === 'easy'
                  ? 'Easy: calls a lot, rarely raises.'
                  : aiLevel === 'medium'
                    ? 'Medium: plays good hands and weighs the odds.'
                    : aiLevel === 'hard'
                      ? 'Hard: uses position, draws and your habits.'
                      : 'Mixed: a bit of everything.'}
              </p>
            </fieldset>
            <fieldset className="setupSection">
              <legend>Blinds</legend>
              <div className="row split">
                {(['smallBlind', 'bigBlind'] as const).map((key) => (
                  <label key={key} className="field">
                    <span>{key === 'smallBlind' ? 'Small' : 'Big'}</span>
                    <input className="input num" inputMode="numeric" value={draft[key]} onChange={(e) => change({ [key]: digits(e.target.value) })} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="setupSection">
              <legend>Starting chips</legend>
              <label className="field">
                <span className="sr">Chips for each player</span>
                <input className="input num" inputMode="numeric" value={draft.startingChips} onChange={(e) => change({ startingChips: digits(e.target.value) })} />
              </label>
            </fieldset>
          </>
        ) : (
          <>
        <fieldset className="setupSection">
          <legend>Presets</legend>
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="btn small quiet stacked"
                aria-pressed={isPreset(p.values)}
                data-pressed={isPreset(p.values)}
                onClick={() => change(p.values)}
              >
                <span>{p.name}</span>
                <span className="presetDetail">{p.detail}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="setupSection">
          <legend>Game</legend>
          <div className="modeToggle" role="group" aria-label="Game">
            {(
              [
                { value: 'cardless', label: 'Cardless', help: 'Deal real cards at the table. The app keeps the chips.' },
                { value: 'cards', label: 'Cards', help: 'The app deals and shows everyone their cards.' },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                type="button"
                className="btn quiet stacked"
                aria-pressed={draft.mode === m.value}
                data-pressed={draft.mode === m.value}
                onClick={() => change({ mode: m.value })}
              >
                <span>{m.label}</span>
                <span className="modeHelp">{m.help}</span>
              </button>
            ))}
          </div>
          <p className="dim">You can&apos;t switch this once the table is open.</p>
        </fieldset>

        <SettingsFields draft={draft} onChange={change} />
          </>
        )}

        <label className="field">
          <span>Your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            required
          />
        </label>

        <p className="setupSummary" aria-live="polite">
          {settingsSummary(fromDraft(draft))}
          {ai && ` · ${aiCount} AI (${aiLevel})`}
        </p>
        {error && (
          <p className="formError" role="alert">
            {error}
          </p>
        )}
        <button className="btn gold" disabled={busy}>
          {busy ? 'Opening table…' : 'Create table'}
        </button>
      </form>
    </main>
  );
}
