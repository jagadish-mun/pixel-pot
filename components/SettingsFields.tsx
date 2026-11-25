'use client';

import { MAX_PLAYERS } from '@/lib/game';
import type { Settings } from '@/lib/types';

type NumKey = 'startingChips' | 'smallBlind' | 'bigBlind' | 'ante';
/** Settings as the form holds them: number fields stay as typed text until saved. */
export type Draft = Omit<Settings, NumKey> & Record<NumKey, string>;

export function toDraft(s: Settings): Draft {
  return {
    ...s,
    startingChips: String(s.startingChips),
    smallBlind: String(s.smallBlind),
    bigBlind: String(s.bigBlind),
    ante: String(s.ante),
  };
}

export function fromDraft(d: Draft): Settings {
  return {
    ...d,
    startingChips: Number(d.startingChips),
    smallBlind: Number(d.smallBlind || 0),
    bigBlind: Number(d.bigBlind || 0),
    ante: Number(d.ante || 0),
  };
}

/** A row of toggle buttons where exactly one is picked. */
export function Choice<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="choice" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="btn small quiet"
          aria-pressed={value === o.value}
          data-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const BETTING_HELP: Record<Settings['betting'], string> = {
  'no-limit': 'No-limit: bet any amount up to your whole stack.',
  'pot-limit': 'Pot-limit: the biggest bet is the size of the pot.',
  'fixed-limit': 'Fixed-limit: bets and raises go up in fixed steps.',
};

const digits = (v: string) => v.replace(/\D/g, '');

/** Every table setting except Cardless/Cards, which is picked once when the table is created. */
export function SettingsFields({
  draft,
  onChange,
  disabled,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  disabled?: boolean;
}) {
  const num = (key: NumKey, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input num"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft[key]}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: digits(e.target.value) })}
      />
    </label>
  );

  return (
    <>
      <fieldset className="setupSection">
        <legend>Poker type</legend>
        <Choice
          label="Poker type"
          value={draft.variant}
          disabled={disabled}
          onChange={(variant) => onChange({ variant })}
          options={[
            { value: 'holdem', label: "Hold'em" },
            { value: 'omaha', label: 'Omaha' },
          ]}
        />
        <p className="dim">{draft.variant === 'omaha' ? 'Omaha: 4 hole cards, use exactly 2.' : "Hold'em: 2 hole cards."}</p>
      </fieldset>

      <fieldset className="setupSection">
        <legend>Betting</legend>
        <Choice
          label="Betting"
          value={draft.betting}
          disabled={disabled}
          onChange={(betting) => onChange({ betting })}
          options={[
            { value: 'no-limit', label: 'NL' },
            { value: 'pot-limit', label: 'PL' },
            { value: 'fixed-limit', label: 'Limit' },
          ]}
        />
        <p className="dim">{BETTING_HELP[draft.betting]}</p>
      </fieldset>

      <fieldset className="setupSection">
        <legend>Blinds &amp; ante</legend>
        <div className="row split">
          {num('smallBlind', 'Small')}
          {num('bigBlind', 'Big')}
          {num('ante', 'Ante')}
        </div>
        <p className="dim">Set the blinds to 0 to post them yourselves. The ante can&apos;t be more than the big blind.</p>
      </fieldset>

      <fieldset className="setupSection">
        <legend>Starting chips</legend>
        {num('startingChips', 'Chips for each player')}
      </fieldset>

      <fieldset className="setupSection">
        <legend>Turns</legend>
        {draft.mode === 'cardless' ? (
          <>
            <Choice
              label="Turn order"
              value={draft.turnOrder}
              disabled={disabled}
              onChange={(turnOrder) => onChange({ turnOrder })}
              options={[
                { value: true, label: 'Take turns' },
                { value: false, label: 'Anytime' },
              ]}
            />
            <p className="dim">
              {draft.turnOrder ? 'Players act one at a time, in seat order.' : 'Anyone can bet whenever the real game says so.'}
            </p>
          </>
        ) : (
          <p className="dim">With cards, players always act one at a time.</p>
        )}
        <span className="fieldLabel">Action timer</span>
        <Choice
          label="Action timer"
          value={draft.actionTimer}
          disabled={disabled}
          onChange={(actionTimer) => onChange({ actionTimer })}
          options={[
            { value: 0, label: 'Off' },
            { value: 15, label: '15s' },
            { value: 30, label: '30s' },
            { value: 60, label: '60s' },
          ]}
        />
      </fieldset>

      <fieldset className="setupSection">
        <legend>Max players</legend>
        <label className="field">
          <span className="sr">Max players</span>
          <select
            className="input num"
            value={draft.maxPlayers}
            disabled={disabled}
            onChange={(e) => onChange({ maxPlayers: Number(e.target.value) })}
          >
            {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n} players
              </option>
            ))}
          </select>
        </label>
      </fieldset>
    </>
  );
}
