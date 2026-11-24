'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ChipStack } from '@/components/Pixels';
import { api, loadName, saveName, saveSeat } from '@/lib/client';
import { CODE_LENGTH, NAME_MAX, normalizeCode } from '@/lib/game';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startingChips, setStartingChips] = useState('1000');
  const [smallBlind, setSmallBlind] = useState('5');
  const [bigBlind, setBigBlind] = useState('10');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'host' | 'join' | null>(null);
  const [hostError, setHostError] = useState('');
  const [joinError, setJoinError] = useState('');

  useEffect(() => setName(loadName()), []);

  async function host(e: FormEvent) {
    e.preventDefault();
    setHostError('');
    setBusy('host');
    const res = await api('/api/party', {
      name,
      settings: {
        startingChips: Number(startingChips),
        smallBlind: Number(smallBlind || 0),
        bigBlind: Number(bigBlind || 0),
      },
    });
    if (res.party && res.playerId && res.token) {
      saveName(name.trim());
      saveSeat(res.party.code, { playerId: res.playerId, token: res.token });
      router.push(`/p/${res.party.code}`);
      return;
    }
    setBusy(null);
    setHostError(res.error ?? 'Something went wrong. Try again.');
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setJoinError('');
    if (code.length < CODE_LENGTH) {
      setJoinError(`Table codes are ${CODE_LENGTH} letters.`);
      return;
    }
    setBusy('join');
    const res = await api(`/api/party/${code}`);
    if (res.party) {
      router.push(`/p/${code}`);
      return;
    }
    setBusy(null);
    setJoinError(res.status === 404 ? 'No table with that code. Check it with your host.' : (res.error ?? 'Try again.'));
  }

  return (
    <main className="home">
      <header className="hero">
        <div className="heroChips" aria-hidden="true">
          <ChipStack amount={700} scale={4} maxColumns={1} />
          <ChipStack amount={9000} scale={4} maxColumns={1} />
          <ChipStack amount={30} scale={4} maxColumns={1} />
        </div>
        <h1 className="wordmark">Pixel Pot</h1>
        <p className="tagline">Deal real cards at the table. Keep the chips on your phones.</p>
      </header>

      <div className="doors">
        <form className="frame door" onSubmit={host}>
          <h2>Host a table</h2>
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
          <label className="field">
            <span>Starting chips for each player</span>
            <input
              className="input num"
              inputMode="numeric"
              pattern="[0-9]*"
              value={startingChips}
              onChange={(e) => setStartingChips(e.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <div className="row split">
            <label className="field">
              <span>Small blind</span>
              <input
                className="input num"
                inputMode="numeric"
                pattern="[0-9]*"
                value={smallBlind}
                onChange={(e) => setSmallBlind(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="field">
              <span>Big blind</span>
              <input
                className="input num"
                inputMode="numeric"
                pattern="[0-9]*"
                value={bigBlind}
                onChange={(e) => setBigBlind(e.target.value.replace(/\D/g, ''))}
              />
            </label>
          </div>
          <p className="dim">Blinds are posted for you each hand. Set both to 0 to post them yourselves.</p>
          {hostError && (
            <p className="formError" role="alert">
              {hostError}
            </p>
          )}
          <button className="btn gold" disabled={busy !== null}>
            {busy === 'host' ? 'Opening table…' : 'Create table'}
          </button>
        </form>

        <form className="frame door join" onSubmit={join}>
          <h2>Join a table</h2>
          <label className="field">
            <span>Table code from your host</span>
            <input
              className="input code"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="····"
              aria-describedby="code-help"
            />
            <small id="code-help">Four letters. Got a link instead? Opening it takes you straight to the table.</small>
          </label>
          {joinError && (
            <p className="formError" role="alert">
              {joinError}
            </p>
          )}
          <button className="btn" disabled={busy !== null}>
            {busy === 'join' ? 'Finding table…' : 'Find table'}
          </button>
        </form>
      </div>

      <p className="how">
        The host starts each hand and awards the pot. Everyone bets from their own phone, and every hand&apos;s chip
        counts are saved to the log.
      </p>
    </main>
  );
}
