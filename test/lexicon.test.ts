import { describe, expect, test } from "vitest";
import { languageCode, resolveGenres, resolvePreference, resolveTone } from "../src/core/lexicon";

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

  test("named genres and single-genre moods are required; multi-genre moods are alternatives", () => {
    expect(resolvePreference("Comedy")).toEqual({ names: ["Comedy"], required: true });
    expect(resolvePreference("romantic")).toEqual({ names: ["Romance"], required: true });
    expect(resolvePreference("romcom")).toEqual({ names: ["Romance", "Comedy"], required: true });
    expect(resolvePreference("romantic comedy")).toEqual({ names: ["Romance", "Comedy"], required: true });
    expect(resolvePreference("exciting")).toEqual({ names: ["Action", "Thriller", "Adventure"], required: false });
    expect(resolvePreference("Family")).toEqual({ names: ["Family"], required: true }); // the genre, not the mood
    expect(resolvePreference("gibberish")).toEqual({ names: [], required: false });
  });

  test("languages", () => {
    expect(languageCode("Korean")).toBe("ko");
    expect(languageCode("fr")).toBe("fr");
    expect(languageCode("klingon")).toBeUndefined();
  });
});
