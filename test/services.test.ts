import { describe, expect, test, vi } from "vitest";
import { createLlm, orderByPreference } from "../src/services/llm";
import { buildDiscoverParams } from "../src/services/tmdb";
import { fitsRating } from "../src/services/catalogue";
import type { Movie, SearchCriteria } from "../src/core/types";

describe("age limit", () => {
  test("unrated (NR) movies only fit when there is no age limit", () => {
    const c: SearchCriteria = { excludeGenres: [], runtime: {}, year: {} };
    const movie = (certification?: string) => ({ certification }) as Movie;
    const underPG = (cert?: string) => fitsRating(movie(cert), { ...c, certificationLte: "PG" });
    expect(underPG("NR")).toBe(false);
    expect(underPG("")).toBe(false);
    expect(underPG(undefined)).toBe(false);
    expect(underPG("PG")).toBe(true);
    expect(underPG("R")).toBe(false);
    expect(fitsRating(movie("NR"), c)).toBe(true);
  });
});

describe("tmdb params", () => {
  test("Phase 1 maps to the discover query; certification and platforms only when set", () => {
    const o = { language: "en-US", minVotes: 100 };
    const c = { excludeGenres: ["Horror"], runtime: { min: 60, max: 100 }, year: {} };
    const p = buildDiscoverParams({ ...c, certificationLte: "PG", watch: { region: "NL", providers: [8, 337] } }, new Map([["Horror", 27]]), o);
    expect(p).toMatchObject({
      without_genres: "27", "with_runtime.gte": "60", "with_runtime.lte": "100", "vote_count.gte": "100",
      sort_by: "primary_release_date.asc",
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
