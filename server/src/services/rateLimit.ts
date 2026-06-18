import type { NextFunction, Request, Response } from "express";

interface Bucket {
  tokens: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX = 60;

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  return req.ip ?? "unknown";
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = clientIp(req);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { tokens: MAX - 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (bucket.tokens <= 0) {
    res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  bucket.tokens -= 1;
  next();
}

// Cleanup expired buckets every 5 minutes to avoid unbounded growth.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}, 5 * 60_000).unref();
