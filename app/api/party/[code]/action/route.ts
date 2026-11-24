import { applyAction, GameError, normalizeCode } from '@/lib/game';
import { fail, handle, partyBody, readJson, sameToken } from '@/lib/server';
import { store } from '@/lib/store';
import type { Action } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** A seated player does something: bet, fold, start a hand, award the pot… */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = normalizeCode((await ctx.params).code);
    const body = await readJson(req);
    const playerId = String(body.playerId ?? '');
    const rec = await store.update(code, (r) => {
      if (!sameToken(r.tokens[playerId], body.token)) {
        throw new GameError("You're not seated at this table any more.");
      }
      applyAction(r, playerId, body.action as Action, Date.now());
    });
    if (!rec) return fail('This table has closed.', 404);
    return partyBody(rec.party);
  });
}
