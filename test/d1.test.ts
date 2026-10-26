import { describe, expect, it, vi } from "vitest";

import { isTransientD1Error, retryD1 } from "../src/d1.ts";

const noSleep = () => Promise.resolve();

describe("isTransientD1Error", () => {
  it.each([
    "D1_ERROR: Network connection lost.",
    "Network connection lost.",
    "D1_ERROR: Internal error in D1 DB storage caused object to be reset; reference = lql6i6spfek",
    "D1_ERROR: internal error; reference = e_Gz3hrU_03c2882d029b4bdfb3466681ad10aabf",
    "D1_ERROR: internal error; reference = ipvha29hm877ogb0k536c7pn",
    "Durable Object reset because its code was updated.",
    "D1 DB is overloaded. Too many requests queued.",
    "internal error",
    "D1_ERROR: internal error",
    "D1_ERROR: Internal Error",
  ])("retries %s", (message) => {
    expect(isTransientD1Error(new Error(message))).toBe(true);
  });

  it.each([
    "D1_ERROR: UNIQUE constraint failed: votes.round_id",
    "D1_ERROR: no such table: nope: SQLITE_ERROR",
    "validation failed: internal error in handler",
    "internal error while parsing the row",
  ])("does not retry %s", (message) => {
    expect(isTransientD1Error(new Error(message))).toBe(false);
  });

  it("ignores non-Errors", () => {
    expect(isTransientD1Error("Network connection lost")).toBe(false);
    expect(isTransientD1Error(undefined)).toBe(false);
  });
});

describe("retryD1", () => {
  it("retries a transient error until it succeeds", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error("D1_ERROR: internal error; reference = x"),
      )
      .mockRejectedValueOnce(new Error("D1_ERROR: Network connection lost."))
      .mockResolvedValue("ok");
    await expect(retryD1(run, { sleep: noSleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("gives up after the default 4 attempts", async () => {
    const error = new Error("D1_ERROR: internal error; reference = x");
    const run = vi.fn<() => Promise<never>>().mockRejectedValue(error);
    await expect(retryD1(run, { sleep: noSleep })).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("throws a non-transient error at once", async () => {
    const error = new Error("D1_ERROR: UNIQUE constraint failed: t.id");
    const run = vi.fn<() => Promise<never>>().mockRejectedValue(error);
    await expect(retryD1(run, { sleep: noSleep })).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
