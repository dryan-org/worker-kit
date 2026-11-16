import { retryTransient, type RetryOptions } from "./retry.ts";

/**
 * R2 failures that come from Cloudflare's side and clear on their own. R2
 * throws plain Errors shaped `<operation>: <message> (<code>)`, so this
 * matches on message: the generic "internal error, try again" (10001), the
 * "look at cloudflarestatus.com" answer given when a request could not be
 * served (10043 and friends), a dropped client connection (10054) and the
 * rate limit (10058). A missing key is a null result, not an error, and a bad
 * argument or precondition is not on the list, so those throw straight through.
 *
 * New variants go here, once, and every Worker picks them up on the next bump.
 */
const TRANSIENT_R2 = [
  /we encountered an internal error\. please try again/i,
  /please look at https:\/\/www\.cloudflarestatus\.com for issues/i,
  /network connection lost/i,
  /service unavailable/i,
  /client disconnected/i,
  /reduce your concurrent request rate/i,
];

export function isTransientR2Error(error: unknown): boolean {
  return (
    error instanceof Error &&
    TRANSIENT_R2.some((pattern) => pattern.test(error.message))
  );
}

/**
 * Defaults sized for a blip of about a second: 4 tries, delays capped at
 * 100, 200 and 400 ms. Reads are on the request path, so the delays stay
 * shorter than D1's.
 */
export const R2_RETRY_DEFAULTS = { attempts: 4, delayMs: 100 } as const;

/**
 * Run an R2 call and retry it on a transient R2 error, with full jitter.
 * Safe for `get`, `head` and `list`, and for a `put` or `delete` of a whole
 * object (replaying it leaves the same state). `run` is called again on each
 * attempt, so make the call inside it: a `get` body that was already streamed
 * cannot be reused.
 */
export function retryR2<T>(
  run: () => Promise<T>,
  options: Partial<Omit<RetryOptions, "isTransient">> = {},
): Promise<T> {
  return retryTransient(run, {
    ...R2_RETRY_DEFAULTS,
    jitter: true,
    ...options,
    isTransient: isTransientR2Error,
  });
}
