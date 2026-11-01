import { Movie, SearchCriteria, TmdbClient } from "./types";

export interface TmdbOptions {
  /** "/tmdb" in the browser (Vite proxy adds the token); "https://api.themoviedb.org/3" in node. */
  baseUrl: string;
  headers?: Record<string, string>;
  /** TMDB pages fetched per search batch (20 movies each). */
  pagesPerSearch?: number;
  /** Pages of popularity-sorted results the session may draw from, in a per-session random order. */
  pageWindow?: number;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type GenreMaps = { byName: Map<string, number>; byId: Map<number, string> };

/** Pure: our criteria (genre NAMES) → TMDB /discover/movie query parameters. */
export function buildDiscoverParams(
  c: SearchCriteria,
  idByName: Map<string, number>
): Record<string, string> {
  const ids = (names: string[]) =>
    names.flatMap((n) => (idByName.has(n) ? [idByName.get(n)!] : []));
  const p: Record<string, string> = {
    include_adult: "false",
    language: "en-US",
    sort_by: "popularity.desc",
    "vote_count.gte": "100", // keeps obscure titles out; tune
    page: String(c.page),
  };
  const withIds = ids(c.genres);
  const withoutIds = ids(c.excludeGenres);
  if (withIds.length) p.with_genres = withIds.join("|"); // OR
  if (withoutIds.length) p.without_genres = withoutIds.join(",");
  if (c.runtime.min !== undefined) p["with_runtime.gte"] = String(c.runtime.min);
  if (c.runtime.max !== undefined) p["with_runtime.lte"] = String(c.runtime.max);
  if (c.year.min !== undefined) p["primary_release_date.gte"] = `${c.year.min}-01-01`;
  if (c.year.max !== undefined) p["primary_release_date.lte"] = `${c.year.max}-12-31`;
  if (c.rating !== undefined) p["vote_average.gte"] = String(c.rating);
  if (c.language) p.with_original_language = c.language;
  return p;
}

export function createTmdb({ baseUrl, headers, pagesPerSearch = 3, pageWindow = 12 }: TmdbOptions): TmdbClient {
  // Popularity-sorted discover always returns the same top titles. A random page order per session
  // (fixed for the session, so repeated searches stay consistent) varies the pool between conversations.
  const pageOrder = shuffle(Array.from({ length: pageWindow }, (_, i) => i + 1));
  const runtimes = new Map<number, number>();

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = `${baseUrl}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers });
      if (res.status === 429 && attempt === 0) {
        await sleep(1000); // TMDB asks clients to respect 429
        continue;
      }
      if (!res.ok) throw new Error(`TMDB ${path} HTTP ${res.status}`);
      return res.json();
    }
  }

  let genres: Promise<GenreMaps> | undefined;
  const loadGenres = () => {
    genres ??= get("/genre/movie/list", { language: "en" })
      .then((d) => ({
        byName: new Map<string, number>(d.genres.map((g: any) => [g.name, g.id])),
        byId: new Map<number, string>(d.genres.map((g: any) => [g.id, g.name])),
      }))
      .catch((e) => {
        genres = undefined; // retry next time
        throw e;
      });
    return genres;
  };

  const toMovie = (r: any, byId: Map<number, string>): Movie => ({
    id: r.id,
    title: r.title,
    year: r.release_date ? parseInt(String(r.release_date).slice(0, 4), 10) || undefined : undefined,
    genres: ((r.genre_ids ?? []) as number[]).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    rating: r.vote_average ?? 0,
    votes: r.vote_count ?? 0,
    overview: r.overview ?? "",
    posterPath: r.poster_path ?? undefined,
  });

  return {
    async discover(criteria) {
      const g = await loadGenres();
      const params = buildDiscoverParams(criteria, g.byName);
      // Page 1 doubles as a probe: it tells us how many pages this query really has.
      const probe = await get("/discover/movie", { ...params, page: "1" });
      const available = Math.min(probe.total_pages ?? 1, pageWindow);
      const start = (criteria.page - 1) * pagesPerSearch;
      const pages = pageOrder.filter((p) => p <= available).slice(start, start + pagesPerSearch);
      const responses = await Promise.all(
        pages.map((p) => (p === 1 ? probe : get("/discover/movie", { ...params, page: String(p) })))
      );
      const seen = new Set<number>();
      const movies = responses
        .flatMap((d) => d.results as any[])
        .map((r) => toMovie(r, g.byId))
        .filter((m) => !seen.has(m.id) && !!seen.add(m.id));
      // Discover results carry no runtime; look them up (10 at a time, cached) so the assistant never has to guess.
      const todo = movies.filter((m) => !runtimes.has(m.id));
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(10, todo.length) }, async () => {
          while (next < todo.length) {
            const m = todo[next++];
            try {
              const d = await get(`/movie/${m.id}`, { language: "en-US" });
              if (typeof d.runtime === "number" && d.runtime > 0) runtimes.set(m.id, d.runtime);
            } catch {
              /* runtime stays unknown */
            }
          }
        })
      );
      movies.forEach((m) => {
        const r = runtimes.get(m.id);
        if (r) m.runtime = r;
      });
      return movies;
    },
    async searchMovie(title) {
      const g = await loadGenres();
      const data = await get("/search/movie", { query: title, include_adult: "false", page: "1" });
      const hit = (data.results as any[])[0];
      return hit ? toMovie(hit, g.byId) : null;
    },
  };
}