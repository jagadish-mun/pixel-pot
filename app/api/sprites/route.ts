import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Built once: the hand-drawn sprites in public/sprites, so the table only asks for ones that exist.
export const dynamic = 'force-static';

export async function GET() {
  let names: string[] = [];
  try {
    names = readdirSync(join(process.cwd(), 'public', 'sprites'))
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -4));
  } catch {
    // No folder: no overrides.
  }
  return Response.json({ names });
}
