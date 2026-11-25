/*
 * The table's animations: all-ins, cards thrown down at showdown, and the pot
 * going to the winner. The scene is drawn from the latest snapshot (the end
 * state); while an event waits or plays, `applyPending` shows what came before
 * it, and `drawOverlay` draws what's moving.
 */
import type { Card } from '../../lib/cards';
import { hashText } from '../../lib/bot';
import type { Playing, SceneEvent } from './events';
import {
  BOARD_CARD,
  drawChips,
  drawFlatCard,
  handsBox,
  personAt,
  shownSpots,
  type SceneData,
  type SceneSeat,
} from './draw';
import { BONE, INK, LETTERS, offscreen, stamp } from './glyphs';
import { POT_SPOT, onFelt, spots } from './layout';
import { RAIL_H, project, type Camera, type Vec } from './project';

type Ctx = CanvasRenderingContext2D;

export interface AnimView {
  playing: Playing | null;
  /** Events not finished yet (the one playing first). */
  pending: SceneEvent[];
  /** ALL IN badges and when they popped (they outlive their event). */
  badges: { id: string; start: number }[];
}

export const BADGE_MS = 1300;
const SHAKE_MS = 150;

const ease = (t: number) => 1 - (1 - t) ** 2;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* --------------------------- the state before events -------------------------- */

/**
 * The snapshot as it looked before the waiting (or playing) events: players
 * still holding the cards they're about to show, all-in chips still in their
 * stacks, the pot in the middle and the winners' stacks not yet grown.
 */
export function applyPending(data: SceneData, view: AnimView): SceneData {
  if (!view.pending.length) return data;
  const seats = data.seats.map((s) => ({ ...s }));
  const byId = new Map(seats.map((s) => [s.id, s]));
  const moving = new Map<string, number>();
  let pot = data.pot;
  let potChips = data.potChips;
  let hands = data.hands;
  let winning = data.winning;
  let glow = 0;
  let handsLift = 0;
  const playing = view.playing;

  for (const e of view.pending) {
    const now = playing?.event === e ? playing.t : -1; // -1: waiting
    if (e.type === 'allin') {
      const s = byId.get(e.id);
      if (!s) continue;
      // Waiting: the chips are still in the stack. Playing: they're in motion (drawn by the overlay).
      moving.set(e.id, Math.min(s.bet, e.amount));
      if (now < 0) s.stack += e.amount;
      if (s.me && now >= 0) handsLift = -6 * Math.sin(clamp01((now - 0.05) / 0.35) * Math.PI);
    } else if (e.type === 'show') {
      const s = byId.get(e.id);
      if (!s) continue;
      // Until they let go, they still hold the cards; once thrown, the overlay draws them in the air.
      if (now < 0.3) {
        s.shown = null;
        if (s.me) hands = data.hands ? { ...data.hands, mode: 'hold', cards: e.cards } : hands;
        else {
          s.held = e.cards.length;
          s.pose = 'hold';
        }
        if (s.me && now >= 0) handsLift = -8 * clamp01(now / 0.25);
      } else if (now < 1) {
        s.shown = null;
        if (s.me) handsLift = now < 0.45 ? 6 * Math.sin(((now - 0.3) / 0.15) * Math.PI) : 0;
      }
    } else if (e.type === 'potToWinner') {
      const total = e.winners.reduce((sum, w) => sum + w.amount, 0);
      // The pot stays in the middle and the winners' stacks don't grow until the chips arrive.
      if (now < 0.45) {
        pot = Math.max(pot, total);
        potChips = Math.max(potChips, data.potChips || 8);
        for (const w of e.winners) {
          const s = byId.get(w.id);
          if (s) s.stack = Math.max(0, s.stack - w.amount);
        }
      } else if (now < 1) {
        pot = 0;
        for (const w of e.winners) {
          const s = byId.get(w.id);
          if (s) s.stack = Math.max(0, s.stack - w.amount);
        }
      }
      // No winning highlight until the showdown is over; then the winning cards glow.
      if (now < 0) winning = new Set();
      else glow = now < 0.45 ? 0.6 + 0.4 * Math.sin(now * 40) : Math.max(0, 1 - (now - 0.45) / 0.3);
    }
  }
  // While anyone still has cards to show, nobody's cards glow yet.
  if (view.pending.some((e) => e.type === 'show')) winning = new Set();
  return { ...data, seats, pot, potChips, hands, winning, glow, handsLift, moving };
}

