import { Movie, SearchCriteria, TmdbClient } from "./types";

export interface TmdbOptions {
  /** "/tmdb" in the browser (Vite proxy adds the token); "https://api.themoviedb.org/3" in node. */
  baseUrl: string;
  headers?: Record<string, string>;
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

export function createTmdb({ baseUrl, headers }: TmdbOptions): TmdbClient {
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
      const data = await get("/discover/movie", buildDiscoverParams(criteria, g.byName));
      const movies = (data.results as any[]).map((r) => toMovie(r, g.byId));
      // Discover results carry no runtime; look each one up (in parallel) so the assistant never has to guess.
      await Promise.all(
        movies.map(async (m) => {
          try {
            const d = await get(`/movie/${m.id}`, { language: "en-US" });
            if (typeof d.runtime === "number" && d.runtime > 0) m.runtime = d.runtime;
          } catch {
            /* runtime stays unknown */
          }
        })
      );
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
