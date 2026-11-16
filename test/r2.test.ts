import { describe, expect, it, vi } from "vitest";

import { isTransientR2Error, retryR2 } from "../src/r2.ts";

const noSleep = () => Promise.resolve();

describe("isTransientR2Error", () => {
  it.each([
    "get: We encountered an internal error. Please try again. (10001)",
    "head: We encountered an internal error. Please try again. (10001)",
    "get: Please look at https://www.cloudflarestatus.com for issues or contact customer support. (10043)",
    "put: Network connection lost.",
    "get: Service Unavailable (10043)",
    "put: Client disconnected (10054)",
    "put: Please reduce your concurrent request rate for the same object. (10058)",
  ])("retries %s", (message) => {
    expect(isTransientR2Error(new Error(message))).toBe(true);
  });

  it.each([
    "put: Your metadata headers exceed the maximum allowed metadata size. (10012)",
    "get: The requested range is not satisfiable (10039)",
    "put: Precondition failed (10031)",
    "internal error while parsing the row",
  ])("does not retry %s", (message) => {
    expect(isTransientR2Error(new Error(message))).toBe(false);
  });

  it("ignores non-Errors", () => {
    expect(isTransientR2Error("Network connection lost")).toBe(false);
    expect(isTransientR2Error(undefined)).toBe(false);
  });
});

describe("retryR2", () => {
  it("retries a transient error until it succeeds", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error(
          "get: We encountered an internal error. Please try again. (10001)",
        ),
      )
      .mockRejectedValueOnce(new Error("get: Network connection lost."))
      .mockResolvedValue("ok");
    await expect(retryR2(run, { sleep: noSleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("gives up after four tries and rethrows the last error", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(
        new Error(
          "get: We encountered an internal error. Please try again. (10001)",
        ),
      );
    await expect(retryR2(run, { sleep: noSleep })).rejects.toThrow(/10001/);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("rethrows a non-transient error at once", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("put: Precondition failed (10031)"));
    await expect(retryR2(run, { sleep: noSleep })).rejects.toThrow(/10031/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
