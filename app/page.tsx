'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import ChipPile from '@/components/scene/ChipPile';
import { api } from '@/lib/client';
import { CODE_LENGTH, normalizeCode } from '@/lib/game';

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState('');

  async function join(e: FormEvent) {
    e.preventDefault();
    setJoinError('');
    if (code.length < CODE_LENGTH) {
      setJoinError(`Table codes are ${CODE_LENGTH} letters.`);
      return;
    }
    setBusy(true);
    const res = await api(`/api/party/${code}`);
    if (res.party) {
      router.push(`/p/${code}`);
      return;
    }
    setBusy(false);
    setJoinError(res.status === 404 ? 'No table with that code. Check it with your host.' : (res.error ?? 'Try again.'));
  }

  return (
    <main className="home">
      <header className="hero">
        <div className="heroChips" aria-hidden="true">
          <ChipPile amount={30} scale={4} maxTowers={1} />
          <ChipPile amount={2500} scale={4} maxTowers={1} />
          <ChipPile amount={300} scale={4} maxTowers={1} />
        </div>
        <h1 className="wordmark">Pixel Pot</h1>
        <p className="tagline">Deal real cards at the table. Keep the chips on your phones.</p>
      </header>

      <div className="doors">
        <section className="frame door">
          <h2>Host a table</h2>
          <p>Pick the game, blinds and chips, then share a four-letter code with your friends.</p>
          <Link className="btn gold" href="/new">
            Host a table
          </Link>
          <Link className="btn" href="/new?ai=1">
            Play vs AI
          </Link>
        </section>

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
          <button className="btn" disabled={busy}>
            {busy ? 'Finding table…' : 'Find table'}
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
