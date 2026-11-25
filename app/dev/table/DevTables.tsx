'use client';

import { useEffect, useState } from 'react';
import ActionDock from '@/components/ActionDock';
import { JoinDock, RoomScreen } from '@/components/PartyRoom';
import TableView from '@/components/TableView';
import { fullDeck, type Card } from '@/lib/cards';
import { applyAction, createParty, joinParty } from '@/lib/game';
import type { Action, Party, PartyRecord, Settings } from '@/lib/types';

const NAMES = ['Mia', 'Sam', 'Jo', 'Priya', 'Alexandria', 'Kai', 'Bartholomew', 'Lee', 'Noor', 'Ola'];

/** A real table built with the real rules, so every state here is one the app can reach. */
function table(count: number, settings: Partial<Settings> = {}): PartyRecord {
  const now = Date.now();
  const names = NAMES.slice(0, count);
  const rec = createParty('DEVT', names[0], 'tok', names[0], { smallBlind: 5, bigBlind: 10, ...settings }, now);
  for (const n of names.slice(1)) joinParty(rec, n, 'tok', n, now);
  return rec;
}

/** A fixed deck so card scenes look the same every time: a simple shuffle with a seed. */
function deck(seed: number): Card[] {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function play(rec: PartyRecord, moves: [string, Action][], seed = 1): Party {
  for (const [who, action] of moves) applyAction(rec, who, action, Date.now(), deck(seed));
  return rec.party;
}

type Scene = { title: string; party: Party; meId: string | null; myCards?: Card[] | null };

/** A cards-mode scene: the viewer's own cards come from the private record, as the API would send them. */
function cardScene(title: string, rec: PartyRecord, meId: string): Scene {
  return { title, party: rec.party, meId, myCards: rec.hole[meId] ?? null };
}

function scenes(): Scene[] {
  const out: Scene[] = [];

  out.push({
    title: '2 players · my turn preflop',
    meId: 'Mia',
    party: play(table(2), [['Mia', { type: 'start_hand' }]]),
  });

  out.push({
    title: "6 players · Alexandria's turn on the flop · 30s timer · ante",
    meId: 'Mia',
    party: play(table(6, { actionTimer: 30, ante: 1 }), [
      ['Mia', { type: 'start_hand' }],
      ['Priya', { type: 'call' }],
      ['Alexandria', { type: 'raise', to: 30 }],
      ['Kai', { type: 'fold' }],
      ['Mia', { type: 'call' }],
      ['Sam', { type: 'fold' }],
      ['Jo', { type: 'call' }],
      ['Priya', { type: 'call' }],
      ['Mia', { type: 'dealt' }],
      ['Jo', { type: 'bet', amount: 40 }],
      ['Priya', { type: 'call' }],
    ]),
  });

  out.push({
    title: '10 players · my turn facing an all-in · Omaha',
    meId: 'Mia',
    party: play(table(10, { variant: 'omaha', betting: 'pot-limit' }), [
      ['Mia', { type: 'chips', playerId: 'Bartholomew', amount: -950 }],
      ['Mia', { type: 'start_hand' }],
      ['Priya', { type: 'raise', to: 30 }],
      ['Alexandria', { type: 'call' }],
      ['Kai', { type: 'fold' }],
      ['Bartholomew', { type: 'allin' }],
      ['Lee', { type: 'fold' }],
      ['Noor', { type: 'call' }],
      ['Ola', { type: 'fold' }],
    ]),
  });

  const flop = (): PartyRecord => {
    const rec = table(6);
    play(rec, [
      ['Mia', { type: 'start_hand' }],
      ['Priya', { type: 'call' }],
      ['Alexandria', { type: 'call' }],
      ['Kai', { type: 'call' }],
      ['Mia', { type: 'call' }],
      ['Sam', { type: 'call' }],
      ['Jo', { type: 'check' }],
    ]);
    return rec;
  };
  out.push({ title: '6 players · awaiting the flop · I deal', meId: 'Mia', party: flop().party });
  out.push({ title: '6 players · awaiting the flop · Kai watching', meId: 'Kai', party: flop().party });
  out.push({ title: 'Spectator · awaiting the flop', meId: null, party: flop().party });

  const showdown = table(4);
  out.push({
    title: 'Showdown with side pots',
    meId: 'Priya',
    party: play(showdown, [
      ['Mia', { type: 'chips', playerId: 'Sam', amount: -900 }],
      ['Mia', { type: 'chips', playerId: 'Jo', amount: -700 }],
      ['Mia', { type: 'start_hand' }],
      ['Priya', { type: 'call' }],
      ['Mia', { type: 'call' }],
      ['Sam', { type: 'allin' }],
      ['Jo', { type: 'allin' }],
      ['Priya', { type: 'call' }],
      ['Mia', { type: 'call' }],
      ['Mia', { type: 'dealt' }],
      ['Priya', { type: 'check' }],
      ['Mia', { type: 'check' }],
      ['Mia', { type: 'dealt' }],
      ['Priya', { type: 'check' }],
      ['Mia', { type: 'check' }],
      ['Mia', { type: 'dealt' }],
      ['Priya', { type: 'check' }],
      ['Mia', { type: 'check' }],
    ]),
  });

  out.push({
    title: 'Free play · 4 players (no turns)',
    meId: 'Sam',
    party: play(table(4, { turnOrder: false }), [
      ['Mia', { type: 'start_hand' }],
      ['Priya', { type: 'bet', amount: 40 }],
      ['Sam', { type: 'fold' }],
      ['Mia', { type: 'call' }],
    ]),
  });

  out.push({ title: 'Lobby · 3 players', meId: 'Sam', party: table(3).party });

  const cardsFlop = table(6, { mode: 'cards', actionTimer: 30 });
  play(cardsFlop, [
    ['Mia', { type: 'start_hand' }],
    ['Priya', { type: 'call' }],
    ['Alexandria', { type: 'raise', to: 40 }],
    ['Kai', { type: 'fold' }],
    ['Mia', { type: 'call' }],
    ['Sam', { type: 'fold' }],
    ['Jo', { type: 'call' }],
    ['Priya', { type: 'call' }],
    ['Jo', { type: 'check' }],
    ['Priya', { type: 'bet', amount: 60 }],
  ]);
  out.push(cardScene('Cards · 6 players · flop, Alexandria to act · my cards', cardsFlop, 'Mia'));

  const omaha = table(4, { mode: 'cards', variant: 'omaha', betting: 'pot-limit' });
  play(omaha, [['Mia', { type: 'start_hand' }]], 7);
  out.push(cardScene('Cards · Omaha · my turn preflop', omaha, 'Mia'));

  const shown = table(4, { mode: 'cards' });
  play(
    shown,
    [
      ['Mia', { type: 'chips', playerId: 'Sam', amount: -800 }],
      ['Mia', { type: 'start_hand' }],
      ['Priya', { type: 'call' }],
      ['Mia', { type: 'raise', to: 200 }],
      ['Sam', { type: 'allin' }],
      ['Jo', { type: 'fold' }],
      ['Priya', { type: 'call' }],
      ['Priya', { type: 'check' }],
      ['Mia', { type: 'check' }],
      ['Priya', { type: 'check' }],
      ['Mia', { type: 'check' }],
      ['Priya', { type: 'check' }],
      ['Mia', { type: 'check' }],
    ],
    3,
  );
  out.push(cardScene('Cards · after the showdown: shown hands, winner highlighted', shown, 'Mia'));

  const foldWin = table(3, { mode: 'cards' });
  play(foldWin, [
    ['Mia', { type: 'start_hand' }],
    ['Mia', { type: 'raise', to: 40 }],
    ['Sam', { type: 'fold' }],
    ['Jo', { type: 'fold' }],
  ]);
  out.push(cardScene('Cards · I won without a showdown (my cards stay private)', foldWin, 'Mia'));

  // My turn with my cards showing, at the smallest and biggest tables.
  for (const count of [2, 10]) {
    const rec = table(count, { mode: 'cards', actionTimer: 30 });
    applyAction(rec, 'Mia', { type: 'start_hand' }, Date.now(), deck(count));
    while (rec.party.toActId !== 'Mia') applyAction(rec, rec.party.toActId!, { type: 'call' }, Date.now());
    out.push(cardScene(`Cards · ${count} players · my turn`, rec, 'Mia'));
  }
  return out;
}

const noop = async () => false;

/** One scene on the real table screen (top bar, overlays, dock), as a player would see it. */
function FullScreen({ scene, panel }: { scene: Scene; panel: 'chips' | 'log' | null }) {
  const { party } = scene;
  const me = party.players.find((p) => p.id === scene.meId) ?? null;
  return (
    <RoomScreen
      party={party}
      me={me}
      myCards={scene.myCards ?? null}
      sync="ok"
      busy={false}
      act={noop}
      muted={false}
      onToggleMute={() => {}}
      openDialog={() => {}}
      dialogOpen={false}
      initialPanel={panel}
      dock={
        me ? (
          <ActionDock party={party} me={me} isHost={me.id === party.hostId} busy={false} act={noop} onAward={() => {}} />
        ) : (
          <JoinDock party={party} notify={() => {}} onJoined={() => {}} />
        )
      }
    />
  );
}

export default function DevTables() {
  // Built after mount: the timer deadlines depend on the clock.
  const [list, setList] = useState<Scene[] | null>(null);
  const [full, setFull] = useState<{ scene: number; panel: 'chips' | 'log' | null } | null>(null);
  useEffect(() => {
    setList(scenes());
    // ?scene=N shows scene N full screen; &panel=chips or &panel=log opens that panel.
    const q = new URLSearchParams(window.location.search);
    const panel = q.get('panel');
    if (q.has('scene')) setFull({ scene: Number(q.get('scene')), panel: panel === 'chips' || panel === 'log' ? panel : null });
  }, []);
  if (!list) return null;
  if (full && list[full.scene]) return <FullScreen scene={list[full.scene]} panel={full.panel} />;
  return (
    <main className="devTables">
      <h1 className="setupTitle">Table previews</h1>
      {list.map((scene, i) => (
        <section key={scene.title} className="devScene">
          <h2 className="sectionTitle">
            <a href={`?scene=${i}`}>{scene.title}</a>
          </h2>
          <TableView
            party={scene.party}
            meId={scene.meId}
            myCards={scene.myCards}
            lobby={
              <div className="lobby">
                <p className="potLabel">Table code</p>
                <p className="lobbyCode">DEVT</p>
              </div>
            }
          />
        </section>
      ))}
    </main>
  );
}
