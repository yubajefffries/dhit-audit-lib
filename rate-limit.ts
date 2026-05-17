import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./constants";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const limits = new Map<string, RateLimitEntry>();

function cleanup() {
  const now = Date.now();
  for (const [key, entry] of limits) {
    if (entry.resetAt < now) {
      limits.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  options?: { max?: number; windowMs?: number },
): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const max = options?.max ?? RATE_LIMIT_MAX;
  const windowMs = options?.windowMs ?? RATE_LIMIT_WINDOW_MS;
  cleanup();
  const now = Date.now();
  const entry = limits.get(key);

  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: max - 1,
      resetAt: now + windowMs,
    };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: max - entry.count,
    resetAt: entry.resetAt,
  };
}
