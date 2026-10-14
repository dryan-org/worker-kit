import { describe, expect, it } from "vitest";

import {
  isRetryableDOError,
  isTransientD1Error,
  retryDurableObject,
  retryTransient,
} from "../src/index.ts";

const transient = (error: unknown) =>
  error instanceof Error && error.message === "flaky";

describe("retryTransient", () => {
  it("returns the first success without sleeping", async () => {
    const sleeps: number[] = [];
    expect(
      await retryTransient(async () => "ok", {
        isTransient: transient,
        sleep: async (ms) => void sleeps.push(ms),
      }),
    ).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  it("retries a transient failure with doubling backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await retryTransient(
      async () => {
        if (++calls < 3) throw new Error("flaky");
        return calls;
      },
      {
        isTransient: transient,
        delayMs: 100,
        sleep: async (ms) => void sleeps.push(ms),
      },
    );
    expect(result).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("gives up after the last attempt and rethrows", async () => {
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls++;
          throw new Error("flaky");
        },
        { isTransient: transient, attempts: 3, sleep: async () => {} },
      ),
    ).rejects.toThrow("flaky");
    expect(calls).toBe(3);
  });

  it("jitters each delay between zero and the doubling backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await retryTransient(
      async () => {
        if (++calls < 3) throw new Error("flaky");
      },
      {
        isTransient: transient,
        delayMs: 100,
        jitter: true,
        random: () => 0.5,
        sleep: async (ms) => void sleeps.push(ms),
      },
    );
    expect(sleeps).toEqual([50, 100]);
  });

  it("rethrows a non-transient error at once", async () => {
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls++;
          throw new Error("constraint failed");
        },
        { isTransient: transient, sleep: async () => {} },
      ),
    ).rejects.toThrow("constraint failed");
    expect(calls).toBe(1);
  });
});

describe("isTransientD1Error", () => {
  it.each([
    "Network connection lost.",
    "D1_ERROR: Network connection lost.",
    "D1_ERROR: D1 DB is overloaded. Requests queued for too long.",
  ])("treats %j as transient", (message) => {
    expect(isTransientD1Error(new Error(message))).toBe(true);
  });

  it("does not treat a constraint or syntax error as transient", () => {
    expect(
      isTransientD1Error(new Error("D1_ERROR: UNIQUE constraint failed")),
    ).toBe(false);
    expect(isTransientD1Error("Network connection lost")).toBe(false);
  });
});

const doError = (
  message: string,
  flags: { retryable?: boolean; overloaded?: boolean } = {},
) => Object.assign(new Error(message), flags);

describe("isRetryableDOError", () => {
  it("follows the runtime's retryable flag", () => {
    expect(isRetryableDOError(doError("boom", { retryable: true }))).toBe(true);
    expect(
      isRetryableDOError(
        doError("internal error; reference = abc", { retryable: false }),
      ),
    ).toBe(false);
  });

  it("never retries an overloaded object", () => {
    expect(
      isRetryableDOError(
        doError("overloaded", { retryable: true, overloaded: true }),
      ),
    ).toBe(false);
  });

  it.each([
    "internal error; reference = 3vgd9oq0v3o0k8tm9q3pmk6c",
    "Network connection lost.",
  ])("treats an unflagged %j as transient", (message) => {
    expect(isRetryableDOError(new Error(message))).toBe(true);
  });

  it("does not retry an ordinary error or a non-Error", () => {
    expect(isRetryableDOError(new Error("TypeError: x is undefined"))).toBe(
      false,
    );
    expect(isRetryableDOError("internal error; reference = x")).toBe(false);
  });
});

describe("retryDurableObject", () => {
  it("retries an internal error, then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await retryDurableObject(
      async () => {
        if (++calls === 1) throw doError("internal error; reference = x");
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(sleeps).toEqual([0]);
  });

  it("gives up after three attempts", async () => {
    let calls = 0;
    await expect(
      retryDurableObject(
        async () => {
          calls++;
          throw doError("Network connection lost.");
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow("Network connection lost.");
    expect(calls).toBe(3);
  });
});
