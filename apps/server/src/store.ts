import { Redis } from "ioredis";
import { config } from "./config.js";

/**
 * Live state store. Redis when REDIS_URL is set (room snapshots survive a
 * restart and the Socket.io Redis adapter lets several server instances share
 * one namespace); an in-memory Map otherwise (dev / tests).
 */
export interface LiveStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  incr(key: string, ttlSec?: number): Promise<number>;
  readonly kind: "redis" | "memory";
  redis?: Redis;
  close(): Promise<void>;
}

class MemoryStore implements LiveStore {
  kind = "memory" as const;
  private m = new Map<string, { v: string; exp?: number }>();
  private sets = new Map<string, Set<string>>();
  private alive(k: string) {
    const e = this.m.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { this.m.delete(k); return null; }
    return e;
  }
  async get(k: string) { return this.alive(k)?.v ?? null; }
  async set(k: string, v: string, ttl?: number) { this.m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : undefined }); }
  async del(k: string) { this.m.delete(k); this.sets.delete(k); }
  async sadd(k: string, member: string) { (this.sets.get(k) ?? this.sets.set(k, new Set()).get(k)!).add(member); }
  async srem(k: string, member: string) { this.sets.get(k)?.delete(member); }
  async smembers(k: string) { return [...(this.sets.get(k) ?? [])]; }
  async incr(k: string, ttl?: number) {
    const cur = Number(this.alive(k)?.v ?? 0) + 1;
    await this.set(k, String(cur), ttl);
    return cur;
  }
  async close() {}
}

class RedisStore implements LiveStore {
  kind = "redis" as const;
  redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.redis.on("error", (e) => console.error("[redis]", e.message));
  }
  async get(k: string) { return this.redis.get(k); }
  async set(k: string, v: string, ttl?: number) { if (ttl) await this.redis.set(k, v, "EX", ttl); else await this.redis.set(k, v); }
  async del(k: string) { await this.redis.del(k); }
  async sadd(k: string, m: string) { await this.redis.sadd(k, m); }
  async srem(k: string, m: string) { await this.redis.srem(k, m); }
  async smembers(k: string) { return this.redis.smembers(k); }
  async incr(k: string, ttl?: number) {
    const n = await this.redis.incr(k);
    if (ttl && n === 1) await this.redis.expire(k, ttl);
    return n;
  }
  async close() { await this.redis.quit(); }
}

export function createStore(): LiveStore {
  if (config.redisUrl && !config.isTest) {
    console.log("[store] using redis");
    return new RedisStore(config.redisUrl);
  }
  console.log("[store] using in-memory store");
  return new MemoryStore();
}
