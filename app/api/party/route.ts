import { addBot, createParty, GameError } from '@/lib/game';
import type { BotLevel, PartyRecord } from '@/lib/types';
import { fail, handle, newCode, newId, newToken, readJson, viewBody } from '@/lib/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

/** "Play vs AI": seat 1–7 computer players at a level, or a mix of levels. */
function seatBots(rec: PartyRecord, raw: unknown, now: number) {
  if (raw === undefined) return;
  const { count, level } = (raw ?? {}) as { count?: unknown; level?: unknown };
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 7) {
    throw new GameError('Pick between 1 and 7 computer players.');
  }
  if (level !== 'mixed' && !LEVELS.includes(level as BotLevel)) throw new GameError('Pick easy, medium, hard or mixed.');
  for (let i = 0; i < count; i++) addBot(rec, level === 'mixed' ? LEVELS[i % 3] : level, now);
}

/** Host a new table. Returns the table plus the host's seat key. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const playerId = newId();
    const token = newToken();
    for (let attempt = 0; attempt < 12; attempt++) {
      const rec = createParty(
        newCode(),
        playerId,
        token,
        body.name,
        body.settings as Record<string, unknown> | undefined,
        Date.now(),
      );
      seatBots(rec, body.bots, Date.now());
      if (await store.create(rec)) return viewBody(rec, playerId, { playerId, token });
    }
    return fail("Couldn't find a free table code. Try again.", 503);
  });
}