/* --------------------------------- overlay -------------------------------- */

/** Where an opponent's hands hold their cards, in the world: just above the rail in front of them. */
function handsPoint(s: SceneSeat): Vec & { y: number } {
  const r = onFelt(s.seat, -0.05);
  return { x: r.x, y: RAIL_H + 0.1, z: r.z };
}

/** My cards leave from below the bottom of the screen, near the camera. */
const MY_HANDS = { x: 0, y: 0.32, z: -1.05 };

/** A one-frame dust puff where a card lands. */
function puff(ctx: Ctx, cam: Camera, at: Vec, t: number) {
  const p = project(cam, at.x, 0, at.z);
  const r = Math.max(3, Math.round(0.05 * p.s));
  ctx.globalAlpha = 0.55 * (1 - t);
  ctx.fillStyle = BONE;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.fillRect(Math.round(p.x + Math.cos(a) * r * (0.8 + t)), Math.round(p.y + Math.sin(a) * r * 0.45 * (0.8 + t)), 1, 1);
  }
  ctx.globalAlpha = 1;
}

/** Cards in flight from a player's hands to the felt: lift, flip face up in the air, land with a bounce. */
function drawThrow(ctx: Ctx, cam: Camera, data: SceneData, s: SceneSeat, cards: Card[], t: number) {
  const land = shownSpots(cam, data, s, cards);
  const from = s.me ? MY_HANDS : handsPoint(s);
  if (t < 0.3) {
    // Lifting in the hands (opponents): drawn by the person's pose; mine rise with my hands.
    return;
  }
  const u = clamp01((t - 0.3) / 0.5);
  const travel = easeInOut(u);
  const turn = clamp01((t - 0.35) / 0.3);
  const settle = clamp01((t - 0.8) / 0.2);
  for (const c of land) {
    const at =
      t < 0.8
        ? {
            x: lerp(from.x + (c.at.x - land[0].at.x), c.at.x, travel),
            y: lerp(from.y, 0, travel) + 0.08 * Math.sin(travel * Math.PI),
            z: lerp(from.z, c.at.z, travel),
          }
        : { ...c.at, y: 0.012 * Math.abs(Math.sin(settle * Math.PI * 1.5)) * (1 - settle) };
    const size = s.me && t < 0.8 ? { w: lerp(BOARD_CARD.w * 1.6, c.size.w, travel), d: lerp(BOARD_CARD.d * 1.6, c.size.d, travel) } : c.size;
    // In flight it's a plain flipping card; it lands as the flat sprite, glyphs whole.
    drawFlatCard(ctx, cam, c.card, at, size, { turn: t < 0.8 ? Math.min(0.99, turn) : 1 });
  }
  if (t >= 0.8 && t < 0.87) for (const c of land) puff(ctx, cam, c.at, (t - 0.8) / 0.07);
}

/** A pile of chips sliding along a curve, towers leaning into the move and wobbling as they stop. */
function drawSlide(ctx: Ctx, cam: Camera, amount: number, chips: number, from: Vec, to: Vec, t: number) {
  const u = ease(clamp01(t / 0.75));
  // A gentle curve: bulge sideways a little on the way.
  const at = { x: lerp(from.x, to.x, u) + Math.sin(u * Math.PI) * 0.04, z: lerp(from.z, to.z, u) };
  const dir = Math.sign(project(cam, to.x, 0, to.z).x - project(cam, from.x, 0, from.z).x) || 1;
  const settle = clamp01((t - 0.75) / 0.25);
  const lean = t < 0.75 ? 0.22 * Math.sin(u * Math.PI) * dir : 0.12 * Math.sin(settle * Math.PI * 4) * (1 - settle) * dir;
  const base = project(cam, at.x, 0, at.z);
  ctx.save();
  ctx.translate(Math.round(base.x), Math.round(base.y));
  ctx.transform(1, 0, -lean, 1, 0, 0);
  ctx.translate(-Math.round(base.x), -Math.round(base.y));
  drawChips(ctx, cam, amount, at, chips);
  ctx.restore();
}

