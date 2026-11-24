import { joinParty, normalizeCode } from '@/lib/game';
import { fail, handle, newId, newToken, partyBody, readJson } from '@/lib/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Take a seat at a table. Returns the table plus the new player's seat key. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = normalizeCode((await ctx.params).code);
    const body = await readJson(req);
    const playerId = newId();
    const token = newToken();
    const rec = await store.update(code, (r) => joinParty(r, playerId, token, body.name, Date.now()));
    if (!rec) return fail('No table with that code. Check it with your host.', 404);
    return partyBody(rec.party, { playerId, token });
  });
}
