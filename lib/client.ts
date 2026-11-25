'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from './cards';
import { logKey, mergeLog } from './game';
import type { Action, Party } from './types';

export interface Seat {
  playerId: string;
  token: string;
}

const seatKey = (code: string) => `pixelpot:seat:${code}`;
const NAME_KEY = 'pixelpot:name';

export function loadSeat(code: string): Seat | null {
  try {
    const raw = localStorage.getItem(seatKey(code));
    const seat = raw ? (JSON.parse(raw) as Seat) : null;
    return seat?.playerId && seat?.token ? seat : null;
  } catch {
    return null;
  }
}

export function saveSeat(code: string, seat: Seat | null) {
  try {
    if (seat) localStorage.setItem(seatKey(code), JSON.stringify(seat));
    else localStorage.removeItem(seatKey(code));
  } catch {
    /* private mode: the seat lasts until the tab closes */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export interface ApiResult {
  party?: Party;
  /** This seat's own hole cards (cards mode), sent only with a valid seat header. */
  myCards?: Card[] | null;
  playerId?: string;
  token?: string;
  unchanged?: boolean;
  needsDatabase?: boolean;
  /** Set when `party.log` holds only the entries after this one (see logSince). */
  logAfter?: string;
  error?: string;
  status: number;
}

/** Call the API. The seat, if any, goes in the `x-seat` header, never in the URL. */
export async function api(path: string, body?: unknown, seat?: Seat | null): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (seat) headers['x-seat'] = `${seat.playerId}.${seat.token}`;
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && !json.error) json.error = 'Something went wrong. Try again.';
    return { ...json, status: res.status };
  } catch {
    return { error: "Can't reach the table. Check your connection.", status: 0 };
  }
}

export type Sync = 'loading' | 'ok' | 'offline' | 'missing';

const POLL_MS = 1500;

/**
 * Keeps a live copy of a table by polling for new versions. With a seat, the
 * server also sends that seat's hole cards; they only change when a hand
 * starts, which bumps the version, so the "unchanged" shortcut is safe.
 */
export function useParty(code: string, seat: Seat | null) {
  const [party, setParty] = useState<Party | null>(null);
  const [myCards, setMyCards] = useState<Card[] | null>(null);
  const [sync, setSync] = useState<Sync>('loading');
  const [needsDatabase, setNeedsDatabase] = useState(false);
  const version = useRef(0);
  const log = useRef<Party['log']>([]);
  const lastLog = () => (log.current.length ? logKey(log.current[log.current.length - 1]) : '');

  const apply = useCallback((next: Party, cards?: Card[] | null, logAfter?: string) => {
    if (next.version < version.current) return;
    if (logAfter) {
      const merged = mergeLog(log.current, logAfter, next.log);
      // Our log no longer lines up with the server's: fetch the whole table on the next poll.
      if (!merged) return void (version.current = 0);
      next = { ...next, log: merged };
    }
    version.current = next.version;
    log.current = next.log;
    setParty(next);
    setMyCards(cards ?? null);
  }, []);

  // A new seat (sitting down, or a seat link) needs a full read to pick up its cards.
  const seatKeyNow = seat ? `${seat.playerId}.${seat.token}` : '';
  useEffect(() => {
    version.current = 0;
  }, [seatKeyNow]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      clearTimeout(timer);
      if (stopped) return;
      if (!document.hidden) {
        const res = await api(`/api/party/${code}?v=${version.current}&log=${encodeURIComponent(lastLog())}`, undefined, seat);
        if (stopped) return;
        if (res.status === 404) {
          setSync('missing');
          return;
        }
        if (res.party) apply(res.party, res.myCards, res.logAfter);
        if (res.party || res.unchanged) {
          setSync('ok');
          setNeedsDatabase(Boolean(res.needsDatabase));
        } else {
          setSync((s) => (s === 'loading' ? 'loading' : 'offline'));
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };

    const onVisible = () => {
      if (!document.hidden) tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [code, apply, seatKeyNow]);

  /** Send an action for `seat` and show the table that comes back. */
  const send = useCallback(
    async (seat: Seat, action: Action) => {
      const res = await api(`/api/party/${code}/action`, { action, log: lastLog() }, seat);
      if (res.party) apply(res.party, res.myCards, res.logAfter);
      return res;
    },
    [apply, code],
  );

  return { party, myCards, sync, needsDatabase, apply, send };
}

export const chips = (n: number) => n.toLocaleString('en-US');
export const signed = (n: number) => (n > 0 ? `+${chips(n)}` : n < 0 ? `-${chips(-n)}` : '0');

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const MUTE_KEY = 'pixelpot:muted';

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode: the setting lasts until the tab closes */
  }
}

let audio: AudioContext | null = null;

/** A short two-note square-wave blip. No audio files; silently does nothing if audio is blocked. */
export function blip() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(990, t + 0.07);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  } catch {
    /* no audio on this device */
  }
}
