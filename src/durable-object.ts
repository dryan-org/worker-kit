import { retryTransient, type RetryOptions } from "./retry.ts";

/**
 * Whether a failed Durable Object call is worth another try. Mirrors
 * `isErrorRetryable` in cloudflare/actors (packages/core/src/retries.ts):
 * Cloudflare marks transient DO failures with `retryable: true`, and an
 * `overloaded` object must not be hit again. When the runtime sets neither flag,
 * fall back to the two messages the platform uses for transient infrastructure
 * failures. An explicit `retryable: false` is respected.
 */
export function isRetryableDOError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const flags = error as Error & { retryable?: unknown; overloaded?: unknown };
  if (flags.overloaded === true) return false;
  if (flags.retryable !== undefined) return flags.retryable === true;
  return /internal error; reference|network connection lost/i.test(
    error.message,
  );
}

/**
 * Retry a Durable Object call that is safe to replay, with the backoff shape of
 * cloudflare/actors `tryWhile`: bounded attempts, exponential delay, full jitter.
 * Each attempt calls `run` again, so it must build a fresh stub (a stub that
 * threw may be broken).
 */
export function retryDurableObject<T>(
  run: () => Promise<T>,
  options: Partial<Omit<RetryOptions, "isTransient">> = {},
): Promise<T> {
  return retryTransient(run, {
    attempts: 3,
    delayMs: 100,
    jitter: true,
    ...options,
    isTransient: isRetryableDOError,
  });
}
