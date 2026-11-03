import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { rank } from "../src/core/ranking";
import { criteriaFromIS, initialIS } from "../src/core/state";
import { freshIS } from "./fixtures";
import { parseIntake } from "../src/core/intake";
import { recommendationReadiness } from "../src/core/readiness";
import type { Movie } from "../src/core/types";

const movie = (id: number, genres: string[]): Movie => ({ id, title: `M${id}`, genres, rating: 7, votes: 100, overview: "" });

describe("rank", () => {
  const is = () => {
    const s = freshIS();
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
    const s = freshIS();
    s.prefs.genres = ["Romance", "Comedy", "Action", "Thriller"];
    s.prefs.required = ["Romance", "Comedy"];
    expect(criteriaFromIS(s)).toMatchObject({ genres: ["Romance", "Comedy"], matchAll: true });
    s.prefs.required = [];
    expect(criteriaFromIS(s)).toMatchObject({ genres: ["Romance", "Comedy", "Action", "Thriller"], matchAll: false });
  });
});

describe("intake (Phase 1)", () => {
  test("every sample in profiles/ follows the contract", () => {
    for (const f of readdirSync("profiles")) expect(() => parseIntake(JSON.parse(readFileSync(`profiles/${f}`, "utf8")))).not.toThrow();
  });

  const sample = {
    profile: { name: "Sam", age: 38, country: "NL", platforms: [8, 337] },
    tonight: { maxMinutes: 100, avoidGenres: ["Horror"], company: "family", youngestAge: 8 },
  };

  test("parseIntake accepts the contract, rejects bad input, and uses the user's age when watching alone", () => {
    expect(parseIntake(sample)).toEqual(sample);
    expect(() => parseIntake({ ...sample, tonight: { ...sample.tonight, avoidGenres: ["Scary"] } })).toThrow(/avoidGenres/);
    expect(parseIntake({ ...sample, tonight: { ...sample.tonight, company: "alone" } }).tonight.youngestAge).toBe(38);
  });

  test("the chat can only narrow Phase 1: a longer limit is capped, avoided genres are added", () => {
    const s = initialIS(parseIntake(sample));
    s.constraints.runtime = { min: 110, max: 140 };
    s.dislikes.genres = ["War"];
    expect(criteriaFromIS(s)).toMatchObject({
      runtime: { max: 100 }, excludeGenres: ["War", "Horror"], certificationLte: "PG",
      watch: { region: "NL", providers: [8, 337] },
    });
    expect(criteriaFromIS(s).runtime.min).toBe(60); // a chat minimum above the limit falls back to the no-shorts floor
    s.constraints.runtime = { max: 80 };
    expect(criteriaFromIS(s).runtime.max).toBe(80);
  });
});

describe("readiness", () => {

  test("taste + enough turns and signals is ready; \"just pick\" skips the wait", () => {
    const s = freshIS();
    s.prefs.genres = ["Comedy"];
    expect(recommendationReadiness(s).ready).toBe(false);
    s.readiness = { meaningfulTurns: 2, evidence: ["genre:Comedy", "runtime"] };
    expect(recommendationReadiness(s).ready).toBe(true);

    const t = freshIS();
    t.prefs.genres = ["Comedy"];
    t.history = [{ speaker: "usr", text: "just pick one" }];
    expect(recommendationReadiness(t).ready).toBe(true);
  });
});
