import { retryTransient, type RetryOptions } from "./retry.ts";

/**
 * D1 failures that come from Cloudflare's side and clear on their own: the
 * Durable Object behind the database was reset, restarted or overloaded, the
 * connection to it dropped, or the storage layer answered a bare "internal
 * error" with a support reference. D1 throws plain Errors with no code, so
 * this matches on message, with or without the `D1_ERROR: ` prefix. A
 * constraint failure or bad SQL is not on the list and is thrown straight
 * through.
 *
 * New variants go here, once, and every Worker picks them up on the next bump.
 */
const TRANSIENT_D1 = [
  /network connection lost/i,
  /storage caused object to be reset/i,
  /reset because its code was updated/i,
  /transient issue on remote node/i,
  /d1 db is overloaded/i,
  /d1 db reset/i,
  /internal error; reference/i,
  /^(d1_error: )?internal error$/i,
];

export function isTransientD1Error(error: unknown): boolean {
  return (
    error instanceof Error &&
    TRANSIENT_D1.some((pattern) => pattern.test(error.message))
  );
}

/**
 * Defaults sized for a blip of about a second: 4 tries, delays capped at
 * 200, 400 and 800 ms. D1 already retries read-only queries itself before
 * throwing, so by the time this sees an error the blip has lasted a while.
 */
export const D1_RETRY_DEFAULTS = { attempts: 4, delayMs: 200 } as const;

/**
 * Run a D1 statement (or batch) and retry it on a transient D1 error, with
 * full jitter so requests that failed together do not retry together.
 *
 * A dropped connection can arrive after a write committed, so a retried write
 * may apply twice. Only wrap reads and writes that tolerate that (upserts,
 * guarded inserts, whole-set replaces), never a counter bump or a plain INSERT
 * whose duplicate matters. `run` is called again on each attempt: prepare the
 * statement inside it, since one from a reset connection is not guaranteed to
 * be reusable.
 */
export function retryD1<T>(
  run: () => Promise<T>,
  options: Partial<Omit<RetryOptions, "isTransient">> = {},
): Promise<T> {
  return retryTransient(run, {
    ...D1_RETRY_DEFAULTS,
    jitter: true,
    ...options,
    isTransient: isTransientD1Error,
  });
}
