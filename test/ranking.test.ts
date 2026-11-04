import { describe, expect, test } from "vitest";
import type { Pool } from "../src/core/pool";
import { rankPool } from "../src/core/ranking";
import type { Movie } from "../src/core/types";
import { freshIS } from "./fixtures";

/** A tiny pool: each movie's vector is a direction in 3-D, so similarity is easy to read. */
const movie = (id: number, extra: Partial<Movie> = {}): Movie => ({ id, title: `M${id}`, genres: [], rating: 7, votes: 100, overview: "x", ...extra });
function pool(entries: [Movie, number[]][]): Pool {
  return { movies: entries.map(([m]) => m), vectors: new Map(entries.map(([m, v]) => [m.id, Float32Array.from(v)])), embeddedNow: 0, ms: 0, source: "catalogue" };
}
const ids = (p: Pool, is = freshIS(), q = {}) => rankPool(is, p, { avoid: [], ...q }).map((s) => s.movie.id);

describe("rankPool", () => {
  // 1 is closest to the wish; 2 is a near twin of 1; 3 is somewhat close; 4 is far.
  const p = pool([
    [movie(1), [1, 0, 0]],
    [movie(2), [0.99, 0.14, 0]],
    [movie(3), [0.7, 0.7, 0]],
    [movie(4), [0, 0, 1]],
  ]);
  const wish = Float32Array.from([1, 0.05, 0]);

  test("the wish orders the pool; suggested, seen and turned-down movies are gone", () => {
    expect(ids(p, freshIS(), { wish })).toEqual([1, 2, 3, 4]);
    const is = freshIS();
    is.recommended = [movie(1)];
    is.rejected = [{ id: 3, reason: "seen" }];
    expect(ids(p, is, { wish })).toEqual([2, 4]);
  });

  test("a turned-down movie sinks its twin; 'already seen' sinks nothing", () => {
    const no = freshIS();
    no.rejected = [{ id: 1, reason: "no" }];
    expect(ids(p, no, { wish }).indexOf(2)).toBeGreaterThan(0);
    const seen = freshIS();
    seen.rejected = [{ id: 1, reason: "seen" }];
    expect(ids(p, seen, { wish })[0]).toBe(2);
  });

  test("people: a wanted one comes first, an avoided one is gone", () => {
    const q = pool([
      [movie(1, { cast: ["Keanu Reeves"] }), [0, 0, 1]],
      [movie(2, { directors: ["Christopher Nolan"], genres: ["Drama"] }), [1, 0, 0]],
      [movie(3, { cast: ["Adam Sandler"] }), [0.9, 0.1, 0]],
    ]);
    const is = freshIS();
    is.people = [{ name: "keanu reeves", negated: false }, { name: "Sandler", negated: true }];
    expect(ids(q, is, { wish })).toEqual([1, 2]);
  });
});
