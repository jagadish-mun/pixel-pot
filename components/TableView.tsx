'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { BADGE_MS, applyPending, clatter, overlayFor, type AnimView } from './scene/animate';
import { DEAL_MS, FOLD_MS, SWEEP_MS, drawScene, handsBox, personAt, seatAnchors, type Marker, type Motion, type SceneData } from './scene/draw';
import { AnimQueue, diffSnapshots } from './scene/events';
import { handsSize, myCardWidth } from './scene/hands';
import { BET_INSET, BOARD_Z, POT_SPOT, arrangeSeats, onFelt, spots } from './scene/layout';
import { idle, poseOf } from './scene/people';
import { fitCamera, project, type Camera } from './scene/project';
import { WEALTH, chipTowers, wealthTarget } from '@/lib/chips';
import { chips, loadMuted, signed } from '@/lib/client';
import { cardText, type Card } from '@/lib/cards';
import { potOf, potsOf, usesTurns } from '@/lib/game';
import { bestHand } from '@/lib/hand';
import type { Action, Party, Player, Street } from '@/lib/types';

/** Chips this player has in front of them: this street's bets, or the whole hand on free-play tables. */
const inFront = (party: Party, p: Player) => (usesTurns(party) ? p.roundBet : p.bet);

/** A square ring of pixels that empties as the turn timer runs down. */
function TimerRing({ deadline, seconds }: { deadline: number; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  // The 40 border cells of an 11×11 grid, clockwise from the top middle.
  const cells: [number, number][] = [];
  for (let x = 5; x <= 10; x++) cells.push([x, 0]);
  for (let y = 1; y <= 10; y++) cells.push([10, y]);
  for (let x = 9; x >= 0; x--) cells.push([x, 10]);
  for (let y = 9; y >= 0; y--) cells.push([0, y]);
  for (let x = 1; x <= 4; x++) cells.push([x, 0]);
  const left = Math.max(0, Math.min(1, (deadline - now) / (seconds * 1000)));
  const lit = Math.ceil(left * cells.length);
  const color = left > 0.25 ? '#f5b83d' : '#e2483d';
  return (
    <svg className="timerRing" viewBox="0 0 11 11" preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={`${Math.ceil((deadline - now) / 1000)} seconds left`}>
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill={i < lit ? color : 'rgba(12,9,22,.55)'} />
      ))}
    </svg>
  );
}

const DEALT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const DEAL_HOW: Record<string, string> = { flop: 'Burn 1, deal 3', turn: 'Burn 1, deal 1', river: 'Burn 1, deal 1' };

/**
 * Reveal a board that arrives several streets at once (an all-in runout) one
 * street at a time. Returns how many cards to show.
 */
function useBoardReveal(length: number): number {
  const [visible, setVisible] = useState(length);
  const seen = useRef(length);
  useEffect(() => {
    if (length < visible) {
      // A new hand: start over.
      seen.current = length;
      setVisible(length);
      return;
    }
    if (visible >= length) return;
    // The first street of a change appears at once; any more follow with a pause.
    const first = seen.current !== length;
    seen.current = length;
    const t = setTimeout(() => setVisible((v) => (v < 3 ? 3 : v + 1)), first ? 0 : 900);
    return () => clearTimeout(t);
  }, [length, visible]);
  return Math.min(visible, length);
}

/**
 * The canvas size: about 480 internal pixels across, chosen so each internal
 * pixel is a whole number of device pixels (crisp, even pixels). `q` is CSS
 * pixels per internal pixel.
 */
