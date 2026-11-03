import { describe, expect, test } from "vitest";
import { settings } from "../src/config/settings";
import { movieScore, rank, rankWithSemantics } from "../src/core/ranking";
import { freshIS } from "./fixtures";
import type { Movie } from "../src/core/types";

const movie = (id: number, over: Partial<Movie> = {}): Movie => ({
  id, title: `M${id}`, genres: [], rating: 7, votes: 100, overview: "x", ...over,
});

describe("movieScore factors", () => {
  test("a high rating from very few votes is pulled toward the average", () => {
    const { votes: priorVotes, mean } = settings.ranking.ratingPrior;
    const is = freshIS();
    const few = movieScore(is, movie(1, { rating: 9, votes: 3 })).rating;
    const many = movieScore(is, movie(2, { rating: 8, votes: 10000 })).rating;
    expect(few).toBeCloseTo((3 * 9 + priorVotes * mean) / (3 + priorVotes) / 10);
    expect(many).toBeGreaterThan(few); // 8/10 with 10,000 votes beats 9/10 with 3
  });

  test("runtime fit: neutral if unknown, full for well under a limit, zero past it", () => {
    const fit = (runtime: number | undefined, range: { min?: number; max?: number }) => {
      const is = freshIS();
      is.constraints.runtime = range;
      return movieScore(is, movie(1, { runtime })).runtime;
    };
    expect(fit(undefined, { max: 100 })).toBe(settings.ranking.neutral);
    expect(fit(30, { max: 100 })).toBe(1);
    expect(fit(130, { max: 100 })).toBe(0);
    expect(fit(100, { min: 90, max: 110 })).toBe(1); // dead centre of the band
    expect(fit(120, { min: 90, max: 110 })).toBe(0); // outside it
    expect(fit(100, {})).toBe(settings.ranking.neutral); // no preference
  });
});

describe("rejection signal", () => {
  const rejectedHeist = { id: 99, reason: "no" as const, genres: ["Comedy", "Crime"], overview: "a heist with friends" };
  const sibling = movie(1, { genres: ["Comedy", "Crime"], overview: "a heist gone wrong" });
  const other = movie(2, { genres: ["Drama"], overview: "a quiet family story" });
  const stateWith = (...rejected: object[]) => {
    const is = freshIS();
    is.rejected = rejected as typeof is.rejected;
    return is;
  };



  test("the sibling of a rejected movie ranks below an otherwise equal movie", () => {
    expect(rank(freshIS(), [sibling, other]).map((m) => m.id)).toEqual([1, 2]); // tie: original order
    expect(rank(stateWith(rejectedHeist), [sibling, other]).map((m) => m.id)).toEqual([2, 1]);
  });

  test("genres the user asked for are not a reason to penalise: rejecting one rom-com leaves other rom-coms alone", () => {
    const wanting = (...rejected: object[]) => {
      const is = stateWith(...rejected);
      is.prefs.genres = ["Romance", "Comedy"];
      return is;
    };
    const rejectedRomcom = { id: 99, reason: "no" as const, genres: ["Comedy", "Romance"], overview: "" };
    const otherRomcom = movie(3, { genres: ["Comedy", "Romance"], overview: "" });
    const animated = movie(4, { genres: ["Animation", "Comedy", "Family"], overview: "" });
    const is = wanting(rejectedRomcom);
    expect(movieScore(is, otherRomcom).rejection).toBe(0);
    expect(movieScore(is, animated).rejection).toBe(0);
    // the exact-match lead is the same as before the rejection
    const lead = (s: typeof is) => movieScore(s, otherRomcom).total - movieScore(s, animated).total;
    expect(lead(is)).toBeCloseTo(lead(wanting()));
  });


  test("\"already seen\" is not a dislike: it gives no penalty", () => {
    const is = stateWith({ ...rejectedHeist, reason: "seen" });
    expect(movieScore(is, sibling).rejection).toBe(0);
    expect(rank(is, [sibling, other]).map((m) => m.id)).toEqual([1, 2]);
  });


});

describe("rankWithSemantics", () => {
  test("semantic similarity breaks ties between equally scored movies", () => {
    const movies = [movie(1), movie(2)];
    const order = (scores: [number, number][]) =>
      rankWithSemantics(freshIS(), movies, new Map(scores)).map((m) => m.id);
    expect(order([[1, 0.2], [2, 0.9]])).toEqual([2, 1]);
    expect(order([[1, 0.9], [2, 0.2]])).toEqual([1, 2]);
    expect(order([[1, 0.5], [2, 0.5]])).toEqual([1, 2]); // all equal: original order kept
  });


});
