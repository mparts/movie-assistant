import { describe, expect, test } from "vitest";
import { GENRES, MOODS, MOOD_SYNONYMS, resolveGenres, resolvePreference, synonymGenres } from "../src/core/lexicon";

describe("lexicon", () => {
  test("moods and genres resolve to TMDB genre names", () => {
    expect(resolveGenres("exciting")).toEqual(["Action", "Thriller", "Adventure"]);
    expect(resolveGenres("Sci-Fi")).toEqual(["Science Fiction"]);
    expect(resolveGenres("comedy movies")).toEqual(["Comedy"]);
    expect(resolveGenres("horror")).toEqual(["Horror"]);
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

  test("synonyms of a mood give that mood's genres, and nothing else does", () => {
    expect(synonymGenres("goofy")).toEqual(["Comedy"]);
    expect(synonymGenres("Goofy movies")).toEqual(["Comedy"]);
    expect(synonymGenres("heartfelt")).toEqual(["Drama"]);
    expect(synonymGenres("wholesome")).toEqual(["Comedy", "Family"]);
    expect(synonymGenres("cozy")).toEqual([]); // unknown: stays a plain vibe
    expect(synonymGenres("funny")).toEqual([]); // a real mood: handled by resolvePreference
    expect(synonymGenres(undefined)).toEqual([]);
  });

  test("the synonym table stays consistent with the canonical lists", () => {
    for (const [word, mood] of Object.entries(MOOD_SYNONYMS)) {
      expect(MOODS[mood], `${word} → ${mood}`).toBeDefined();
      expect(resolvePreference(word).names, `${word} must not be a mood, genre or alias already`).toEqual([]);
      expect(GENRES.map((g) => g.toLowerCase())).not.toContain(word);
    }
  });


});
