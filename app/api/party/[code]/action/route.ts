import { applyAction, GameError, normalizeCode } from '@/lib/game';
import { fail, handle, readJson, sameToken, seatHeader, shuffledDeck, viewBody } from '@/lib/server';
import { store } from '@/lib/store';
import type { Action } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** A seated player does something: bet, fold, start a hand… The seat comes in the `x-seat` header. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = normalizeCode((await ctx.params).code);
    const body = await readJson(req);
    // Older open tabs send the seat in the body; accept that until they reload.
    const seat = seatHeader(req) ?? { playerId: String(body.playerId ?? ''), token: body.token };
    const action = body.action as Action;
    // Shuffled once per request, outside update(), which may retry.
    const deck = action?.type === 'start_hand' ? shuffledDeck() : undefined;
    const rec = await store.update(code, (r) => {
      if (!sameToken(r.tokens[seat.playerId], seat.token)) {
        throw new GameError("You're not seated at this table any more.");
      }
      applyAction(r, seat.playerId, action, Date.now(), deck);
    });
    if (!rec) return fail('This table has closed.', 404);
    return viewBody(rec, seat.playerId, {}, body.log);
  });
}
