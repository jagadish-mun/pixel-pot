import { normalizeCode } from '@/lib/game';
import { fail, handle, ok, partyBody } from '@/lib/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Read a table. Clients poll this with `?v=<the version they have>`; when
 * nothing has changed the answer is a tiny `{ unchanged: true }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = normalizeCode((await ctx.params).code);
    const have = Number(new URL(req.url).searchParams.get('v') ?? 0);
    if (have > 0) {
      const current = await store.version(code);
      if (current === null) return fail('No table with that code.', 404);
      if (current === have) return ok({ unchanged: true });
    }
    const rec = await store.get(code);
    if (!rec) return fail('No table with that code.', 404);
    return partyBody(rec.party);
  });
}
