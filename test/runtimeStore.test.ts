import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      return json({ total_pages: 1, results });
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

const criteria: SearchCriteria = { genres: [], excludeGenres: [], runtime: {}, year: {}, page: 1 };
const tmdb = (store?: RuntimeStore) =>
  createTmdb({
    baseUrl: "http://x", language: "en-US", sortBy: "popularity.desc", minVotes: 1, pagesPerBatch: 1, pageWindow: 1,
    runtimeLookupConcurrency: 2, retryDelayMs: 0, rateLimitRetries: 0, store,
  });

describe("runtime store", () => {
  test("a restart reuses saved runtimes and makes no /movie calls", async () => {
    const first = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria);
    expect(movieCalls.sort()).toEqual([1, 2, 3]);
    expect(first.map((m) => m.runtime)).toEqual([91, 92, 93]);

    movieCalls = [];
    const second = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria);
    expect(movieCalls).toEqual([]);
    expect(second.map((m) => m.runtime)).toEqual([91, 92, 93]);
  });

  test("failed lookups are not saved and are retried next time", async () => {
    failIds.add(3);
    const first = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria);
    expect(first.map((m) => m.runtime)).toEqual([91, 92, undefined]);
    expect(JSON.parse(readFileSync(file, "utf8")).entries).toEqual([[1, 91], [2, 92]]);

    movieCalls = [];
    failIds.clear();
    const second = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria);
    expect(movieCalls).toEqual([3]); // only the one that failed
    expect(second.map((m) => m.runtime)).toEqual([91, 92, 93]);
  });

  test("a corrupt cache file is ignored and replaced", async () => {
    await tmdb(createRuntimeFileStore(file, 100)).discover(criteria); // creates the folder and file
    writeFileSync(file, "{ not json");
    movieCalls = [];
    const movies = await tmdb(createRuntimeFileStore(file, 100)).discover(criteria);
    expect(movieCalls.sort()).toEqual([1, 2, 3]);
    expect(movies.map((m) => m.runtime)).toEqual([91, 92, 93]);
    expect(JSON.parse(readFileSync(file, "utf8")).entries).toHaveLength(3);
  });

  test("invalid entries are skipped on load", () => {
    const store = createRuntimeFileStore(file, 100);
    store.save(new Map([[1, 100]]));
    writeFileSync(file, JSON.stringify({ entries: [[1, 100], [2, -5], [3, 0], ["x", 90], [4, 90.5], [5], "bad", [6, 120]] }));
    expect([...store.load()]).toEqual([[1, 100], [6, 120]]);
  });

  test("the oldest entries are dropped beyond maxEntries, and age order survives a reload", () => {
    const store = createRuntimeFileStore(file, 2);
    store.save(new Map([[30, 90], [10, 100], [20, 110]]));
    expect([...store.load()]).toEqual([[10, 100], [20, 110]]); // not re-sorted by id
  });

  test("a missing file loads as empty", () => {
    expect(createRuntimeFileStore(join(dir, "nope.json"), 10).load().size).toBe(0);
  });

  test("without a store, behaviour is unchanged: memory cache only", async () => {
    const t = tmdb();
    await t.discover(criteria);
    movieCalls = [];
    await t.discover(criteria);
    expect(movieCalls).toEqual([]); // same instance: served from memory
    await tmdb().discover(criteria);
    expect(movieCalls.sort()).toEqual([1, 2, 3]); // a new instance starts empty
  });
});
