import { describe, expect, it, vi } from "vitest";

import { isTransientQueueError, retryQueue } from "../src/queue.ts";

const noSleep = () => Promise.resolve();

describe("isTransientQueueError", () => {
  it.each([
    "Queue is overloaded. Please back off. (10250)",
    "queue is overloaded",
    "Something failed (10250)",
    "Network connection lost.",
    "internal error; reference = abc123",
    "internal error",
  ])("retries %s", (message) => {
    expect(isTransientQueueError(new Error(message))).toBe(true);
  });

  it("does not retry other errors or non-Errors", () => {
    expect(isTransientQueueError(new Error("Queue not found (11000)"))).toBe(
      false,
    );
    expect(isTransientQueueError("Queue is overloaded")).toBe(false);
  });
});

describe("retryQueue", () => {
  it("retries an overloaded queue until it succeeds", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Queue is overloaded. (10250)"))
      .mockResolvedValue("ok");
    await expect(retryQueue(run, { sleep: noSleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after 4 attempts", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("Queue is overloaded. (10250)"));
    await expect(retryQueue(run, { sleep: noSleep })).rejects.toThrow(
      /overloaded/,
    );
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("throws other errors at once", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("bad payload"));
    await expect(retryQueue(run, { sleep: noSleep })).rejects.toThrow(
      "bad payload",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