function useCanvasSize(box: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number; q: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = el.clientWidth;
      const cssH = el.clientHeight;
      if (!cssW || !cssH) return;
      const k = Math.max(1, Math.round((cssW * dpr) / 480));
      setSize((old) => {
        const next = { w: Math.ceil((cssW * dpr) / k), h: Math.ceil((cssH * dpr) / k), q: k / dpr };
        return old && old.w === next.w && old.h === next.h && old.q === next.q ? old : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  return size;
}

function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setStill(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return still;
}

/** Idle motion switched off (reduced motion). */
const STILL = { bob: 0, blink: false, tilt: false };

/** Room kept free round the table for the DOM labels, in CSS pixels. */
const MARGIN = { top: 50, side: 10, bottom: 2 };
const MY_STRIP = 64;
/** Name plates stay this far (CSS px, to their middle) from the sides. */
const PLATE_HALF = 42;

export default function TableView({
  party,
  meId,
  busy = false,
  act,
  lobby,
  myCards = null,
}: {
  party: Party;
  meId: string | null;
  busy?: boolean;
  act?: (action: Action) => Promise<boolean>;
  /** Shown in the middle of the table before the first hand. */
  lobby?: ReactNode;
  /** Cards mode: my own hole cards, which only my browser receives. */
  myCards?: Card[] | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(box);
  const still = useReducedMotion();
  const turns = usesTurns(party);
  const playing = party.phase !== 'idle';
  const cardsMode = party.settings.mode === 'cards';
  const omaha = party.settings.variant === 'omaha';
  const holeCount = omaha ? 4 : 2;
  const me = party.players.find((p) => p.id === meId);

  // My hands, first person, need room at the bottom; on tall screens there's a strip below the rail too.
  const cw = size ? myCardWidth(size.w, size.q) : 0;
  const handsH = me ? handsSize(cw, holeCount).h : 0;
  // A panel floating over the scene's top-left corner (the recent moves on wide screens) is kept clear of.
  const [overlay, setOverlay] = useState(0);
  useLayoutEffect(() => {
    const scene = box.current;
    const panel = scene?.closest('.stage')?.querySelector<HTMLElement>('.hud');
    if (!scene || !panel) return;
    const measure = () => {
      const s = scene.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const overlaps = p.bottom > s.top + 4 && p.left < s.left + s.width / 2 && getComputedStyle(panel).display !== 'none';
      setOverlay(overlaps ? Math.round(p.right - s.left + 8) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    ro.observe(scene);
    return () => ro.disconnect();
  }, []);
  const cam: Camera | null = useMemo(() => {
    if (!size) return null;
    const strip = size.h > size.w * 1.05 ? MY_STRIP / size.q : 0;
    const bottom = Math.max(MARGIN.bottom / size.q, strip, handsH * 0.55);
    return fitCamera(size.w, size.h, { top: MARGIN.top / size.q, side: MARGIN.side / size.q, bottom, left: overlay / size.q });
  }, [size, handsH, overlay]);

  // I sit at the near side. Spectators see the table from the host's chair.
  let meIndex = party.players.findIndex((p) => p.id === meId);
  if (meIndex < 0) meIndex = Math.max(0, party.players.findIndex((p) => p.id === party.hostId));
  const seats = arrangeSeats(party.players, meIndex);

  const total = potOf(party);
  const middle = total - party.players.reduce((sum, p) => sum + inFront(party, p), 0);
  // Side pots only once this street's chips are in the middle; mid-street, uncalled bets would look like pots.
  const sidePots = middle === total ? potsOf(party).filter((pot) => pot.eligible.length >= 2) : [];
  const lastHand = [...party.log].reverse().find((e) => e.kind === 'hand');
  let potLine = 'Pot';
  if (!playing && lastHand?.kind === 'hand') {
    const names = lastHand.rows.filter((r) => lastHand.winners.includes(r.id)).map((r) => r.name);
    potLine = names.length ? `Last pot went to ${names.join(' & ')}` : 'Last pot';
  }

  // The board as revealed so far, and once it's all out, the showdown.
  const visible = useBoardReveal(party.board.length);
  const revealed = visible === party.board.length;
  const winners = revealed ? party.handResults.filter((r) => r.amount > 0) : [];
  const winning = new Set<string>(winners.flatMap((r) => r.best));
  const awaiting = turns && party.phase === 'live' ? party.awaitingDeal : null;
  let dealt = turns && playing ? DEALT[party.street] : 0;
  if (awaiting) dealt -= awaiting === 'flop' ? 3 : 1;
  // Cards tables show the real board; cardless tables show a face-down card for each one dealt at the table.
  const board: SceneData['board'] = Array.from({ length: 5 }, (_, i) =>
    cardsMode ? (i < visible ? party.board[i] : null) : i < dealt ? 'back' : null,
  );
  const myHand =
    cardsMode && myCards?.length && playing && me?.inHand && !me.folded ? bestHand(myCards, party.board.slice(0, visible), party.settings.variant).name : null;
  const actingId = turns && party.phase === 'live' && !party.awaitingDeal ? party.toActId : null;
  const shownOf = (p: Player): Card[] | null => (revealed && party.shown[p.id] ? party.shown[p.id] : null);

  // Holding my cards up, lowered flat while I hide them (tap and hold, or hold Space), or resting on the rail.
  const [peek, setPeek] = useState(false);
  const holding = Boolean(me && cardsMode && myCards?.length && playing && me.inHand && !me.folded);
  const hands: SceneData['hands'] = me
    ? { mode: holding ? (peek ? 'lowered' : 'hold') : 'rest', cards: holding ? myCards! : [], count: holeCount, cw }
    : null;
  useEffect(() => {
    if (!holding) return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button, [contenteditable]');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing(e)) {
        e.preventDefault();
        setPeek(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setPeek(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [holding]);

  // My chips sit on the felt just above my hands, between them and the middle.
  const myZ = useMemo(() => {
    if (!cam || !hands || !size) return -0.42;
    // Room for the "You have: …" pill (about 30 CSS px) between the chips and my hands.
    const top = cam.h - handsH - 3 - 30 / size.q;
    for (let z = -0.5; z < -0.1; z += 0.01) if (project(cam, 0, 0, z).y <= top) return z;
    return -0.1;
  }, [cam, hands, handsH, size]);

  // Piles show relative wealth: the richest stack at the table gets the most chips. Recomputed only when stacks change.
  const richest = Math.max(1, ...party.players.map((p) => p.stack));
  // A small table on screen (a phone) gets proportionally fewer chips, so piles don't bury the felt: full counts
  // when the felt is about 350 CSS px a table unit (a desktop), down to a third on a phone.
  const chipScale = cam && size ? Math.max(0.33, Math.min(1, (project(cam, 0, 0, 0).s * size.q) / 350)) : 1;
  const maxChips = (max: number) => Math.round(WEALTH.min + (max - WEALTH.min) * chipScale);
  const markersOf = (p: Player): Marker[] =>
    playing ? ([party.dealerId === p.id && 'D', party.sbId === p.id && 'SB', party.bbId === p.id && 'BB'].filter(Boolean) as Marker[]) : party.dealerId === p.id ? ['D'] : [];

  // My towers stay below the board: as many chips a tower (up to 15) as fit between my chips' spot and the board's near edge.
  const myPerTower = useMemo(() => {
    if (!cam) return 15;
    const base = project(cam, 0, 0, myZ);
    const boardNear = project(cam, 0, 0, BOARD_Z - 0.115).y;
    const th = Math.max(2, Math.round(0.026 * base.s) >= 8 ? 3 : 2);
    return Math.max(3, Math.min(15, Math.floor((base.y - boardNear - 6) / th) - 1));
  }, [cam, myZ]);

  const data: SceneData = {
    seats: seats.map(({ player: p, seat, me: mine }) => {
      const shown = shownOf(p);
      const pose = poseOf(party, p, { acting: p.id === actingId, showing: Boolean(shown) });
      return {
        id: p.id,
        seat,
        me: mine,
        seed: p.id + p.name,
        robot: Boolean(p.bot),
        pose,
        held: pose === 'hold' || pose === 'think' ? holeCount : 0,
        shown,
        stack: p.stack,
        bet: inFront(party, p),
        stackChips: wealthTarget(p.stack, richest, maxChips(mine ? WEALTH.me : WEALTH.opponent)),
        betChips: wealthTarget(inFront(party, p), richest, maxChips(WEALTH.bet)),
        markers: markersOf(p),
        acting: p.id === actingId,
      };
    }),
    board,
    winning,
    pot: Math.max(0, middle),
    potChips: wealthTarget(Math.max(0, middle), richest, maxChips(WEALTH.bet)),
    dealerSeat: seats.find((s) => s.player.id === party.dealerId)?.seat ?? null,
    hands,
    myZ,
    myPerTower,
  };

  /* ---------- motion: cards dealt in, bets slid into the pot, folds tossed, shown cards turned over ---------- */
  const motion = useRef<Motion>({ dealt: new Map(), sweeps: [], folds: [] });
  const seen = useRef<{ hand: number; board: number; bets: Map<string, number>; folded: Set<string> } | null>(null);
  const boardCount = board.filter(Boolean).length;
  const betKey = party.players.map((p) => `${p.id}:${inFront(party, p)}`).join(',');
  const foldKey = party.players.filter((p) => p.folded).map((p) => p.id).join(',');
  const latest = useRef({ data, cam, revealed });
  latest.current = { data, cam, revealed };
  useEffect(() => {
    const now = performance.now();
    const before = seen.current;
    const bets = new Map(party.players.map((p) => [p.id, inFront(party, p)]));
    const folded = new Set(foldKey ? foldKey.split(',') : []);
    seen.current = { hand: party.handNo, board: boardCount, bets, folded };
    const c = latest.current.cam;
    if (!before || still || !c) return;
    const m = motion.current;
    if (before.hand !== party.handNo) {
      motion.current = { dealt: new Map(), sweeps: [], folds: [] };
      return;
    }
    for (let i = before.board; i < boardCount; i++) m.dealt.set(i, now + (i - before.board) * 160);
    for (const { player: p, seat, me: mine } of arrangeSeats(party.players, meIndex)) {
      const was = before.bets.get(p.id) ?? 0;
      if (was > 0 && (bets.get(p.id) ?? 0) === 0) {
        const chipsFor = wealthTarget(was, Math.max(1, ...party.players.map((x) => x.stack)), maxChips(WEALTH.bet));
        m.sweeps.push({ from: mine ? spots(seat, true, myZ).bet : onFelt(seat, BET_INSET), amount: was, chips: chipsFor, start: now });
      }
      if (folded.has(p.id) && !before.folded.has(p.id)) {
        if (mine) {
          const hb = latest.current.data.hands;
          if (hb) {
            const box = handsBox(c, hb);
            m.folds.push({ from: { x: box.x + box.w / 2, y: box.y + box.h * 0.35 }, count: holeCount, start: now, size: hb.cw });
          }
        } else {
          const person = personAt(c, seat);
          m.folds.push({ from: { x: person.x, y: person.y - person.height * 0.35 }, count: holeCount, start: now, size: Math.max(4, Math.round(person.height * 0.2)) });
        }
      }
    }
    // Only when the hand, the board, the bets or the folds change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party.handNo, boardCount, betKey, foldKey]);

  /* ---------- events: all-ins, cards shown, the pot won; worked out from snapshots and played in order ---------- */
  const queue = useRef(new AnimQueue());
  const lastSnapshot = useRef<Party | null>(null);
  const badges = useRef<{ id: string; start: number }[]>([]);
  useEffect(() => {
    const prev = lastSnapshot.current;
    lastSnapshot.current = structuredClone(party);
    if (prev && prev.handNo !== party.handNo) queue.current.clear();
    const events = diffSnapshots(prev, party);
    // Reduced motion: skip the animations; the table already shows how things ended.
    if (still) queue.current.markSeen(events);
    else queue.current.push(events);
  }, [party, still]);
  // The hand-name pill over the winner while the pot goes to them.
  const [winnerPill, setWinnerPill] = useState<{ id: string; name: string } | null>(null);
  const pillShown = useRef<string | null>(null);
  const lastStart = useRef(0);

  /* ---------- drawing: ~12 frames a second, paused while the tab is hidden; one still frame with reduced motion ---------- */
  const paint = useRef((now: number, moving: boolean) => {
    const ctx = canvas.current?.getContext('2d');
    const { data: d, cam: c } = latest.current;
    if (!ctx || !c) return;
    const m = motion.current;
    m.sweeps = m.sweeps.filter((s) => now - s.start < SWEEP_MS);
    m.folds = m.folds.filter((f) => now - f.start < FOLD_MS);
    for (const [i, t] of m.dealt) if (now - t > DEAL_MS) m.dealt.delete(i);
    // Chips still sliding in aren't in the pot yet.
    const sliding = m.sweeps.reduce((sum, s) => sum + s.amount, 0);
    const started = performance.now();
    // What's playing: start-of-event effects (badge, clatter, the winner's pill) happen once.
    // Nothing starts while an all-in runout is still turning over the board: it would give the result away.
    const playing = latest.current.revealed || queue.current.pending().length === 0 ? queue.current.step(now) : null;
    if (playing && playing.start !== lastStart.current) {
      lastStart.current = playing.start;
      if (playing.event.type === 'allin') {
        badges.current.push({ id: playing.event.id, start: now });
        if (!loadMuted()) clatter();
      }
    }
    const e = playing?.event;
    const pill = e?.type === 'potToWinner' && e.name && playing!.t < 0.98 ? `${e.winners[0].id}|${e.name}` : null;
    if (pill !== pillShown.current) {
      pillShown.current = pill;
      setWinnerPill(pill ? { id: pill.split('|')[0], name: pill.split('|')[1] } : null);
    }
    badges.current = badges.current.filter((b) => now - b.start < BADGE_MS);
    const view: AnimView = { playing, pending: queue.current.pending(), badges: badges.current };
    const shownData = applyPending({ ...d, pot: Math.max(0, d.pot - sliding) }, view);
    drawScene(ctx, c, shownData, m, now, moving ? (seed) => idle(seed, now) : () => STILL, overlayFor(ctx, c, shownData, view, now));
    // /dev/table shows how long frames take.
    const stats = (window as { __sceneStats?: number[] }).__sceneStats;
    if (stats) stats.push(performance.now() - started);
  });
  useEffect(() => {
    if (!cam || still) return;
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 1000 / 12) return;
      last = now;
      paint.current(now, true);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(loop);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', start);
    };
  }, [cam, still]);
  // Reduced motion: no loop, just a fresh still frame whenever something changes.
  useEffect(() => {
    if (cam && still) paint.current(performance.now(), false);
  });

  /* ---------- DOM labels over the canvas ---------- */
  const q = size?.q ?? 1;
  const at = (x: number, y: number): CSSProperties => ({ left: Math.round(x * q), top: Math.round(y * q) });
  const lobbyNow = Boolean(lobby) && !playing && party.handNo === 0;
  const dealer = party.players.find((p) => p.id === party.dealerId);
  const canDeal = Boolean(meId && (meId === party.dealerId || meId === party.hostId));
  const handsAt = cam && hands ? handsBox(cam, hands) : null;
  // My turn's countdown sits in the pill above my cards (my name plate is gone).
  const myTimer =
    me && me.id === actingId && party.turnDeadline && party.settings.actionTimer > 0 ? (
      <TimerRing deadline={party.turnDeadline} seconds={party.settings.actionTimer} />
    ) : null;

  // Where each seat's labels go, in CSS pixels.
  const anchors = cam
    ? seats.map(({ player: p, seat, me: isMe }) => {
        const bet = inFront(party, p);
        const a = seatAnchors(
          cam,
          { seat, me: isMe, stack: p.stack, bet, stackChips: wealthTarget(p.stack, richest, maxChips(isMe ? WEALTH.me : WEALTH.opponent)), betChips: wealthTarget(bet, richest, maxChips(WEALTH.bet)) },
          myZ,
          myPerTower,
        );
        const x = Math.min(Math.max(a.head.x * q, PLATE_HALF), cam.w * q - PLATE_HALF);
        return { ...a, plate: { x, y: a.head.y * q, lift: 0 }, stackAt: { x: a.stack.x * q, y: a.stack.bottom * q } };
      })
    : [];
  // Stacks too close together for their own labels: the total goes on the player's plate instead.
  const crowded = anchors.some((a, i) =>
    anchors.some((b, j) => i > 0 && j > 0 && i !== j && Math.abs(a.stackAt.x - b.stackAt.x) < 52 && Math.abs(a.stackAt.y - b.stackAt.y) < 22),
  );
  // Name plates that would overlap a neighbour's are lifted, a plate's height at a time, into the room above.
  const PLATE = { w: crowded ? 62 : 76, h: crowded ? 40 : 30 };
  const placed: { x: number; y: number }[] = [];
  anchors
    .map((a, i) => ({ a, i }))
    .filter(({ i }) => i > 0)
    .sort((m, n) => m.a.plate.x - n.a.plate.x)
    .forEach(({ a }) => {
      const clashing = () => placed.find((o) => Math.abs(o.x - a.plate.x) < PLATE.w && Math.abs(o.y - (a.plate.y - a.plate.lift)) < PLATE.h);
      // Lift a plate's height at a time, but never off the top of the scene.
      while (clashing() && a.plate.lift < PLATE.h * 3 && a.plate.y - a.plate.lift - PLATE.h * 2 >= 0) a.plate.lift += PLATE.h;
      // No room above (short screens): slide it sideways, clear of the plate it hits.
      const maxX = cam ? cam.w * q - PLATE_HALF : 0;
      for (let tries = 0, hit = clashing(); hit && tries < 6; tries++, hit = clashing()) {
        // Right of the plate it hits, or left of it when that runs off the edge.
        const right = hit.x + PLATE.w + 2;
        a.plate.x = right <= maxX ? right : Math.max(PLATE_HALF, hit.x - PLATE.w - 2);
      }
      placed.push({ x: a.plate.x, y: a.plate.y - a.plate.lift });
    });

  return (
    <div className="scene" ref={box} data-cards={cardsMode}>
      {size && (
        <canvas ref={canvas} className="sceneCanvas" width={size.w} height={size.h} style={{ width: size.w * q, height: size.h * q }} aria-hidden="true" />
      )}
      {cam && (
        <>
          <ul className="sceneSeats" aria-label="Players">
            {seats.map(({ player: p, me: isMe }, k) => {
              const bet = inFront(party, p);
              const a = anchors[k];
              const acting = p.id === actingId;
              const stackOnPlate = crowded && !isMe;
              const shown = isMe ? null : shownOf(p);
              const { undrawn } = chipTowers(p.stack);
              return (
                <li key={p.id} className="seatGroup" aria-label={seatLabel(party, p, acting, shown)}>
                  {!isMe && (
                  <Plate
                    party={party}
                    p={p}
                    acting={acting}
                    me={isMe}
                    won={winners.some((r) => r.id === p.id)}
                    style={isMe ? undefined : ({ left: Math.round(a.plate.x), top: Math.round(a.plate.y - a.plate.lift), '--lift': `${a.plate.lift}px` } as CSSProperties)}
                    stack={stackOnPlate && p.stack > 0 ? chips(p.stack) : null}
                    compact={crowded}
                  />
                  )}
                  {p.stack > 0 && !stackOnPlate && (
                    <span className="chipLabel" data-me={isMe} style={at(isMe ? a.stack.left : a.stack.right, a.stack.bottom)} aria-hidden="true">
                      {chips(p.stack)}
                      {undrawn > 0 && <small>+{chips(undrawn)}</small>}
                    </span>
                  )}
                  {bet > 0 && (isMe || !crowded) && (
                    <span className="chipLabel bet" style={at(a.bet.right, a.bet.bottom)} aria-hidden="true">
                      {chips(bet)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* The winning hand's name, over the winner while the pot goes to them. */}
          {winnerPill &&
            (() => {
              const k = seats.findIndex((x) => x.player.id === winnerPill.id);
              if (k < 0) return null;
              const mine = seats[k].me;
              const pos = mine && handsAt ? at(handsAt.x + handsAt.w / 2, handsAt.y - 34 / q) : { left: Math.round(anchors[k].plate.x), top: Math.round(anchors[k].plate.y - anchors[k].plate.lift - 34) };
              return (
                <p className="winnerPill" style={pos} role="status">
                  {winnerPill.name}
                </p>
              );
            })()}

          {/* My hands: "You have" just above them; press and hold the cards (or Space) to lower them. */}
          {handsAt && (myHand || myTimer) && (
            <p className="myHand handsLabel" style={at(handsAt.x + handsAt.w / 2, handsAt.y)} aria-live="polite">
              {myTimer && (
                <span className="myTimer" aria-hidden="true">
                  {myTimer}
                </span>
              )}
              {myHand && (
                <>
                  You have: <b>{myHand}</b>
                </>
              )}
            </p>
          )}
          {handsAt && holding && (
            <button
              type="button"
              className="peekArea"
              style={{ ...at(handsAt.x, handsAt.y), width: Math.round(handsAt.w * q), height: Math.round(handsAt.h * q) }}
              aria-pressed={peek}
              aria-label={`Your cards: ${myCards!.map(cardText).join(', ')}. Press and hold to lower them.`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setPeek(true);
              }}
              onPointerUp={() => setPeek(false)}
              onPointerCancel={() => setPeek(false)}
              onLostPointerCapture={() => setPeek(false)}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}

          {/* The middle of the felt: the lobby, a deal prompt, or the pot's total. */}
          {lobbyNow ? (
            <div className="sceneCentre" style={at(cam.w / 2, project(cam, 0, 0, 0.05).y)}>
              {lobby}
            </div>
          ) : awaiting ? (
            <div className="sceneCentre" style={at(cam.w / 2, project(cam, 0, 0, 0.05).y)}>
              <div className="dealPrompt" role="status">
                <p className="dealTitle">Deal the {awaiting}</p>
                <p>{DEAL_HOW[awaiting]}</p>
                {canDeal ? (
                  <button className="btn green" disabled={busy || !act} onClick={() => act?.({ type: 'dealt' })}>
                    {awaiting[0].toUpperCase() + awaiting.slice(1)} is out
                  </button>
                ) : (
                  <p className="dim">
                    Waiting for {dealer?.name ?? 'the dealer'} to deal the {awaiting}
                  </p>
                )}
              </div>
            </div>
          ) : (
            (playing ? total > 0 : lastHand) && (
              <div
                className="potLabel3d"
                // During a hand, just under the pot's chips; between hands (no chips), where the pot sits.
                data-centred="true"
                style={playing ? at(project(cam, POT_SPOT.x, 0, POT_SPOT.z - 0.09).x, project(cam, POT_SPOT.x, 0, POT_SPOT.z - 0.09).y) : at(project(cam, POT_SPOT.x - 0.02, 0, BOARD_Z).x, project(cam, 0, 0, BOARD_Z).y)}
                aria-live="polite"
              >
                <b>{chips(playing ? total : lastHand?.kind === 'hand' ? lastHand.pot : 0)}</b>
                {/* Between hands just the amount: the feed already says who won it. */}
                {playing ? <span>{party.phase === 'showdown' ? 'Showdown' : 'Pot'}</span> : <span className="sr">{potLine}</span>}
                {sidePots.length > 1 && (
                  <span className="sidePots">
                    {sidePots.map((pot, i) => (
                      <span key={i}>
                        {i === 0 ? 'Main' : `Side ${i}`} {chips(pot.amount)}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )
          )}
          {cardsMode && party.board.length > 0 && <p className="sr">Board: {party.board.slice(0, visible).join(' ')}</p>}
        </>
      )}
    </div>
  );
}

function roles(party: Party, p: Player): [string, string, string][] {
  return [
    party.dealerId === p.id && ['D', 'dealer', 'Dealer'],
    party.sbId === p.id && ['SB', 'blind', 'Small blind'],
    party.bbId === p.id && ['BB', 'blind', 'Big blind'],
  ].filter(Boolean) as [string, string, string][];
}

function seatLabel(party: Party, p: Player, acting: boolean, shown: Card[] | null): string {
  const playing = party.phase !== 'idle';
  return [
    p.name,
    shown && `shows ${shown.map(cardText).join(' ')}`,
    `${chips(p.stack)} chips`,
    ...(playing ? roles(party, p).map((r) => r[2]) : []),
    acting && 'to act',
    playing && p.folded && 'folded',
    playing && p.lastAction && !p.folded && p.lastAction,
  ]
    .filter(Boolean)
    .join(', ');
}

/** A seat's name plate: name, AI badge, D/SB/BB, the latest move, and the turn arrow with its timer. */
function Plate({
  party,
  p,
  acting,
  me,
  won,
  style,
  stack,
  compact,
}: {
  party: Party;
  p: Player;
  acting: boolean;
  me: boolean;
  won: boolean;
  style?: CSSProperties;
  /** The stack total, when the table is too crowded to label it by the chips. */
  stack?: string | null;
  compact?: boolean;
}) {
  const playing = party.phase !== 'idle';
  let status: ReactNode = null;
  if (playing) {
    if (!p.inHand) status = <span className="dim">{p.stack === 0 ? 'Out' : 'Next hand'}</span>;
    else if (p.folded) status = <span className="tag folded">Folded</span>;
    else if (p.stack === 0) status = <span className="tag allin">All in</span>;
    else if (p.lastAction) status = <span className="tag move">{p.lastAction}</span>;
  } else if (p.stack === 0) {
    status = <span className="dim">Out</span>;
  } else if (p.lastDelta !== null && party.handNo > 0) {
    status = <span className={p.lastDelta > 0 ? 'up' : p.lastDelta < 0 ? 'down' : 'dim'}>{p.lastDelta === 0 ? 'Even' : signed(p.lastDelta)}</span>;
  }
  const timer = acting && party.turnDeadline && party.settings.actionTimer > 0 && (
    <TimerRing deadline={party.turnDeadline} seconds={party.settings.actionTimer} />
  );
  return (
    <div
      className="plate"
      style={style}
      data-me={me}
      data-turn={acting}
      data-won={won}
      data-compact={compact}
      data-out={playing ? !p.inHand || p.folded : p.stack === 0}
    >
      {acting && (
        <span className="turnArrow" aria-hidden="true">
          {timer}
          <span className="tvPointer" />
        </span>
      )}
      <span className="plateName">
        {p.bot && (
          <span className="tag botTag" title={`Computer player (${p.bot.level})`}>
            AI
          </span>
        )}
        {p.name}
      </span>
      {stack && <span className="plateStack">{stack}</span>}
      <span className="plateTags">
        {acting && p.bot ? (
          <span className="tag thinking" aria-label="thinking">
            thinking<i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        ) : (
          status
        )}
      </span>
    </div>
  );
}