/** The gold ALL IN badge (made once). */
let badge: HTMLCanvasElement | null | undefined;
function badgeImage(): HTMLCanvasElement | null {
  if (badge !== undefined) return badge;
  const text = 'ALL IN';
  const w = text.length * 4 + 7;
  const c = offscreen(w, 11);
  if (c) {
    const t = c.getContext('2d')!;
    t.fillStyle = INK;
    t.fillRect(1, 0, w - 2, 11);
    t.fillRect(0, 1, w, 9);
    t.fillStyle = '#f5b83d';
    t.fillRect(1, 1, w - 2, 9);
    t.fillStyle = '#ffe3a1';
    t.fillRect(2, 1, w - 4, 1);
    [...text].forEach((ch, k) => ch !== ' ' && stamp(t, LETTERS[ch], 4 + k * 4, 3, INK));
  }
  badge = c;
  return c;
}

/** Badge scale over time: pops 0 → 1.2 → 1, holds, then shrinks away. */
function badgeScale(ms: number): number {
  if (ms < 160) return (ms / 160) * 1.2;
  if (ms < 260) return 1.2 - ((ms - 160) / 100) * 0.2;
  if (ms < BADGE_MS - 120) return 1;
  return Math.max(0, (BADGE_MS - ms) / 120);
}

/**
 * Everything the playing event moves, in two layers: on the felt (under the
 * near rail and my hands), and on top (badges). Plus the screen shake.
 */
export function overlayFor(ctx: Ctx, cam: Camera, data: SceneData, view: AnimView, now: number) {
  const p = view.playing;
  const byId = new Map(data.seats.map((s) => [s.id, s]));
  const felt = () => {
    if (!p) return;
    const e = p.event;
    if (e.type === 'allin') {
      const s = byId.get(e.id);
      if (!s) return;
      const sp = spots(s.seat, s.me, data.myZ);
      drawSlide(ctx, cam, Math.min(s.bet, e.amount), s.betChips || 8, sp.stack, sp.bet, p.t);
    } else if (e.type === 'show') {
      const s = byId.get(e.id);
      if (s) drawThrow(ctx, cam, data, s, e.cards, p.t);
    } else if (e.type === 'potToWinner' && p.t >= 0.45) {
      // The pot splits and slides to each winner, by share.
      const total = Math.max(1, e.winners.reduce((sum, w) => sum + w.amount, 0));
      for (const w of e.winners) {
        const s = byId.get(w.id);
        if (!s) continue;
        const to = spots(s.seat, s.me, data.myZ).stack;
        const chips = Math.max(1, Math.round(((data.potChips || 12) * w.amount) / total));
        drawSlide(ctx, cam, w.amount, chips, POT_SPOT, to, (p.t - 0.45) / 0.55);
      }
    }
  };
  const top = () => {
    const img = badgeImage();
    if (!img) return;
    for (const b of view.badges) {
      const ms = now - b.start;
      if (ms < 0 || ms >= BADGE_MS) continue;
      const s = byId.get(b.id);
      if (!s) continue;
      let x: number;
      let y: number;
      if (s.me && data.hands) {
        const box = handsBox(cam, data.hands);
        // Above my hands and the "You have" pill.
        [x, y] = [box.x + box.w / 2, box.y - Math.round(box.h * 0.32)];
      } else {
        // Over their chest, under their name plate.
        const person = personAt(cam, s.seat);
        [x, y] = [person.x, person.y - person.height * 0.35];
      }
      const scale = badgeScale(ms);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      if (w > 0 && h > 0) ctx.drawImage(img, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    }
  };
  // A tiny screen shake right as an all-in lands.
  const sinceAllin = p?.event.type === 'allin' ? now - p.start : Infinity;
  const shake = sinceAllin < SHAKE_MS ? { x: Math.round(Math.sin(sinceAllin / 12) * 2), y: Math.round(Math.cos(sinceAllin / 9) * 1) } : { x: 0, y: 0 };
  return { felt, top, shake };
}

/** A white-noise chip clatter: a few short bursts. */
export function clatter() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const start = ac.currentTime;
    for (let k = 0; k < 5; k++) {
      const len = Math.floor(ac.sampleRate * 0.03);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 3000 + (hashText(String(k)) % 2000);
      const gain = ac.createGain();
      gain.gain.value = 0.18;
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(start + k * 0.045 + (k % 2) * 0.01);
    }
    setTimeout(() => ac.close(), 600);
  } catch {
    /* No sound: fine. */
  }
}

