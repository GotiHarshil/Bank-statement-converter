import { Redis } from '@upstash/redis';
import type { LearnedTemplateStore, StoredTemplate } from '@/lib/banks/learned/store';

/**
 * Redis-backed store, so a layout learned once stays learned across deploys and
 * across serverless instances.
 *
 * REST-based, which is what makes it usable from a serverless function: there
 * is no connection to pool or tear down per invocation.
 */

const KEY_PREFIX = 'bank-template:';
/** Sorted set indexing every key by learn time, so `list` needs no SCAN. */
const INDEX_KEY = 'bank-template:index';

export function hasUpstashCredentials(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export class UpstashTemplateStore implements LearnedTemplateStore {
  private readonly redis: Redis;

  constructor(redis: Redis = Redis.fromEnv()) {
    this.redis = redis;
  }

  async get(key: string): Promise<StoredTemplate | null> {
    // The REST client parses JSON responses, so this is already an object.
    return (await this.redis.get<StoredTemplate>(KEY_PREFIX + key)) ?? null;
  }

  async put(template: StoredTemplate): Promise<void> {
    await Promise.all([
      this.redis.set(KEY_PREFIX + template.key, template),
      this.redis.zadd(INDEX_KEY, { score: Date.parse(template.learnedAt), member: template.key }),
    ]);
  }

  async delete(key: string): Promise<void> {
    await Promise.all([this.redis.del(KEY_PREFIX + key), this.redis.zrem(INDEX_KEY, key)]);
  }

  async list(limit = 100): Promise<StoredTemplate[]> {
    const keys = await this.redis.zrange<string[]>(INDEX_KEY, 0, limit - 1, { rev: true });
    if (keys.length === 0) return [];

    const records = await this.redis.mget<StoredTemplate[]>(...keys.map((k) => KEY_PREFIX + k));
    return records.filter((r): r is StoredTemplate => r !== null);
  }
}
