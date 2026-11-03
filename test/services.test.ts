import { describe, expect, test, vi } from "vitest";
import { createLlm, orderByPreference } from "../src/services/llm";
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

  test("Phase 1 adds certification and subscription platforms only when set", () => {
    const o = { language: "en-US", sortBy: "popularity.desc", minVotes: 100 };
    const c = { genres: [], matchAll: false, excludeGenres: [], runtime: {}, year: {}, page: 1 };
    const p = buildDiscoverParams({ ...c, certificationLte: "PG", watch: { region: "NL", providers: [8, 337] } }, new Map(), o);
    expect(p).toMatchObject({
      certification_country: "US", "certification.lte": "PG",
      watch_region: "NL", with_watch_providers: "8|337", with_watch_monetization_types: "flatrate",
    });
    expect(Object.keys(buildDiscoverParams(c, new Map(), o)).filter((k) => /cert|watch/.test(k))).toEqual([]);
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

  test("`prefer` can be an ordered list, and unlisted backends keep their configured order after it", () => {
    const b = ["groq", "ollama", "local"].map((name) => ({ name }));
    const order = (p?: string | string[]) => orderByPreference(b, p).map((x) => x.name);
    expect(order()).toEqual(["groq", "ollama", "local"]);
    expect(order("local")).toEqual(["local", "groq", "ollama"]);
    expect(order(["ollama", "local"])).toEqual(["ollama", "local", "groq"]);
    expect(order(["nobody"])).toEqual(["groq", "ollama", "local"]);
  });


});
