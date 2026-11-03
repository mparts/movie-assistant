import { describe, expect, test } from "vitest";
import { notices } from "../src/config/prompts";
import { settings } from "../src/config/settings";
import { rules } from "../src/core/rules";
import { initialIS } from "../src/core/state";
import type { InformationState as IS, Move, Movie } from "../src/core/types";

const movie = (id: number, title: string): Movie => ({ id, title, genres: [], rating: 7, votes: 100, overview: "" });

/** A state whose latest utterance is the user's, carrying these moves. */
const heard = (moves: Move[], setup: (is: IS) => void = () => {}): IS => {
  const is = initialIS();
  is.shared = { lu: { speaker: "usr", moves } };
  setup(is);
  return is;
};
/** Run a rule: the new state if it applies, undefined if not. */
const run = (name: string, is: IS): IS | undefined => rules[name]({ is })?.();

describe("rules: preferences and search", () => {
  test("a negated genre moves from wanted to disliked, and the search becomes stale", () => {
    const is = heard([{ type: "prefer", genre: "Horror", negated: true }], (s) => {
      s.prefs.genres = ["Horror", "Comedy"];
    });
    const next = run("integrate_prefer", is)!;
    expect(next.prefs.genres).toEqual(["Comedy"]);
    expect(next.dislikes.genres).toEqual(["Horror"]);
    expect(next.search.status).toBe("dirty");
  });

  test("the search is marked stale only when the TMDB query really changes", () => {
    const setup = (s: IS) => {
      s.constraints.runtime = { max: 100 };
      s.candidates = [movie(1, "A")];
    };
    // same limit again: nothing changes, candidates stay
    const same = run("integrate_constrain", heard([{ type: "constrain", slot: "runtime", op: "lte", value: 100 }], setup))!;
    expect(same.search.status).toBe("idle");
    expect(same.candidates).toHaveLength(1);
    // a different limit: stale, candidates dropped, restart from the first batch
    const changed = run("integrate_constrain", heard([{ type: "constrain", slot: "runtime", op: "lte", value: 90 }], setup))!;
    expect(changed.constraints.runtime.max).toBe(90);
    expect(changed.search).toEqual({ status: "dirty", page: 1, noMore: false });
    expect(changed.candidates).toEqual([]);
  });

  test("a vibe triggers the first search only when it is the first signal", () => {
    const vibe: Move[] = [{ type: "vibe", text: "cozy" }];
    expect(run("integrate_vibe", heard(vibe))!.search.status).toBe("dirty");
    const later = run("integrate_vibe", heard(vibe, (s) => { s.prefs.genres = ["Comedy"]; }))!;
    expect(later.vibe).toEqual(["cozy"]);
    expect(later.search.status).toBe("idle");
  });

  test("rules ignore moves that did not come from the user", () => {
    const is = initialIS();
    is.shared = { lu: { speaker: "sys", moves: [{ type: "constrain", slot: "runtime", op: "lte", value: 90 }] } };
    expect(run("integrate_constrain", is)).toBeUndefined();
  });

  test("next_page fires below the batch limit and stops at it", () => {
    const at = (page: number) =>
      heard([], (s) => {
        s.prefs.genres = ["Comedy"];
        s.search.page = page;
      });
    const max = settings.search.maxBatches;
    expect(run("next_page", at(max - 1))!.search).toEqual({ status: "dirty", page: max, noMore: false });
    expect(run("next_page", at(max))).toBeUndefined();
  });
});

describe("rules: restart", () => {
  test("a restart forgets preferences but keeps the conversation history, and says so", () => {
    const is = heard([{ type: "restart" }], (s) => {
      s.history = [{ speaker: "usr", text: "hi" }];
      s.prefs.genres = ["Comedy"];
      s.vibe = ["cozy"];
      s.constraints.runtime = { max: 90 };
    });
    const next = run("integrate_restart", is)!;
    expect(next.history).toEqual([{ speaker: "usr", text: "hi" }]);
    expect(next.prefs.genres).toEqual([]);
    expect(next.vibe).toEqual([]);
    expect(next.constraints.runtime).toEqual({});
    expect(next.private.notices).toEqual([notices.restarted]);
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

  test("\"that one\" (no title) rejects the movie in focus, the last one suggested", () => {
    const is = heard([{ type: "reject" }], (s) => {
      s.recommended = [movie(1, "First"), movie(2, "Second")];
    });
    expect(run("integrate_seen_reject", is)!.rejected).toEqual([{ id: 2, reason: "no", genres: [], overview: "" }]);
  });

  test("rejecting a movie saves a snapshot of it and sinks its siblings in the same turn", () => {
    const withGenres = (id: number, title: string, genres: string[]): Movie => ({ ...movie(id, title), genres });
    const is = heard([{ type: "reject" }], (s) => {
      s.recommended = [withGenres(1, "Turned down", ["Comedy", "Crime"])];
      s.candidates = [withGenres(2, "Sibling", ["Comedy", "Crime"]), withGenres(3, "Other", ["Drama"])];
    });
    const next = run("integrate_seen_reject", is)!;
    expect(next.rejected).toEqual([{ id: 1, reason: "no", genres: ["Comedy", "Crime"], overview: "" }]);
    expect(next.candidates.map((m) => m.id)).toEqual([3, 2]); // before the rejection they were [2, 3]
  });
});

describe("rules: combined genres", () => {
  test("'romantic comedy' requires both genres; a multi-genre mood only adds alternatives", () => {
    const next = run("integrate_prefer", heard([{ type: "prefer", mood: "romantic", genre: "Comedy" }]))!;
    expect(next.prefs.required).toEqual(["Romance", "Comedy"]);
    expect(next.search.status).toBe("dirty");

    const exciting = run("integrate_prefer", heard([{ type: "prefer", mood: "exciting" }]))!;
    expect(exciting.prefs.genres).toEqual(["Action", "Thriller", "Adventure"]);
    expect(exciting.prefs.required).toEqual([]);
  });

  test("a negated genre or a retract drops it from the required set", () => {
    const setup = (s: IS) => {
      s.prefs.genres = ["Romance", "Comedy"];
      s.prefs.required = ["Romance", "Comedy"];
    };
    const negated = run("integrate_prefer", heard([{ type: "prefer", genre: "Romance", negated: true }], setup))!;
    expect(negated.prefs.required).toEqual(["Comedy"]);
    const retracted = run("integrate_retract", heard([{ type: "retract", slot: "genres" }], setup))!;
    expect(retracted.prefs.required).toEqual([]);
  });

  /** After a search for these required genres that found `total` movies. */
  const searched = (required: string[], total: number) =>
    heard([], (s) => {
      s.prefs.genres = [...required];
      s.prefs.required = [...required];
      s.search = { status: "idle", page: 1, noMore: total === 0, total };
    });

  test("a combination with hardly any matches falls back to any of the genres, with a notice", () => {
    const next = run("relax_genres", searched(["Western", "Music"], 4))!;
    expect(next.prefs.required).toEqual([]);
    expect(next.prefs.genres).toEqual(["Western", "Music"]);
    expect(next.search).toEqual({ status: "dirty", page: 1, noMore: false });
    expect(next.private.notices).toEqual([notices.genresRelaxed(["Western", "Music"])]);
    // and the next search asks for either genre
    expect(run("relax_genres", next)).toBeUndefined();
  });

  test("no fallback for a single genre or a large enough pool", () => {
    expect(run("relax_genres", searched(["Western"], 3))).toBeUndefined();
    expect(run("relax_genres", searched(["Romance", "Comedy"], settings.search.thinPool))).toBeUndefined();
  });
});
