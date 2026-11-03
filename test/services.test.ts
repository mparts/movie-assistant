import { describe, expect, test, vi } from "vitest";
import { cosine01 } from "../src/services/embeddings";
import { createLlm } from "../src/services/llm";
import { buildDiscoverParams } from "../src/services/tmdb";

describe("tmdb params", () => {
  test("maps criteria to discover query", () => {
    const ids = new Map([["Comedy", 35], ["Horror", 27], ["Crime", 80]]);
    const p = buildDiscoverParams(
      { genres: ["Comedy", "Crime"], matchAll: false, excludeGenres: ["Horror"], runtime: { max: 100 }, year: { min: 2010 }, rating: 7, page: 2 },
      ids,
      { language: "en-US", sortBy: "popularity.desc", minVotes: 100 }
    );
    expect(p).toMatchObject({
      with_genres: "35|80", without_genres: "27", "with_runtime.lte": "100",
      "primary_release_date.gte": "2010-01-01", "vote_average.gte": "7", "vote_count.gte": "100", page: "2",
    });
  });

  test("named genres are combined with AND, alternatives with OR", () => {
    const ids = new Map([["Romance", 10749], ["Comedy", 35]]);
    const o = { language: "en-US", sortBy: "popularity.desc", minVotes: 100 };
    const c = { genres: ["Romance", "Comedy"], excludeGenres: [], runtime: {}, year: {}, page: 1 };
    expect(buildDiscoverParams({ ...c, matchAll: true }, ids, o).with_genres).toBe("10749,35");
    expect(buildDiscoverParams({ ...c, matchAll: false }, ids, o).with_genres).toBe("10749|35");
  });
});

describe("embeddings", () => {
  test("cosine maps to 0..1", () => {
    expect(cosine01([1, 0], [1, 0])).toBe(1);
    expect(cosine01([1, 0], [-1, 0])).toBe(0);
    expect(cosine01([1, 0], [0, 1])).toBeCloseTo(0.5);
  });
});

describe("llm fallback", () => {
  test("falls back to the next backend; `prefer` goes first", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return url.startsWith("http://a")
        ? new Response("boom", { status: 500 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mk = (n: string) => ({ name: n, baseUrl: `http://${n}`, model: "m", timeoutMs: 1000 });
    const llm = createLlm([mk("a"), mk("b")]);
    expect(await llm.json([])).toEqual({ ok: true });
    expect(calls).toEqual(["http://a/chat/completions", "http://b/chat/completions"]);
    calls.length = 0;
    await llm.json([], { prefer: "b" });
    expect(calls).toEqual(["http://b/chat/completions"]);
    vi.unstubAllGlobals();
  });
});
