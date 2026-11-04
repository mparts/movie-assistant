import { describe, expect, test } from "vitest";
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
  test("the latest wish replaces the old one", () => {
    const is = heard([{ type: "wish", text: "A funny heist." }], (s) => {
      s.wish = "A heist.";
    });
    expect(run("integrate_wish", is)!.wish).toBe("A funny heist.");
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
  test("rejecting \"Hereditary\" must not reject the movie \"Her\"", () => {
    const is = heard([{ type: "reject", title: "Hereditary" }], (s) => {
      s.candidates = [movie(10, "Her")];
    });
    expect(run("integrate_seen_reject", is)!.rejected).toEqual([]);
  });
});

describe("rules: question under discussion", () => {
  test("Jake's turn records what it left open, from the mode he replied in", () => {
    const after = (qud: IS["qud"], say: Move) => {
      const is = { ...freshIS(), qud };
      const heardSys = rules.get_latest_move({ is, latest_moves: [say], latest_speaker: "sys" })!();
      return run("integrate_qud", heardSys)?.qud ?? heardSys.qud;
    };
    const say = (mode?: "explore" | "clarify" | "recommend" | "wrapup", movieId?: number): Move => ({ type: "say", text: "x", mode, movieId });
    expect(after("none", say("explore"))).toBe("taste");
    expect(after("taste", say("recommend", 7))).toBe("suggestion");
    expect(after("suggestion", say("recommend"))).toBe("suggestion"); // answering "who's in it?"
    expect(after("suggestion", say("clarify"))).toBe("change");
    expect(after("suggestion", say("wrapup"))).toBe("none");
    expect(after("suggestion", say())).toBe("suggestion"); // no-input prompt or an error message
  });
});
