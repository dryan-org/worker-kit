import { describe, expect, it } from "vitest";

import {
  TRANSIENT_FINGERPRINT,
  groupCloudflareErrors,
  type SentryEventLike,
} from "../src/sentry.ts";

function eventFor(error: Error): SentryEventLike {
  return { exception: { values: [{ type: "Error", value: error.message }] } };
}

describe("groupCloudflareErrors", () => {
  it("groups two occurrences of one D1 blip into one issue", () => {
    const [a, b] = [
      "D1_ERROR: internal error; reference = e_Gz3hrU_03c2882d029b4bdfb3466681ad10aabf",
      "D1_ERROR: internal error; reference = e_Gz3hrU_8c81c7e54dc54922b192da13a04e3261",
    ].map((message) => {
      const error = new Error(message);
      return groupCloudflareErrors(eventFor(error), {
        originalException: error,
      });
    });
    expect(a!.exception!.values![0]!.value).toBe("D1_ERROR: internal error");
    expect(b!.exception!.values![0]!.value).toBe("D1_ERROR: internal error");
    expect(a!.fingerprint).toEqual(TRANSIENT_FINGERPRINT);
    expect(b!.fingerprint).toEqual(TRANSIENT_FINGERPRINT);
    expect(a!.tags).toEqual({
      cf_reference: "e_Gz3hrU_03c2882d029b4bdfb3466681ad10aabf",
    });
  });

  it("keeps the rest of the message after the reference", () => {
    const error = new Error(
      "D1_ERROR: Internal error in D1 DB storage caused object to be reset; reference = lql6i6spfek",
    );
    const event = groupCloudflareErrors(eventFor(error), {
      originalException: error,
    });
    expect(event.exception!.values![0]!.value).toBe(
      "D1_ERROR: Internal error in D1 DB storage caused object to be reset",
    );
  });

  it("groups a Durable Object internal error the same way", () => {
    const error = new Error(
      "internal error; reference = vnieimp2fmi5b3sh9dvpe5pn",
    );
    const event = groupCloudflareErrors(eventFor(error), {
      originalException: error,
    });
    expect(event.exception!.values![0]!.value).toBe("internal error");
    expect(event.tags).toEqual({ cf_reference: "vnieimp2fmi5b3sh9dvpe5pn" });
    expect(event.fingerprint).toEqual(TRANSIENT_FINGERPRINT);
  });

  it("leaves an unrelated error alone", () => {
    const error = new Error("D1_ERROR: UNIQUE constraint failed: t.id");
    const event = groupCloudflareErrors(
      { ...eventFor(error), tags: { worker: "vegvisir" } },
      { originalException: error },
    );
    expect(event.exception!.values![0]!.value).toBe(error.message);
    expect(event.fingerprint).toBeUndefined();
    expect(event.tags).toEqual({ worker: "vegvisir" });
  });
});
