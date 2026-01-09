/**
 * Rate Limiting Middleware
 *
 * Provides simple in-memory rate limiting for authentication endpoints
 * to prevent brute force attacks.
 */

import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  keyGenerator?: (c: Context) => string;  // Custom key generator
  skipSuccessfulRequests?: boolean;  // Don't count successful responses
  message?: string;      // Custom error message
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 10,      // 10 requests per window
  message: "Too many requests, please try again later",
};

/**
 * In-memory store for rate limit entries
 * In production, consider using Redis or similar for distributed deployments
 */
const store = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries periodically to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredEntries, 60 * 1000);

/**
 * Get client identifier from request
 * Uses X-Forwarded-For header (for proxied requests) or falls back to a default
 */
function getClientKey(c: Context): string {
  // Check X-Forwarded-For header (common in proxied setups)
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    // Take the first IP if multiple are present
    return forwarded.split(",")[0].trim();
  }

  // Check X-Real-IP header (used by nginx)
  const realIp = c.req.header("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback - in serverless environments, we may not have direct IP access
  // Use a combination of available headers for fingerprinting
  const userAgent = c.req.header("user-agent") || "unknown";
  return `fallback:${userAgent.slice(0, 50)}`;
}

/**
 * Create a rate limiting middleware with the given configuration
 *
 * @param config - Rate limit configuration
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * // Apply to auth routes
 * app.use('/api/v1/auth/*', createRateLimiter({
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   maxRequests: 5,           // 5 login attempts per window
 * }));
 * ```
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const { windowMs, maxRequests, keyGenerator, message } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  return async (c: Context, next: Next) => {
    const key = keyGenerator ? keyGenerator(c) : getClientKey(c);
    const now = Date.now();

    // Get or create entry for this key
    let entry = store.get(key);

    if (!entry || now > entry.resetTime) {
      // First request in this window or window has expired
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      store.set(key, entry);
    } else {
      // Increment count
      entry.count++;
    }

    // Calculate remaining requests and time
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetSeconds));

    // Check if rate limit exceeded
    if (entry.count > maxRequests) {
      c.header("Retry-After", String(resetSeconds));
      return c.json(
        {
          success: false,
          error: message,
          retryAfter: resetSeconds,
        },
        429
      );
    }

    await next();
  };
}

/**
 * Preset rate limiters for common use cases
 */
export const rateLimiters = {
  /**
   * Strict rate limiter for login endpoints
   * 5 attempts per 15 minutes per IP
   */
  login: createRateLimiter({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    maxRequests: 5,
    message: "Too many login attempts. Please try again in 15 minutes.",
  }),

  /**
   * Very strict rate limiter for password reset
   * 3 attempts per hour per IP
   */
  passwordReset: createRateLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hour
    maxRequests: 3,
    message: "Too many password reset requests. Please try again in an hour.",
  }),

  /**
   * Moderate rate limiter for signup
   * 10 attempts per hour per IP
   */
  signup: createRateLimiter({
    windowMs: 60 * 60 * 1000,  // 1 hour
    maxRequests: 10,
    message: "Too many signup attempts. Please try again later.",
  }),

  /**
   * General API rate limiter
   * 100 requests per minute per IP
   */
  api: createRateLimiter({
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 100,
    message: "Rate limit exceeded. Please slow down.",
  }),
};

/**
 * Reset rate limit for a specific key (useful after successful login)
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Get current rate limit status for a key
 */
export function getRateLimitStatus(key: string): {
  count: number;
  remaining: number;
  resetTime: number;
} | null {
  const entry = store.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now > entry.resetTime) {
    store.delete(key);
    return null;
  }

  return {
    count: entry.count,
    remaining: Math.max(0, DEFAULT_CONFIG.maxRequests - entry.count),
    resetTime: entry.resetTime,
  };
}
