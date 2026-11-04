import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { poolCriteria } from "../src/core/state";
import { freshIS } from "./fixtures";
import { parseIntake } from "../src/core/intake";
import { recommendationReadiness } from "../src/core/readiness";

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

  test("Phase 1 becomes the pool's filters, with the no-shorts floor", () => {
    expect(poolCriteria(parseIntake(sample))).toMatchObject({
      runtime: { min: 60, max: 100 }, excludeGenres: ["Horror"], certificationLte: "PG",
      watch: { region: "NL", providers: [8, 337] },
    });
  });
});

describe("readiness", () => {

  test("taste + enough turns and signals is ready; \"just pick\" skips the wait", () => {
    const s = freshIS();
    s.wish = "A funny movie.";
    expect(recommendationReadiness(s).ready).toBe(false);
    s.readiness = { meaningfulTurns: 2, evidence: ["genre:Comedy", "runtime"] };
    expect(recommendationReadiness(s).ready).toBe(true);

    const t = freshIS();
    t.genres = ["Comedy"];
    t.history = [{ speaker: "usr", text: "just pick one" }];
    expect(recommendationReadiness(t).ready).toBe(true);
  });
});
