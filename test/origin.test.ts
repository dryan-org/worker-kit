import { describe, expect, it } from "vitest";

import {
  isTransientOriginError,
  isTransientOriginStatus,
} from "../src/origin.ts";
import {
  groupCloudflareErrors,
  TRANSIENT_FINGERPRINT,
  type SentryEventLike,
} from "../src/sentry.ts";

describe("isTransientOriginStatus", () => {
  it.each([408, 425, 429, 500, 502, 503, 504, 520, 522, 524, 530])(
    "retries %i",
    (status) => {
      expect(isTransientOriginStatus(status)).toBe(true);
    },
  );
  it.each([200, 301, 400, 401, 403, 404, 409, 422, 531, 599])(
    "does not retry %i",
    (status) => {
      expect(isTransientOriginStatus(status)).toBe(false);
    },
  );
});

describe("isTransientOriginError", () => {
  it("reads status and statusCode", () => {
    expect(
      isTransientOriginError(Object.assign(new Error("x"), { status: 503 })),
    ).toBe(true);
    expect(
      isTransientOriginError(
        Object.assign(new Error("x"), { statusCode: 522 }),
      ),
    ).toBe(true);
    expect(
      isTransientOriginError(Object.assign(new Error("x"), { status: 404 })),
    ).toBe(false);
    expect(
      isTransientOriginError(Object.assign(new Error("x"), { status: "503" })),
    ).toBe(false);
  });

  it("recognises fetch network failures", () => {
    expect(isTransientOriginError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientOriginError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isTransientOriginError(new TypeError("Network connection lost.")),
    ).toBe(true);
    expect(isTransientOriginError(new TypeError("x is not a function"))).toBe(
      false,
    );
    expect(isTransientOriginError(new Error("fetch failed"))).toBe(false);
  });

  it("recognises timeouts and aborts", () => {
    expect(
      isTransientOriginError(new DOMException("timed out", "TimeoutError")),
    ).toBe(true);
    expect(
      isTransientOriginError(new DOMException("aborted", "AbortError")),
    ).toBe(true);
    const named = new Error("t");
    named.name = "TimeoutError";
    expect(isTransientOriginError(named)).toBe(true);
  });

  it("walks cause", () => {
    const error = new Error("sync failed", {
      cause: new TypeError("fetch failed", { cause: new Error("ECONNRESET") }),
    });
    expect(isTransientOriginError(error)).toBe(true);
    expect(
      isTransientOriginError(new Error("outer", { cause: new Error("inner") })),
    ).toBe(false);
  });

  it("requires every AggregateError member to be transient", () => {
    const bad = Object.assign(new Error("x"), { status: 502 });
    expect(isTransientOriginError(new AggregateError([bad, bad], "f"))).toBe(
      true,
    );
    expect(
      isTransientOriginError(new AggregateError([bad, new Error("y")], "f")),
    ).toBe(false);
    expect(isTransientOriginError(new AggregateError([], "f"))).toBe(false);
  });

  it("ignores non-objects", () => {
    expect(isTransientOriginError(503)).toBe(false);
    expect(isTransientOriginError(undefined)).toBe(false);
    expect(isTransientOriginError(null)).toBe(false);
  });
});

describe("groupCloudflareErrors with origin errors", () => {
  it("fingerprints a transient origin error", () => {
    const error = Object.assign(new Error("upstream said 503"), {
      status: 503,
    });
    const event = groupCloudflareErrors<SentryEventLike>(
      { exception: { values: [{ type: "Error", value: error.message }] } },
      { originalException: error },
    );
    expect(event.fingerprint).toEqual(TRANSIENT_FINGERPRINT);
  });
});
