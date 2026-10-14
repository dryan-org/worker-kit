/**
 * Retry an operation that fails now and then for reasons outside our control
 * (a dropped D1 connection, GitHub answering "unavailable"). Only for work that
 * is safe to replay: a whole-set replace, a read, a token mint.
 */
export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  /** Delay before the second try; each later one doubles it. */
  delayMs?: number;
  /** Decides whether an error is worth another try. Anything else rethrows at once. */
  isTransient: (error: unknown) => boolean;
  /**
   * Full jitter: sleep a random time between 0 and the current delay, so
   * callers that failed together do not all retry in the same instant.
   */
  jitter?: boolean;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
  /** Test hook for the jitter, in [0, 1). */
  random?: () => number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryTransient<T>(
  run: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let delay = options.delayMs ?? 150;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !options.isTransient(error)) throw error;
      await sleep(options.jitter ? Math.floor(random() * delay) : delay);
      delay *= 2;
    }
  }
}
