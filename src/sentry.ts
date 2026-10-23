import { isTransientD1Error } from "./d1.ts";
import { isTransientQueueError } from "./queue.ts";

/**
 * The slice of a Sentry event this module reads and writes. Sentry's
 * `ErrorEvent` satisfies it structurally, so this package needs no Sentry
 * dependency of its own.
 */
export interface SentryEventLike {
  exception?: { values?: { type?: string; value?: string }[] };
  message?: string;
  fingerprint?: string[];
  tags?: Record<string, unknown>;
}

export interface SentryHintLike {
  originalException?: unknown;
}

/**
 * The fingerprint every transient Cloudflare error is grouped under. D1 and
 * Durable Object failures share messages ("internal error; reference",
 * "Network connection lost") and an unprefixed one cannot be told apart, so
 * they share one issue.
 */
export const TRANSIENT_FINGERPRINT = ["cloudflare-transient"];

function isTransientCloudflareError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 && error.errors.every(isTransientCloudflareError)
    );
  }
  if (error instanceof Error && error.cause instanceof Error) {
    return isTransientCloudflareError(error.cause);
  }
  return isTransientD1Error(error) || isTransientQueueError(error);
}

/** Cloudflare's per-occurrence support reference, e.g. `; reference = e_Gz3hrU_03c2...`. */
const REFERENCE = /;\s*reference\s*=\s*(\S+)/i;

/**
 * `beforeSend` step for Workers that use D1 or Durable Objects.
 *
 * Cloudflare appends a unique `reference = ...` to internal errors, and
 * GlitchTip groups by the message, so every occurrence of one blip opened its
 * own issue (and the GitHub bridge its own GitHub issue). This strips the
 * reference from the message and keeps it as the `cf_reference` tag, which is
 * what Cloudflare support asks for. A transient error (D1, queue or Durable Object), or an AggregateError whose
 * inner errors all are, that
 * survived the retries also gets one fixed fingerprint, so an outage is one issue per
 * project with an event count, not one issue per failed request.
 *
 * Returns the same event, changed in place, so it chains:
 *   beforeSend: groupCloudflareErrors
 */
export function groupCloudflareErrors<E extends SentryEventLike>(
  event: E,
  hint: SentryHintLike,
): E {
  let reference: string | undefined;
  for (const value of event.exception?.values ?? []) {
    const match = value.value?.match(REFERENCE);
    if (!match) continue;
    reference ??= match[1];
    value.value = value.value!.replace(REFERENCE, "");
  }
  if (reference) event.tags = { ...event.tags, cf_reference: reference };
  if (isTransientCloudflareError(hint.originalException)) {
    event.fingerprint = [...TRANSIENT_FINGERPRINT];
  }
  return event;
}
