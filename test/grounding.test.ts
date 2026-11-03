import { describe, expect, test, vi } from "vitest";
import { rules } from "../src/core/rules";
import { initialIS } from "../src/core/state";
import type { InformationState as IS, LlmClient, Move, Movie } from "../src/core/types";
import { ground, isAffirmation } from "../src/dialogue/grounding";
import { understand } from "../src/dialogue/nlu";
import { respond } from "../src/dialogue/respond";

const movie = (id: number, title: string): Movie => ({ id, title, genres: ["Comedy"], rating: 7, votes: 100, overview: "A film" });
const llmSays = (out: unknown) => ({ json: vi.fn(async () => out) }) as unknown as LlmClient & { json: ReturnType<typeof vi.fn> };
/** A state right after the assistant suggested `title`, saying `jake`. */
const after = (title: string | null, jake: string): IS => {
  const is = initialIS();
  is.history = [{ speaker: "sys", text: jake }];
  if (title) {
    is.recommended = [movie(1, title)];
    is.recommendStreak = 1;
  }
  return is;
};

describe("A: a bare yes after a suggestion is an accept, without the LLM", () => {
  test("agreement phrases are recognised; anything more is not", () => {
    for (const t of ["yes", "Yeah why not.. let's go with that!!", "yes it works!!", "yes this one", "sounds good", "Sure, perfect", "ok thanks"])
      expect(isAffirmation(t), t).toBe(true);
    for (const t of ["yes please do that", "no", "yes but is it long", "not sure about that", "", "hmm", "yes, make it shorter"])
      expect(isAffirmation(t), t).toBe(false);
  });

  test("right after a suggestion it returns accept and never calls the model", async () => {
    const llm = llmSays({ moves: [] });
    expect(await understand(llm, "yes this one", after("About Time", "How about About Time?"))).toEqual([{ type: "accept" }]);
    expect(llm.json).not.toHaveBeenCalled();
  });



  test("the accepted movie is remembered until something substantive is said, and survives silence and small talk", () => {
    const base = after("About Time", "How about About Time?");
    const hear = (is: IS, moves: Move[], text = "x") => rules.get_latest_move({ is, latest_moves: moves, latest_speaker: "usr", latest_text: text })!();
    const accepted = hear(base, [{ type: "accept" }]);
    expect(accepted.accepted).toBe(1);
    expect(hear(accepted, []).accepted).toBe(1); // "thanks" gives no moves
    expect(hear(accepted, [{ type: "noinput" }]).accepted).toBe(1);
    expect(hear(accepted, [{ type: "prefer", genre: "Horror" }]).accepted).toBeUndefined(); // new request: back to normal
    expect(rules.get_latest_move({ is: accepted, latest_moves: [{ type: "say", text: "Enjoy!" }], latest_speaker: "sys" })!().accepted).toBe(1);
  });

  test("after an accept, Jake wraps up: no candidates, no new suggestion", async () => {
    const is = after("About Time", "How about About Time?");
    is.accepted = 1;
    is.candidates = [movie(2, "Other Film")];
    is.history.push({ speaker: "usr", text: "yes this one" });
    const llm = llmSays({ say: "Great pick, enjoy About Time tonight.", recommend: null });
    expect(await respond(llm, is)).toEqual({ say: "Great pick, enjoy About Time tonight." });
    const [messages] = llm.json.mock.calls[0] as [{ role: string; content: string }[]];
    expect(messages[0].content).toContain("WRAP-UP MODE");
    const sent = JSON.parse(messages[1].content);
    expect(sent.acceptedMovie).toBe("About Time");
    expect(sent.candidates).toEqual([]);
  });


});

describe("wrap-up with a duplicate title", () => {
  test("a recommend id is ignored, and the accepted title may be named even if another candidate shares it", async () => {
    const is = after("Solaris", "How about Solaris?");
    is.accepted = 1;
    is.candidates = [movie(2, "Solaris"), movie(3, "Other Film")];
    is.history.push({ speaker: "usr", text: "yes, this one!!" });
    const llm = llmSays({ say: "Solaris it is, enjoy it.", recommend: 1 });
    expect(await respond(llm, is)).toEqual({ say: "Solaris it is, enjoy it." });
    expect(llm.json).toHaveBeenCalledTimes(1);
  });
});

describe("B: moves the user's words do not support are dropped", () => {
  const jake = "Back to the Future has that fun, goofy vibe with a sweet hint of romance, perfect for a light date night.";
  test("vibes copied from the assistant's last turn are dropped; the user's own are kept", () => {
    const copied: Move[] = [{ type: "vibe", text: "goofy" }, { type: "vibe", text: "date night" }];
    expect(ground(copied, "yes this one", jake, "Back to the Future")).toEqual([]);
    expect(ground(copied, "goofy sounds right, a date night", jake, null)).toEqual(copied);
    expect(ground([{ type: "vibe", text: "cozy" }], "something cozy", jake, null)).toHaveLength(1);
  });


  test("a like needs the title in the user's words, allowing a misheard letter", () => {
    expect(ground([{ type: "like", title: "Back to the Future" }], "yes this one", jake, "Back to the Future")).toEqual([]);
    expect(ground([{ type: "like", title: "Parasite" }], "something like Parazite", undefined, null)).toHaveLength(1);
    expect(ground([{ type: "like", title: "Knives Out" }], "I loved Knives Out", undefined, null)).toHaveLength(1);
  });


});

describe("C: a negated genre needs a 'no' right before it", () => {
  const neg = (genre: string, mood?: string): Move[] => [{ type: "prefer", genre, mood, negated: true }];
  test("the chat.log case: 'no' belongs to 'this', not to funny", () => {
    expect(ground(neg("Comedy"), "hhmm... no I do not like this.. maybe something more funny", undefined, null)).toEqual([]);
  });

  test("real negations are kept", () => {
    for (const [genre, said] of [
      ["Horror", "no horror please"],
      ["Horror", "anything but horror, I can't sleep after those"],
      ["Comedy", "I don't like comedies"],
      ["Horror", "I can't stand scary movies"],
      ["Romance", "not really in the mood for romance"],
      ["Comedy", "nothing too funny"],
    ] as const)
      expect(ground(neg(genre), said, undefined, null), said).toHaveLength(1);
  });


  test("a 'no' does not reach into the next sentence or clause", () => {
    expect(ground(neg("Comedy"), "no, I do not like this one. funny please", undefined, null)).toEqual([]);
    expect(ground(neg("Comedy"), "I do not like this, something funny then", undefined, null)).toEqual([]);
  });


});

describe("a zero or negative limit is dropped", () => {
  test("runtime eq 0 (a model's way of saying 'no limit') records nothing", async () => {
    const out = await understand(llmSays({ moves: [{ type: "constrain", slot: "runtime", op: "eq", value: 0 }, { type: "constrain", slot: "runtime", op: "lte", value: 90 }] }), "x", initialIS());
    expect(out).toEqual([{ type: "constrain", slot: "runtime", op: "lte", value: 90 }]);
  });
});

describe("D: retract slots named as the NLU sees them", () => {
  test.each([
    ["avoidGenres", "dislikes"],
    ["wantedGenres", "genres"],
    ["maxRuntimeMinutes", "runtime"],
  ])("%s → %s", async (given, real) => {
    const out = await understand(llmSays({ moves: [{ type: "retract", slot: given }] }), "drop that", initialIS());
    expect(out).toEqual([{ type: "retract", slot: real }]);
  });
});
