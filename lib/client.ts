'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  playerId?: string;
  token?: string;
  unchanged?: boolean;
  needsDatabase?: boolean;
  error?: string;
  status: number;
}

export async function api(path: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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

/** Keeps a live copy of a table by polling for new versions. */
export function useParty(code: string) {
  const [party, setParty] = useState<Party | null>(null);
  const [sync, setSync] = useState<Sync>('loading');
  const [needsDatabase, setNeedsDatabase] = useState(false);
  const version = useRef(0);

  const apply = useCallback((next: Party) => {
    if (next.version < version.current) return;
    version.current = next.version;
    setParty(next);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      clearTimeout(timer);
      if (stopped) return;
      if (!document.hidden) {
        const res = await api(`/api/party/${code}?v=${version.current}`);
        if (stopped) return;
        if (res.status === 404) {
          setSync('missing');
          return;
        }
        if (res.party) apply(res.party);
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
  }, [code, apply]);

  return { party, sync, needsDatabase, apply };
}

export function sendAction(code: string, seat: Seat, action: Action) {
  return api(`/api/party/${code}/action`, { ...seat, action });
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
