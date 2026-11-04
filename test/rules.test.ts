import { describe, expect, test } from "vitest";
import { notices } from "../src/config/prompts";
import { rules } from "../src/core/rules";
import { freshIS } from "./fixtures";
import type { InformationState as IS, Move, Movie } from "../src/core/types";

const movie = (id: number, title: string): Movie => ({ id, title, genres: [], rating: 7, votes: 100, overview: "" });

/** A state whose latest utterance is the user's, carrying these moves. */
const heard = (moves: Move[], setup: (is: IS) => void = () => {}): IS => {
  const is = freshIS();
  is.shared = { lu: { speaker: "usr", moves } };
  setup(is);
  return is;
};
/** Run a rule: the new state if it applies, undefined if not. */
const run = (name: string, is: IS): IS | undefined => rules[name]({ is })?.();

describe("rules: taste", () => {
  test("the latest wish replaces the old one; a negated genre moves from wanted to avoided", () => {
    const is = heard([{ type: "wish", text: "A funny heist." }, { type: "prefer", genre: "comedies", negated: true }], (s) => {
      s.wish = "A heist.";
      s.genres = ["Comedy", "Crime"];
    });
    const next = run("integrate_prefer", run("integrate_wish", is)!)!;
    expect(next.wish).toBe("A funny heist.");
    expect([next.genres, next.avoidGenres]).toEqual([["Crime"], ["Comedy"]]);
  });

  test("time is tonight's setting: a runtime request changes nothing but tells Jake so", () => {
    const next = run("integrate_constrain", heard([{ type: "constrain", slot: "runtime", op: "lte", value: 90 }]))!;
    expect(next.constraints).toEqual({ year: {} });
    expect(next.private.notices).toEqual([notices.timeInSettings]);
  });
});

describe("rules: suggestion streak", () => {
  test("any feedback from the user ends a run of suggestions; silence or a vague reply does not", () => {
    const is = freshIS();
    is.recommendStreak = 2;
    const after = (moves: Move[]) => rules.get_latest_move({ is, latest_moves: moves, latest_speaker: "usr", latest_text: "x" })!().recommendStreak;
    expect(after([{ type: "seen", title: "Sing 2" }])).toBe(0);
    expect(after([{ type: "reject" }])).toBe(0);
    expect(after([])).toBe(2);
    expect(after([{ type: "noinput" }])).toBe(2);
  });
});

describe("rules: naming a movie", () => {
  // Found while writing these tests: findMovie matches titles by substring in both directions, so a short
  // title inside a longer one is matched by mistake. Remove `.fails` once findMovie is fixed.
  test.fails("rejecting \"Hereditary\" must not reject the movie \"Her\"", () => {
    const is = heard([{ type: "reject", title: "Hereditary" }], (s) => {
      s.candidates = [movie(10, "Her")];
    });
    expect(run("integrate_seen_reject", is)!.rejected).toEqual([]);
  });
});
