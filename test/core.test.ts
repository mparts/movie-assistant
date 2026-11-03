import { describe, expect, test } from "vitest";
import { rank } from "../src/core/ranking";
import { criteriaFromIS, initialIS } from "../src/core/state";
import { recommendationReadiness } from "../src/core/readiness";
import type { Movie } from "../src/core/types";

const movie = (id: number, genres: string[]): Movie => ({ id, title: `M${id}`, genres, rating: 7, votes: 100, overview: "" });

describe("rank", () => {
  const is = () => {
    const s = initialIS();
    s.prefs.genres = ["Comedy", "Crime"];
    return s;
  };

  test("orders by genre overlap, keeping TMDB order within ties", () => {
    const movies = [movie(1, ["Drama"]), movie(2, ["Comedy"]), movie(3, ["Crime", "Comedy"]), movie(4, ["Crime"])];
    expect(rank(is(), movies).map((m) => m.id)).toEqual([3, 2, 4, 1]);
  });

  test("drops recommended, rejected and disliked movies", () => {
    const s = is();
    s.recommended = [movie(1, ["Comedy"])];
    s.rejected = [{ id: 2, reason: "no" }];
    s.dislikes.genres = ["Horror"];
    const movies = [movie(1, ["Comedy"]), movie(2, ["Comedy"]), movie(3, ["Comedy", "Horror"]), movie(4, ["Comedy"])];
    expect(rank(s, movies).map((m) => m.id)).toEqual([4]);
  });
});

describe("information state", () => {


  test("named genres are searched together; without them, mood genres are alternatives", () => {
    const s = initialIS();
    s.prefs.genres = ["Romance", "Comedy", "Action", "Thriller"];
    s.prefs.required = ["Romance", "Comedy"];
    expect(criteriaFromIS(s)).toMatchObject({ genres: ["Romance", "Comedy"], matchAll: true });
    s.prefs.required = [];
    expect(criteriaFromIS(s)).toMatchObject({ genres: ["Romance", "Comedy", "Action", "Thriller"], matchAll: false });
  });
});

describe("readiness", () => {

  test("taste + enough turns and signals is ready; \"just pick\" skips the wait", () => {
    const s = initialIS();
    s.prefs.genres = ["Comedy"];
    expect(recommendationReadiness(s).ready).toBe(false);
    s.readiness = { meaningfulTurns: 2, evidence: ["genre:Comedy", "runtime"] };
    expect(recommendationReadiness(s).ready).toBe(true);

    const t = initialIS();
    t.prefs.genres = ["Comedy"];
    t.history = [{ speaker: "usr", text: "just pick one" }];
    expect(recommendationReadiness(t).ready).toBe(true);
  });
});
