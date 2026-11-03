import { describe, expect, test } from "vitest";
import { cases, formatTable, percentile, runBench, stateFor } from "../scripts/nluBench";
import type { LlmClient } from "../src/core/types";

/** Answers each case's utterance with the given moves; anything else (the warm-up) gets no moves. */
const stubFor = (answers: Record<string, unknown[]>): LlmClient => ({
  async json(messages) {
    const user = JSON.parse(messages[messages.length - 1].content);
    return { moves: answers[user.utterance] ?? [] };
  },
});

const perfect: Record<string, unknown[]> = {
  "goofy huh? yeah let's go with that!!": [{ type: "vibe", text: "goofy" }],
  "hhhmmm... not really... I don't like office settings": [{ type: "reject" }, { type: "vibe", text: "no office settings" }],
  "I was thinking a romantic comedy will be nice!!": [{ type: "prefer", genre: "Romance" }, { type: "prefer", genre: "Comedy" }],
  "I only have an hour and a half tonight": [{ type: "constrain", slot: "runtime", op: "lte", value: 90 }],
  "anything but horror, I can't sleep after those": [{ type: "prefer", genre: "Horror", negated: true }],
  "oh I watched that one ages ago": [{ type: "seen" }],
  "nah, that's not for me": [{ type: "reject" }],
  "something along the lines of Parasite": [{ type: "like", title: "Parasite" }],
  "actually, let's start over and forget all of that": [{ type: "restart" }],
  "do you have anything a bit shorter than that?": [{ type: "adjust", dimension: "runtime", direction: "shorter" }],
  "never mind the time limit, any length is fine": [{ type: "retract", slot: "runtime" }],
  "only movies from the nineties please": [{ type: "constrain", slot: "year", op: "gte", value: 1990 }],
};

describe("NLU bench", () => {
  test("a model that answers every case correctly scores all of them", async () => {
    const { summary } = await runBench(stubFor(perfect));
    expect(summary).toMatchObject({ total: cases.length, ok: cases.length, wrong: 0, invalid: 0 });
  });

  test("a model that never finds anything passes only the cases that expect no moves", async () => {
    const { results, summary } = await runBench(stubFor({}));
    const passed = results.filter((r) => r.status === "ok").map((r) => r.name).sort();
    expect(passed).toEqual(["6c-question-alone-adds-nothing", "greeting-gives-nothing", "question-gives-nothing"]);
    expect(summary.invalid).toBe(0);
  });

  test("a failing call counts as invalid, not wrong, and does not stop the run", async () => {
    const down: LlmClient = { json: async () => { throw new Error("connection refused"); } };
    const { results, summary } = await runBench(down);
    expect(summary).toMatchObject({ total: cases.length, ok: 0, wrong: 0, invalid: cases.length });
    expect(results[0].why).toContain("connection refused");
  });

  test("Jake's own options are not accepted as the user's taste", async () => {
    const answers = { ...perfect, "hmm, not sure yet, what do you think?": [{ type: "vibe", text: "light and funny" }] };
    const { results } = await runBench(stubFor(answers));
    expect(results.find((r) => r.name === "6c-question-alone-adds-nothing")?.status).toBe("wrong");
  });

  test("cases set up the state they describe", () => {
    const retract = cases.find((c) => c.name === "retract-time-limit")!;
    expect(stateFor(retract).constraints.runtime.max).toBe(90);
    const reject = cases.find((c) => c.name === "reject-the-one-suggested")!;
    expect(stateFor(reject).recommended.map((m) => m.title)).toEqual(["Knives Out"]);
  });

  test("percentile uses nearest rank; the table has one row per model", () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
    const s = { total: 15, ok: 12, wrong: 2, invalid: 1, p50: 640.4, p95: 1200 };
    const table = formatTable([{ model: "m1", warmupMs: 3000, summary: s }]).split("\n");
    expect(table).toHaveLength(3);
    expect(table[2]).toMatch(/^m1\s+12\/15\s+2\s+1\s+640\s+1200\s+3000$/);
  });
});
