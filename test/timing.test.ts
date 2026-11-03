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



});
