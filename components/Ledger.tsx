'use client';

import { Face } from './Pixels';
import { chips, signed } from '@/lib/client';
import type { Party } from '@/lib/types';

const cls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'dim');

/** Everyone's chips now, and their win or loss against what they were given. */
export function ChipCounts({ party, meId }: { party: Party; meId?: string }) {
  const standings = [...party.players].sort((a, b) => b.stack + b.bet - (a.stack + a.bet));
  return (
    <section className="frame card" aria-labelledby="standings-title">
      <h2 id="standings-title">Chip counts</h2>
      <ol className="standings">
        {standings.map((p, i) => {
          const total = p.stack + p.bet;
          const net = total - p.buyIn;
          return (
            <li key={p.id}>
              <span className="rank">{i + 1}</span>
              <Face seed={p.id + p.name} size={28} />
              <span className="standName">
                {p.name}
                {p.id === meId && <span className="dim"> (you)</span>}
              </span>
              <span className="num">{chips(total)}</span>
              <span className={`net ${cls(net)}`}>{signed(net)}</span>
            </li>
          );
        })}
      </ol>
      <p className="dim" style={{ marginTop: 12 }}>
        The right-hand number is each player&apos;s win or loss against the chips they were given.
      </p>
    </section>
  );
}

/** One row per finished hand (and chip change), newest first, with every player's stack. */
export function HandLog({ party }: { party: Party }) {
  // One column per player who has ever been in a logged hand, current players first.
  const columns = party.players.map((p) => ({ id: p.id, name: p.name }));
  for (const entry of party.log) {
    if (entry.kind !== 'hand') continue;
    for (const row of entry.rows) {
      if (!columns.some((c) => c.id === row.id)) columns.push({ id: row.id, name: row.name });
    }
  }
  const entries = [...party.log].reverse();
  return (
    <section className="frame card" aria-labelledby="log-title">
      <h2 id="log-title">Hand log</h2>
      {entries.length === 0 ? (
        <p className="empty">No hands yet. Each finished hand adds a row here with everyone&apos;s chip count.</p>
      ) : (
        <div className="ledgerScroll">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Hand</th>
                <th scope="col">Pot</th>
                {columns.map((c) => (
                  <th scope="col" key={c.id}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) =>
                entry.kind === 'chips' ? (
                  <tr key={`c${entry.ts}-${i}`}>
                    <td className="note" colSpan={2 + columns.length}>
                      {entry.amount > 0
                        ? `${entry.name} was given ${chips(entry.amount)} chips, now ${chips(entry.after)}`
                        : `${chips(-entry.amount)} chips taken from ${entry.name}, now ${chips(entry.after)}`}
                    </td>
                  </tr>
                ) : (
                  <tr key={`h${entry.n}-${entry.ts}`}>
                    <td>{entry.n}</td>
                    <td>{chips(entry.pot)}</td>
                    {columns.map((c) => {
                      const row = entry.rows.find((r) => r.id === c.id);
                      if (!row) return <td key={c.id} className="dim" aria-label="Not in this hand" />;
                      const delta = row.after - row.before;
                      return (
                        <td key={c.id} className="stackCell" data-won={entry.winners.includes(c.id)}>
                          <b>{chips(row.after)}</b>
                          <span className={cls(delta)}>{signed(delta)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
