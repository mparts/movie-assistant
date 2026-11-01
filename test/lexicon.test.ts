import { describe, expect, test } from "vitest";
import { languageCode, resolveGenres, resolveTone } from "../src/core/lexicon";

describe("lexicon", () => {
  test("moods and genres resolve to TMDB genre names", () => {
    expect(resolveGenres("exciting")).toEqual(["Action", "Thriller", "Adventure"]);
    expect(resolveGenres("Sci-Fi")).toEqual(["Science Fiction"]);
    expect(resolveGenres("comedy movies")).toEqual(["Comedy"]);
    expect(resolveGenres("horror")).toEqual(["Horror"]);
  });

  test("unknown text resolves to nothing", () => {
    expect(resolveGenres("gibberish")).toEqual([]);
    expect(resolveGenres(undefined)).toEqual([]);
  });

  test("comparatives resolve through moods", () => {
    expect(resolveTone("funnier")).toEqual(["Comedy"]);
    expect(resolveTone("more exciting")).toEqual(["Action", "Thriller", "Adventure"]);
    expect(resolveTone("scarier")).toEqual(["Horror"]);
  });

  test("languages", () => {
    expect(languageCode("Korean")).toBe("ko");
    expect(languageCode("fr")).toBe("fr");
    expect(languageCode("klingon")).toBeUndefined();
  });
});
