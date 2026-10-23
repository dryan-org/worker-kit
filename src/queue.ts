import { retryTransient, type RetryOptions } from "./retry.ts";

/**
 * Queue producer failures that come from Cloudflare's side and clear on their
 * own: the queue is shedding load ("Queue is overloaded. Please back off.",
 * code 10250). Queue errors carry no machine-readable code on the Error, so
 * this matches on message.
 */
const TRANSIENT_QUEUE = [/queue is overloaded/i, /\(10250\)/];

export function isTransientQueueError(error: unknown): boolean {
  return (
    error instanceof Error &&
    TRANSIENT_QUEUE.some((pattern) => pattern.test(error.message))
  );
}

/** Same blip-sized defaults as D1: 4 tries, delays capped at 200, 400 and 800 ms. */
export const QUEUE_RETRY_DEFAULTS = { attempts: 4, delayMs: 200 } as const;

/**
 * Run a queue `send` or `sendBatch` and retry it on a transient queue error,
 * with full jitter. A send that threw may still have enqueued, so a retry can
 * deliver a message twice: only wrap sends whose consumer is idempotent.
 */
export function retryQueue<T>(
  run: () => Promise<T>,
  options: Partial<Omit<RetryOptions, "isTransient">> = {},
): Promise<T> {
  return retryTransient(run, {
    ...QUEUE_RETRY_DEFAULTS,
    jitter: true,
    ...options,
    isTransient: isTransientQueueError,
  });
}
