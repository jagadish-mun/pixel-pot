'use client';

import { useState } from 'react';
import Dialog from './Dialog';
import { ChipStack, Face } from './Pixels';
import { chips } from '@/lib/client';
import { eligibleWinners, potOf } from '@/lib/game';
import type { Action, Party } from '@/lib/types';

export default function AwardDialog({
  party,
  busy,
  act,
  onClose,
}: {
  party: Party;
  busy: boolean;
  act: (action: Action) => Promise<boolean>;
  onClose: () => void;
}) {
  const pot = potOf(party);
  const eligible = eligibleWinners(party);
  const [picked, setPicked] = useState<string[]>(eligible.length === 1 ? [eligible[0].id] : []);
  const side = party.phase === 'showdown';

  if (pot === 0) {
    return (
      <Dialog title="The pot is empty" onClose={onClose}>
        <p>Nobody put chips in this hand. End it and move on to the next one?</p>
        <button
          className="btn gold"
          disabled={busy}
          onClick={async () => {
            if (await act({ type: 'award', winners: [] })) onClose();
          }}
        >
          End hand {party.handNo}
        </button>
      </Dialog>
    );
  }

  if (eligible.length === 0) {
    return (
      <Dialog title="Nobody can win this pot" onClose={onClose}>
        <p>
          Everyone with chips in the pot has folded. Ask the winner to take back their fold, or cancel the hand from the
          menu to return all chips.
        </p>
        <button className="btn" onClick={onClose}>
          Back to the table
        </button>
      </Dialog>
    );
  }

  const winners = eligible.filter((p) => picked.includes(p.id));
  const level = winners.length ? Math.min(...winners.map((w) => w.bet)) : 0;
  const slice = party.players.reduce((sum, p) => sum + Math.min(p.bet, level), 0);
  const rest = pot - slice;
  const contesting = eligible.filter((p) => p.bet > level);

  let confirm = 'Pick a winner';
  if (winners.length === 1) confirm = `Give ${chips(slice)} to ${winners[0].name}`;
  else if (winners.length > 1) confirm = `Split ${chips(slice)} ${winners.length} ways`;

  let note = '';
  if (winners.length && rest > 0) {
    if (contesting.length >= 2) note = `The other ${chips(rest)} is a side pot. You'll pick who wins it next.`;
    else if (contesting.length === 1) note = `The other ${chips(rest)} goes to ${contesting[0].name}, the only player still in for it.`;
    else note = `The other ${chips(rest)} goes back to the players who put it in.`;
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog title={side ? `Who wins the ${chips(pot)} side pot?` : `Who won the ${chips(pot)} pot?`} onClose={side ? undefined : onClose}>
      <p className="dim">Pick one player, or several to split it.</p>
      <ul className="pickList">
        {eligible.map((p) => (
          <li key={p.id}>
            <button className="pick" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
              <Face seed={p.id + p.name} size={36} />
              <span>
                {p.name}
                <br />
                <span className="dim">{chips(p.bet)} in</span>
              </span>
              <span className="mark" />
            </button>
          </li>
        ))}
      </ul>
      {note && <p>{note}</p>}
      <div className="row" style={{ justifyContent: 'center', minHeight: 44 }}>
        <ChipStack amount={slice || pot} scale={3} maxColumns={5} />
      </div>
      <button
        className="btn gold"
        disabled={busy || winners.length === 0}
        onClick={async () => {
          if (await act({ type: 'award', winners: winners.map((w) => w.id) })) onClose();
        }}
      >
        {confirm}
      </button>
    </Dialog>
  );
}
