import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { fullDeck, type Card } from './cards';
import { CODE_ALPHABET, CODE_LENGTH, GameError, logSince, viewFor } from './game';
import { storageMode } from './store';
import type { PartyRecord } from './types';

export const newId = () => randomBytes(5).toString('hex');
export const newToken = () => randomBytes(18).toString('base64url');

export function newCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** A freshly shuffled deck: Fisher–Yates with crypto randomness. */
export function shuffledDeck(): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** The seat from the `x-seat` header ("playerId.token"). Seats never go in the URL. */
export function seatHeader(req: Request): { playerId: string; token: string } | null {
  const raw = req.headers.get('x-seat') ?? '';
  const dot = raw.indexOf('.');
  return dot > 0 ? { playerId: raw.slice(0, dot), token: raw.slice(dot + 1) } : null;
}

/** The player id from the `x-seat` header if its key matches this table, otherwise null (a spectator). */
export function viewerOf(req: Request, rec: PartyRecord): string | null {
  const seat = seatHeader(req);
  return seat && sameToken(rec.tokens[seat.playerId], seat.token) ? seat.playerId : null;
}

export function sameToken(a: string | undefined, b: unknown): boolean {
  if (!a || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when deployed somewhere serverless without a database, where tables can't be shared. */
const needsDatabase = storageMode === 'memory' && Boolean(process.env.VERCEL);

export function ok(body: Record<string, unknown>, status = 200) {
  return Response.json({ ...body, needsDatabase }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The table as `viewerId` may see it: public state plus only their own hole cards.
 * With `logAfter` (the last log entry the browser has), only newer log entries are sent.
 */
export function viewBody(rec: PartyRecord, viewerId: string | null, extra: Record<string, unknown> = {}, logAfter: unknown = null) {
  const view = viewFor(rec, viewerId);
  const key = typeof logAfter === 'string' && logAfter.length <= 64 ? logAfter : null;
  const newer = logSince(view.party.log, key);
  if (newer) return ok({ ...view, party: { ...view.party, log: newer }, logAfter: key, ...extra });
  return ok({ ...view, ...extra });
}

export function fail(message: string, status = 400) {
  return Response.json({ error: message, needsDatabase }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Run a handler, turning rule violations into 400s and anything else into a 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GameError) return fail(err.message, 400);
    console.error(err);
    return fail('Something went wrong on the server. Try again.', 500);
  }
}
