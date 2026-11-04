import { describe, expect, test } from "vitest";
import { resolveGenres, wordsFor } from "../src/core/lexicon";

describe("lexicon", () => {
  test("genre names and aliases resolve to TMDB genres; a combination names both; moods are not genres", () => {
    expect(resolveGenres("sci-fi movies")).toEqual(["Science Fiction"]);
    expect(resolveGenres("romcom")).toEqual(["Romance", "Comedy"]);
    expect(resolveGenres("family")).toEqual(["Family"]);
    expect(resolveGenres("funny")).toEqual([]);
    expect(wordsFor(["Comedy"])).toEqual(expect.arrayContaining(["comedy", "comedies", "romcom"]));
  });
});
