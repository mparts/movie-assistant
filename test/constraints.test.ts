import { describe, expect, test } from "vitest";
import { constrain, retract } from "../src/core/constraints";
import { freshIS } from "./fixtures";

describe("year bounds", () => {
  test("a new bound beyond the opposite one replaces it: 'recent, not the 90s' is not the empty range 2000-1999", () => {
    const is = freshIS();
    is.constraints.year = { min: 1990, max: 1999 };
    expect(constrain(is, { type: "constrain", slot: "year", op: "gte", value: 2020 }).constraints.year).toEqual({ min: 2020 });
    expect(constrain(is, { type: "constrain", slot: "year", op: "lte", value: 1985 }).constraints.year).toEqual({ max: 1985 });
    expect(constrain(is, { type: "constrain", slot: "year", op: "gte", value: 1995 }).constraints.year).toEqual({ min: 1995, max: 1999 });
  });
});

describe("retract", () => {
  test("one slot clears only itself; an unknown slot changes nothing", () => {
    const is = freshIS();
    is.wish = "A cozy comedy.";
    is.genres = ["Comedy"];
    is.avoidGenres = ["Horror"];
    is.people = [{ name: "Adam Sandler", negated: true }];

    expect(retract(is, "avoidGenres")).toMatchObject({ avoidGenres: [], genres: ["Comedy"] });
    expect(retract(is, "nonsense")).toBe(is);
  });
});
