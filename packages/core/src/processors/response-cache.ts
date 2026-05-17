import { createHash } from "node:crypto";
import { canonicalize } from "../providers/anthropic.js";

interface CacheEntry {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  storedAt: number;
  expiresAt: number;
  /** Approx response body size in bytes — used for LRU eviction. */
  bytes: number;
  /** Usage as reported by upstream when the response was first cached. */
  usage: { inputTokens: number; outputTokens: number };
  /** Model from the cached response. */
  model: string;
}

export interface CacheHit {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  cachedAgoMs: number;
  cachedBytes: number;
}

/**
 * Tiny, conservative response cache for the Anthropic JSON endpoint.
 *
 * Caches IFF: temperature === 0 AND stream === false. Anthropic only guarantees
 * deterministic outputs under these conditions, so caching anything else risks
 * serving a stale response a user wouldn't expect.
 *
 * Bounded by total byte budget (default 64 MB) with LRU eviction.
 * Default TTL: 10 minutes.
 */
export class ResponseCache {
  private readonly map = new Map<string, CacheEntry>();
  private currentBytes = 0;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxBytes = 64 * 1024 * 1024,
    private readonly defaultTtlMs = 10 * 60 * 1000,
  ) {}

  private static keyFor(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const obj = body as Record<string, unknown>;
    if (obj["stream"] === true) return null;
    if (obj["temperature"] !== 0) return null;
    return createHash("sha256")
      .update(
        canonicalize({
          model: obj["model"] ?? null,
          system: obj["system"] ?? null,
          tools: obj["tools"] ?? null,
          tool_choice: obj["tool_choice"] ?? null,
          messages: obj["messages"] ?? [],
          max_tokens: obj["max_tokens"] ?? null,
          temperature: obj["temperature"] ?? null,
          top_p: obj["top_p"] ?? null,
          top_k: obj["top_k"] ?? null,
          stop_sequences: obj["stop_sequences"] ?? null,
        }),
      )
      .digest("hex");
  }

  /** Returns a hit if the body is cacheable AND fresh; otherwise null. */
  lookup(body: unknown): CacheHit | null {
    const key = ResponseCache.keyFor(body);
    if (key === null) return null;
    const entry = this.map.get(key);
    if (entry === undefined) {
      this.misses++;
      return null;
    }
    const now = Date.now();
    if (entry.expiresAt < now) {
      this.evict(key, entry);
      this.misses++;
      return null;
    }
    // LRU: refresh insertion order
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return {
      status: entry.status,
      headers: entry.headers,
      body: entry.body,
      usage: entry.usage,
      model: entry.model,
      cachedAgoMs: now - entry.storedAt,
      cachedBytes: entry.bytes,
    };
  }

  /** Store a response for a cacheable request. No-op if request isn't cacheable. */
  store(
    body: unknown,
    response: {
      status: number;
      headers: Record<string, string>;
      body: Buffer;
      usage: { inputTokens: number; outputTokens: number };
      model: string;
    },
    ttlMs?: number,
  ): void {
    const key = ResponseCache.keyFor(body);
    if (key === null) return;
    // Only cache 2xx; 4xx/5xx are likely transient or user errors
    if (response.status < 200 || response.status >= 300) return;
    const bytes = response.body.length;
    if (bytes > this.maxBytes / 4) return; // skip absurdly large bodies
    this.evictIfNeeded(bytes);
    const now = Date.now();
    const entry: CacheEntry = {
      status: response.status,
      headers: { ...response.headers },
      body: response.body,
      storedAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      bytes,
      usage: response.usage,
      model: response.model,
    };
    // Drop pre-existing entry under the same key (refresh)
    const prior = this.map.get(key);
    if (prior !== undefined) {
      this.currentBytes -= prior.bytes;
      this.map.delete(key);
    }
    this.map.set(key, entry);
    this.currentBytes += bytes;
  }

  private evictIfNeeded(incomingBytes: number): void {
    while (this.currentBytes + incomingBytes > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      const key = oldest.value;
      const e = this.map.get(key);
      if (e === undefined) break;
      this.evict(key, e);
    }
  }

  private evict(key: string, entry: CacheEntry): void {
    this.currentBytes -= entry.bytes;
    this.map.delete(key);
  }

  stats(): { hits: number; misses: number; entries: number; bytes: number } {
    return { hits: this.hits, misses: this.misses, entries: this.map.size, bytes: this.currentBytes };
  }
}
