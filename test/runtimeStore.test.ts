import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SearchCriteria } from "../src/core/types";
import { createRuntimeFileStore } from "../src/services/runtimeStore";
import { createTmdb, type RuntimeStore } from "../src/services/tmdb";

let dir: string;
let file: string;
let movieCalls: number[]; // ids of every /movie/{id} request
let failIds: Set<number>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-"));
  file = join(dir, "sub", "runtimes.json");
  movieCalls = [];
  failIds = new Set();
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path.endsWith("/genre/movie/list")) return json({ genres: [{ id: 35, name: "Comedy" }] });
    if (path.endsWith("/discover/movie")) {
      const results = [1, 2, 3].map((id) => ({ id, title: `M${id}`, genre_ids: [35], vote_average: 7, vote_count: 100, overview: "x" }));
      return json({ total_pages: 1, total_results: 3, results });
    }
    const id = Number(path.split("/").pop());
    movieCalls.push(id);
    return failIds.has(id) ? json({}, 500) : json({ runtime: 90 + id });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const criteria: SearchCriteria = { genres: [], matchAll: false, excludeGenres: [], runtime: {}, year: {}, page: 1 };
const tmdb = (store?: RuntimeStore) =>
  createTmdb({
    baseUrl: "http://x", language: "en-US", sortBy: "popularity.desc", minVotes: 1, pagesPerBatch: 1, pageWindow: 1,
    runtimeLookupConcurrency: 2, retryDelayMs: 0, rateLimitRetries: 0, store,
  });

describe("runtime store", () => {
  test("a restart reuses saved runtimes and makes no /movie calls", async () => {
    const first = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria).then((r) => r.movies);
    expect(movieCalls.sort()).toEqual([1, 2, 3]);
    expect(first.map((m) => m.runtime)).toEqual([91, 92, 93]);

    movieCalls = [];
    const second = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria).then((r) => r.movies);
    expect(movieCalls).toEqual([]);
    expect(second.map((m) => m.runtime)).toEqual([91, 92, 93]);
  });

  test("failed lookups are not saved and are retried next time", async () => {
    failIds.add(3);
    const first = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria).then((r) => r.movies);
    expect(first.map((m) => m.runtime)).toEqual([91, 92, undefined]);
    expect(JSON.parse(readFileSync(file, "utf8")).entries).toEqual([[1, 91], [2, 92]]);

    movieCalls = [];
    failIds.clear();
    const second = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria).then((r) => r.movies);
    expect(movieCalls).toEqual([3]); // only the one that failed
    expect(second.map((m) => m.runtime)).toEqual([91, 92, 93]);
  });






});
