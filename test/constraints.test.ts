import { describe, expect, test } from "vitest";
import { settings } from "../src/config/settings";
import { constrain, retract } from "../src/core/constraints";
import { initialIS } from "../src/core/state";

const tol = settings.adjust.runtimeExactTolerance;

describe("constrain", () => {
  test("a runtime limit sets max, a minimum sets min, an exact length makes a band around it", () => {
    let is = constrain(initialIS(), { type: "constrain", slot: "runtime", op: "lte", value: 100 });
    expect(is.constraints.runtime).toEqual({ max: 100 });
    is = constrain(is, { type: "constrain", slot: "runtime", op: "gte", value: 80 });
    expect(is.constraints.runtime).toEqual({ min: 80, max: 100 });
    is = constrain(is, { type: "constrain", slot: "runtime", op: "eq", value: 90 });
    expect(is.constraints.runtime).toEqual({ min: 90 - tol, max: 90 + tol });
  });


});

describe("adjust and retract", () => {

  test("retracting the runtime clears it, \"all\" clears everything, an unknown slot changes nothing", () => {
    const is = initialIS();
    is.constraints.runtime = { max: 90 };
    is.constraints.rating = 7;
    is.prefs.genres = ["Comedy"];
    is.dislikes.genres = ["Horror"];
    is.vibe = ["cozy"];

    expect(retract(is, "runtime").constraints.runtime).toEqual({});
    const all = retract(is, "all");
    expect(all.constraints).toEqual({ runtime: {}, year: {} });
    expect([all.prefs.genres, all.dislikes.genres, all.vibe]).toEqual([[], [], []]);
    expect(retract(is, "nonsense")).toBe(is);
  });
});
