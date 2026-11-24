import { createParty } from '@/lib/game';
import { fail, handle, newCode, newId, newToken, partyBody, readJson } from '@/lib/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

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
      if (await store.create(rec)) return partyBody(rec.party, { playerId, token });
    }
    return fail("Couldn't find a free table code. Try again.", 503);
  });
}
