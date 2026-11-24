import { Redis } from '@upstash/redis';
import type { PartyRecord } from './types';

/**
 * Where tables are kept.
 *
 * - With Upstash Redis credentials in the environment (what the Vercel
 *   Marketplace "Upstash for Redis" integration injects), tables live in Redis
 *   so every serverless function sees the same state.
 * - Without them, tables live in this process's memory. That is perfect for
 *   `npm run dev` and useless on Vercel, where each request may hit a
 *   different instance.
 */

const TTL_SECONDS = 60 * 60 * 24 * 3; // tables disappear 3 days after the last action
const MAX_RETRIES = 8;

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const storageMode: 'redis' | 'memory' = url && token ? 'redis' : 'memory';

export interface Store {
  /** Current version of a table, or null if it doesn't exist. Cheap; used by polling. */
  version(code: string): Promise<number | null>;
  get(code: string): Promise<PartyRecord | null>;
  /** Returns false if the code is already taken. */
  create(rec: PartyRecord): Promise<boolean>;
  /**
   * Read, change and write a table atomically. `change` may run more than once
   * if another player's action lands in between, so it must not have side effects.
   */
  update(code: string, change: (rec: PartyRecord) => void): Promise<PartyRecord | null>;
}

function bump(rec: PartyRecord) {
  rec.party.version += 1;
  rec.party.updatedAt = Date.now();
}

/* ---------------------------------- memory --------------------------------- */

type MemoryEntry = { rec: PartyRecord; expires: number };
const g = globalThis as unknown as { __pixelPotTables?: Map<string, MemoryEntry> };

function memoryStore(): Store {
  const tables = (g.__pixelPotTables ??= new Map());
  const read = (code: string) => {
    const entry = tables.get(code);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      tables.delete(code);
      return null;
    }
    return entry;
  };
  const write = (rec: PartyRecord) => tables.set(rec.party.code, { rec, expires: Date.now() + TTL_SECONDS * 1000 });
  return {
    async version(code) {
      return read(code)?.rec.party.version ?? null;
    },
    async get(code) {
      const entry = read(code);
      return entry ? structuredClone(entry.rec) : null;
    },
    async create(rec) {
      if (read(rec.party.code)) return false;
      write(structuredClone(rec));
      return true;
    },
    async update(code, change) {
      const entry = read(code);
      if (!entry) return null;
      const next = structuredClone(entry.rec);
      change(next);
      bump(next);
      write(next);
      return structuredClone(next);
    },
  };
}

/* ---------------------------------- redis ---------------------------------- */

// Write only if nobody else has written since we read (compare-and-set on the version key).
const CAS_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
return 1
`;

function redisStore(): Store {
  const redis = new Redis({ url: url!, token: token!, automaticDeserialization: false });
  const dataKey = (code: string) => `pixelpot:${code}:data`;
  const versionKey = (code: string) => `pixelpot:${code}:v`;

  const get = async (code: string): Promise<PartyRecord | null> => {
    const raw = await redis.get<string>(dataKey(code));
    return raw ? (JSON.parse(raw) as PartyRecord) : null;
  };

  return {
    async version(code) {
      const v = await redis.get<string>(versionKey(code));
      return v === null || v === undefined ? null : Number(v);
    },
    get,
    async create(rec) {
      const code = rec.party.code;
      const claimed = await redis.set(versionKey(code), String(rec.party.version), { nx: true, ex: TTL_SECONDS });
      if (claimed !== 'OK') return false;
      await redis.set(dataKey(code), JSON.stringify(rec), { ex: TTL_SECONDS });
      return true;
    },
    async update(code, change) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const rec = await get(code);
        if (!rec) return null;
        const readVersion = rec.party.version;
        change(rec);
        bump(rec);
        const ok = await redis.eval(
          CAS_SCRIPT,
          [dataKey(code), versionKey(code)],
          [String(readVersion), String(rec.party.version), JSON.stringify(rec), String(TTL_SECONDS)],
        );
        if (Number(ok) === 1) return rec;
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
      }
      throw new Error('The table is busy. Try again.');
    },
  };
}

export const store: Store = storageMode === 'redis' ? redisStore() : memoryStore();
