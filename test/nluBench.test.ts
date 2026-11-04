import { describe, expect, test } from "vitest";
import { cases, formatTable, percentile, runBench } from "../scripts/nluBench";
import type { LlmClient } from "../src/core/types";

/** Answers each case's utterance with the given moves; anything else (the warm-up) gets no moves. */
const stubFor = (answers: Record<string, unknown[]>): LlmClient => ({
  async json(messages) {
    const user = JSON.parse(messages[messages.length - 1].content);
    return { moves: answers[user.utterance] ?? [] };
  },
});

const perfect: Record<string, unknown[]> = {
  "goofy huh? yeah let's go with that!!": [{ type: "wish", text: "A goofy, light romantic comedy." }],
  "hhhmmm... not really... I don't like office settings": [{ type: "reject" }, { type: "avoid", text: "office settings" }],
  "I was thinking a romantic comedy will be nice!!": [{ type: "prefer", genre: "Romance" }, { type: "prefer", genre: "Comedy" }],
  "something cozy and funny for a rainy evening": [{ type: "wish", text: "A cozy, funny movie for a rainy evening." }],
  "maybe with a bit more humor": [{ type: "wish", text: "A gritty crime thriller with a detective, with some humor." }],
  "an adventure for the kids, but no princesses please": [{ type: "wish", text: "An exciting adventure for kids." }, { type: "avoid", text: "princesses" }],
  "something scary with ghosts, but not gory": [{ type: "wish", text: "A creepy ghost story." }, { type: "avoid", text: "gore" }],
  "anything with Tom Hanks?": [{ type: "person", name: "Tom Hanks" }],
  "please nothing with Adam Sandler": [{ type: "person", name: "Adam Sandler", negated: true }],
  "I'm in the mood for a Nolan film": [{ type: "person", name: "Christopher Nolan" }],
  "anything but horror, I can't sleep after those": [{ type: "prefer", genre: "Horror", negated: true }],
  "oh I watched that one ages ago": [{ type: "seen" }],
  "nah, that's not for me": [{ type: "reject" }],
  "something along the lines of Parasite": [{ type: "wish", text: "A darkly funny thriller about class and a poor family, like Parasite." }],
  "something like Inception, maybe even by Nolan": [{ type: "wish", text: "A mind-bending sci-fi heist inside dreams, like Inception." }, { type: "person", name: "Christopher Nolan" }],
  "yeap you got me... lighthearted date vibe it is!!": [{ type: "wish", text: "A lighthearted romantic comedy for a date night." }],
  "hhmm... no I do not like this.. maybe something more funny": [{ type: "reject" }, { type: "wish", text: "A funnier romantic comedy." }],
  "yes please do that!!": [{ type: "prefer", genre: "Comedy" }],
  "ok that sounds great, let's watch it tonight": [{ type: "accept" }],
  "no scary stuff please": [{ type: "prefer", genre: "Horror", negated: true }],
  "something with talking animals would be great": [{ type: "wish", text: "A gentle animated adventure with talking animals." }],
  "something with dinosaurs": [{ type: "wish", text: "A gentle animated adventure with dinosaurs." }],
  "the kids love animals": [{ type: "wish", text: "A gentle animated adventure with animals." }],
  "how about a movie about friendship": [{ type: "wish", text: "A gentle animated adventure about friendship." }],
  "something funny with animals": [{ type: "wish", text: "A funny animated adventure with animals." }],
};

describe("NLU bench", () => {
  test("a model that answers every case correctly scores all of them", async () => {
    const { summary } = await runBench(stubFor(perfect));
    expect(summary).toMatchObject({ total: cases.length, ok: cases.length, wrong: 0, invalid: 0 });
  });


  test("a failing call counts as invalid, not wrong, and does not stop the run; the accept shortcut needs no model", async () => {
    const down: LlmClient = { json: async () => { throw new Error("connection refused"); } };
    const { results, summary } = await runBench(down);
    expect(summary).toMatchObject({ total: cases.length, ok: 2, wrong: 0, invalid: cases.length - 2 });
    expect(results.filter((r) => r.status === "ok").map((r) => r.name)).toEqual(["real-accept-bare-yes", "real-confirm-this-one"]);
    expect(results[0].why).toContain("connection refused");
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
