/*
 * Table events for the scene's animations. The browser only sees snapshots
 * from polling, so events are worked out by comparing the previous snapshot
 * with the new one, then played in order from a queue. Pure: no DOM, no clock.
 */
import type { Card } from '../../lib/cards';
import type { Party, Player } from '../../lib/types';

export type SceneEvent =
  | { type: 'allin'; hand: number; id: string; amount: number }
  | { type: 'show'; hand: number; id: string; cards: Card[] }
  | { type: 'potToWinner'; hand: number; winners: { id: string; amount: number }[]; best: Card[]; name: string | null };

/** How long each event plays (ms). */
export const EVENT_MS: Record<SceneEvent['type'], number> = { allin: 900, show: 700, potToWinner: 1400 };

/** One key per event per hand, so a re-render or reconnect never replays it. */
export const eventKey = (e: SceneEvent) => `${e.hand}:${e.type === 'potToWinner' ? 'pot' : e.id}:${e.type}`;

/** Seats in table order starting left of the dealer. */
function fromDealer(party: Party): Player[] {
  const n = party.players.length;
  const d = Math.max(0, party.players.findIndex((p) => p.id === party.dealerId));
  return Array.from({ length: n }, (_, k) => party.players[(d + 1 + k) % n]);
}

/**
 * Showdown order: the last player to bet or raise on the final street shows
 * first (the biggest of those bets), then clockwise; if everyone checked,
 * the first player left of the dealer.
 */
export function showOrder(party: Party, ids: string[]): string[] {
  const order = fromDealer(party).filter((p) => ids.includes(p.id));
  const aggressive = order.filter((p) => /^(Bet|Raise|All in)/.test(p.lastAction ?? ''));
  if (!aggressive.length) return order.map((p) => p.id);
  const first = aggressive.reduce((a, b) => (b.roundBet > a.roundBet ? b : a));
  const k = order.indexOf(first);
  return [...order.slice(k), ...order.slice(0, k)].map((p) => p.id);
}

/**
 * Events between two snapshots of one table, in the order to play them:
 * all-ins (table order), then cards turned over (showdown order), then the
 * pot going to the winner(s). `prev` null (the first snapshot) gives nothing.
 */
export function diffSnapshots(prev: Party | null, next: Party): SceneEvent[] {
  if (!prev || prev.handNo !== next.handNo || prev.phase === 'idle') return [];
  const hand = next.handNo;
  const before = new Map(prev.players.map((p) => [p.id, p]));
  const out: SceneEvent[] = [];

  // All in: a stack went to 0 as chips went in this hand.
  for (const p of fromDealer(next)) {
    const was = before.get(p.id);
    if (was && was.stack > 0 && p.stack === 0 && p.bet > was.bet) out.push({ type: 'allin', hand, id: p.id, amount: p.bet - was.bet });
  }

  // Cards turned face up.
  const newlyShown = Object.keys(next.shown).filter((id) => !prev.shown[id] && next.shown[id]?.length);
  for (const id of showOrder(next, newlyShown)) out.push({ type: 'show', hand, id, cards: next.shown[id] });

  // The hand finished: the pot goes to the winners. Card tables report each share; otherwise it's
  // whoever's stack grew (the host awards from showdown, when all the bets are already in).
  if (next.phase === 'idle') {
    const results = next.handResults.filter((r) => r.amount > 0);
    const winners = results.length
      ? results.map((r) => ({ id: r.id, amount: r.amount }))
      : next.players.map((p) => ({ id: p.id, amount: p.stack - (before.get(p.id)?.stack ?? p.stack) })).filter((w) => w.amount > 0);
    const top = [...results].sort((a, b) => b.amount - a.amount)[0];
    if (winners.length) out.push({ type: 'potToWinner', hand, winners, best: top?.best ?? [], name: top?.hand ?? null });
  }
  return out;
}

/* ---------------------------------- queue --------------------------------- */

/** Never fall more than this far behind the table. */
const MAX_LAG = 2000;
/** Further behind than this, the oldest waiting events are skipped. */
const SKIP_LAG = 5000;

export interface Playing {
  event: SceneEvent;
  /** 0 → 1 through the event. */
  t: number;
  /** When it started (ms), for effects that outlive it (the ALL IN badge). */
  start: number;
}

/**
 * Plays events one after another. If the backlog grows past ~2 s it plays
 * faster; far behind, it skips the oldest. Each event plays once per hand.
 */
export class AnimQueue {
  private waiting: SceneEvent[] = [];
  private current: { event: SceneEvent; start: number; speed: number } | null = null;
  private seen = new Set<string>();
  /** When the current backlog must be finished by. */
  private deadline = 0;

  /** Queue new events; ones already played (or queued) this hand are ignored. Returns those accepted. */
  push(events: SceneEvent[]): SceneEvent[] {
    const fresh = events.filter((e) => !this.seen.has(eventKey(e)));
    for (const e of fresh) this.seen.add(eventKey(e));
    this.waiting.push(...fresh);
    return fresh;
  }

  /** Remember events as seen without playing them (reduced motion). */
  markSeen(events: SceneEvent[]) {
    for (const e of events) this.seen.add(eventKey(e));
  }

  /** Forget everything waiting (a new hand started before they played). */
  clear() {
    this.waiting = [];
    this.current = null;
  }

  /** Events not yet finished: the one playing and the ones waiting. */
  pending(): SceneEvent[] {
    return this.current ? [this.current.event, ...this.waiting] : [...this.waiting];
  }

  /** Advance to `now` and return what's playing. */
  step(now: number): Playing | null {
    if (this.current) {
      const c = this.current;
      if ((now - c.start) * c.speed >= EVENT_MS[c.event.type]) this.current = null;
    }
    if (!this.current && this.waiting.length) {
      // Too far behind: drop the oldest waiting events (their end state is already on the table).
      while (this.waiting.length > 1 && this.backlog() > SKIP_LAG) this.waiting.shift();
      const event = this.waiting.shift()!;
      const behind = this.backlog() + EVENT_MS[event.type];
      // Everything waiting finishes within ~2 s: play faster when there's more than fits.
      if (now >= this.deadline) this.deadline = now + MAX_LAG;
      this.current = { event, start: now, speed: Math.max(1, behind / Math.max(100, this.deadline - now)) };
    }
    if (!this.current) return null;
    const c = this.current;
    return { event: c.event, t: Math.min(1, ((now - c.start) * c.speed) / EVENT_MS[c.event.type]), start: c.start };
  }

  private backlog(): number {
    return this.waiting.reduce((sum, e) => sum + EVENT_MS[e.type], 0);
  }
}
