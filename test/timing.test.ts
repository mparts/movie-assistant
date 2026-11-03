import { afterEach, describe, expect, test, vi } from "vitest";
import { flushTimings, timed } from "../src/core/util";

afterEach(() => {
  flushTimings(); // clear any leftovers between tests
  delete (globalThis as any).DME_DEBUG;
  vi.restoreAllMocks();
});

describe("per-turn timings", () => {
  test("timed returns the wrapped result and counts calls per stage", async () => {
    (globalThis as any).DME_DEBUG = true;
    expect(await timed("TMDB", async () => 42)).toBe(42);
    await timed("TMDB", async () => "x");
    await timed("NLU", async () => null);

    const line = flushTimings()!;
    expect(line).toMatch(/^\[timing\] TMDB \d+ms \(2 calls\) · NLU \d+ms \(1 call\)$/);
  });

  test("a failing call still counts and still rethrows", async () => {
    (globalThis as any).DME_DEBUG = true;
    await expect(timed("respond", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(flushTimings()).toMatch(/respond \d+ms \(1 call\)/);
  });

  test("flush prints only in debug mode, and always starts the next turn from zero", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await timed("NLU", async () => 1);
    expect(flushTimings()).toBeUndefined(); // not debug: nothing printed
    expect(log).not.toHaveBeenCalled();

    (globalThis as any).DME_DEBUG = true;
    expect(flushTimings()).toBeUndefined(); // the NLU total was cleared above
  });
});
