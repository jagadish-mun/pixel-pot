import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH, GameError } from './game';
import { storageMode } from './store';
import type { Party } from './types';

export const newId = () => randomBytes(5).toString('hex');
export const newToken = () => randomBytes(18).toString('base64url');

export function newCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
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

export function partyBody(party: Party, extra: Record<string, unknown> = {}) {
  return ok({ party, ...extra });
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
