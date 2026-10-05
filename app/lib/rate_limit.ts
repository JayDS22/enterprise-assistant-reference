// Token-bucket rate limiter, per-tenant. Called from app/middleware.ts after verifyJwt.
// See _handoff/project-1-FINAL-plan.md §1 and §4.
//
// ponytail: In-memory map; upgrade to Redis-backed when deploying multi-instance Fly.

type Bucket = { tokens: number; last_refill_ts: number };

const buckets = new Map<string, Bucket>();

// Test seams: overridable config. Falls back to env, then defaults.
let override: { rpm?: number; burst?: number } = {};

function rpm(): number {
  if (typeof override.rpm === "number") return override.rpm;
  const n = Number(process.env.RATE_LIMIT_RPM);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function burst(): number {
  if (typeof override.burst === "number") return override.burst;
  const n = Number(process.env.RATE_LIMIT_BURST);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export type RateLimitResult = {
  allowed: boolean;
  retry_after_ms: number;
  remaining: number;
};

export function checkAndConsume(
  tenantId: string,
  now: number = Date.now(),
): RateLimitResult {
  const capacity = burst();
  const refillPerMs = rpm() / 60_000; // tokens per ms

  const existing = buckets.get(tenantId);
  const bucket: Bucket = existing ?? { tokens: capacity, last_refill_ts: now };

  if (existing) {
    const elapsed = Math.max(0, now - existing.last_refill_ts);
    const refilled = existing.tokens + elapsed * refillPerMs;
    bucket.tokens = Math.min(capacity, refilled);
    bucket.last_refill_ts = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(tenantId, bucket);
    return {
      allowed: true,
      retry_after_ms: 0,
      remaining: Math.floor(bucket.tokens),
    };
  }

  // Rejected. Compute wait until bucket has 1 full token.
  const deficit = 1 - bucket.tokens;
  const retry_after_ms = Math.ceil((deficit * 60_000) / rpm());
  buckets.set(tenantId, bucket);
  return {
    allowed: false,
    retry_after_ms,
    remaining: 0,
  };
}

export function _resetForTests(): void {
  buckets.clear();
  override = {};
}

export function _setForTests(cfg: { rpm?: number; burst?: number }): void {
  override = { ...override, ...cfg };
}
