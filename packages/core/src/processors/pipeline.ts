import type { Conversation } from "../providers/types.js";
import type {
  Processor,
  ProcessorContext,
  ProcessorEffect,
  PipelineOptions,
  PipelineRunResult,
} from "./types.js";

interface BreakerState {
  failuresInWindow: number;
  windowStart: number;
  trippedUntil: number;
}

/**
 * Per-process circuit breaker. If a processor throws N times within W ms,
 * disable it for D ms. Bounded recovery so a transient bug doesn't cost
 * the user the whole session.
 */
class CircuitBreaker {
  private states = new Map<string, BreakerState>();
  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 60_000,
    private readonly cooldownMs = 5 * 60_000,
  ) {}

  isOpen(id: string): boolean {
    const s = this.states.get(id);
    return s !== undefined && s.trippedUntil > Date.now();
  }

  recordFailure(id: string): void {
    const now = Date.now();
    let s = this.states.get(id);
    if (s === undefined) {
      s = { failuresInWindow: 0, windowStart: now, trippedUntil: 0 };
      this.states.set(id, s);
    }
    if (now - s.windowStart > this.windowMs) {
      s.windowStart = now;
      s.failuresInWindow = 0;
    }
    s.failuresInWindow++;
    if (s.failuresInWindow >= this.threshold) {
      s.trippedUntil = now + this.cooldownMs;
    }
  }

  recordSuccess(id: string): void {
    const s = this.states.get(id);
    if (s === undefined) return;
    if (s.failuresInWindow > 0) s.failuresInWindow = Math.max(0, s.failuresInWindow - 1);
  }
}

export class Pipeline {
  private readonly processors: Processor[];
  private readonly enabled: Set<string>;
  private readonly breaker = new CircuitBreaker();

  constructor(opts: PipelineOptions) {
    this.processors = opts.processors;
    this.enabled = opts.enabled;
  }

  run(input: Conversation, ctx: ProcessorContext, sizeOf: (c: Conversation) => number): PipelineRunResult {
    const bytesIn = sizeOf(input);
    let current = input;
    const effects: ProcessorEffect[] = [];
    const errors: Array<{ processor: string; message: string }> = [];

    for (const p of this.processors) {
      if (!this.enabled.has(p.id)) continue;
      if (this.breaker.isOpen(p.id)) continue;
      try {
        const result = p.onRequest(current, ctx);
        if (result.conversation !== current) {
          current = result.conversation;
        }
        for (const e of result.effects) effects.push(e);
        this.breaker.recordSuccess(p.id);
      } catch (err) {
        this.breaker.recordFailure(p.id);
        errors.push({
          processor: p.id,
          message: err instanceof Error ? err.message : String(err),
        });
        // current is unchanged — fail-open
      }
    }

    return {
      conversation: current,
      effects,
      bytesIn,
      bytesOut: sizeOf(current),
      errors,
    };
  }
}

export type { Processor, ProcessorContext, ProcessorEffect } from "./types.js";
