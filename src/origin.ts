/**
 * Whether an HTTP status from an upstream is worth another try: request
 * timeout (408), too early (425), rate limited (429), and every 5xx up to 530,
 * which takes in Cloudflare's own origin errors (520 to 530).
 */
export function isTransientOriginStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 530)
  );
}

/** undici, workerd and browsers word a failed fetch differently. */
const FETCH_FAILURE = /fetch failed|failed to fetch|network connection lost/i;

function statusOf(error: object): number | undefined {
  const { status, statusCode } = error as {
    status?: unknown;
    statusCode?: unknown;
  };
  if (typeof status === "number") return status;
  if (typeof statusCode === "number") return statusCode;
  return undefined;
}

/**
 * Whether a thrown error is an upstream blip: it carries a transient `status`
 * or `statusCode`, or it is a fetch network failure, or a timeout from
 * `AbortSignal.timeout` (`TimeoutError`) or an abort (`AbortError`). Walks
 * `cause`, and an AggregateError counts only when it has errors and all of
 * them are transient.
 */
export function isTransientOriginError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 && error.errors.every(isTransientOriginError)
    );
  }
  if (typeof error !== "object" || error === null) return false;
  const status = statusOf(error);
  if (status !== undefined && isTransientOriginStatus(status)) return true;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (
    error instanceof TypeError &&
    typeof message === "string" &&
    FETCH_FAILURE.test(message)
  ) {
    return true;
  }
  return isTransientOriginError((error as { cause?: unknown }).cause);
}
