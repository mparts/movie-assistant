import { describe, expect, test, vi } from "vitest";
import { rules } from "../src/core/rules";
import { freshIS } from "./fixtures";
import type { InformationState as IS, LlmClient, Move, Movie } from "../src/core/types";
import { ground, isAffirmation, repairMoves } from "../src/dialogue/grounding";
import { understand } from "../src/dialogue/nlu";
import { respond } from "../src/dialogue/respond";

const movie = (id: number, title: string): Movie => ({ id, title, genres: ["Comedy"], rating: 7, votes: 100, overview: "A film" });
const llmSays = (out: unknown) => ({ json: vi.fn(async () => out) }) as unknown as LlmClient & { json: ReturnType<typeof vi.fn> };
/** A state right after the assistant suggested `title`, saying `elisa`. */
const after = (title: string | null, elisa: string): IS => {
  const is = freshIS();
  is.history = [{ speaker: "sys", text: elisa }];
  if (title) {
    is.recommended = [movie(1, title)];
    is.qud = "suggestion";
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
    expect(await understand(llm, "yes this one", after("About Time", "How about About Time?"))).toEqual({ moves: [{ type: "accept" }], dropped: [] });
    expect(llm.json).not.toHaveBeenCalled();
  });



  test("the accepted movie is remembered until something substantive is said, and survives silence and small talk", () => {
    const base = after("About Time", "How about About Time?");
    const hear = (is: IS, moves: Move[], text = "x") => rules.get_latest_move({ is, latest_moves: moves, latest_speaker: "usr", latest_text: text })!();
    const accepted = hear(base, [{ type: "accept" }]);
    expect(accepted.accepted).toBe(1);
    expect(hear(accepted, []).accepted).toBe(1); // "thanks" gives no moves
    expect(hear(accepted, [{ type: "noinput" }]).accepted).toBe(1);
    expect(hear(accepted, [{ type: "wish", text: "A creepy ghost story." }]).accepted).toBeUndefined(); // new request: back to normal
    expect(rules.get_latest_move({ is: accepted, latest_moves: [{ type: "say", text: "Enjoy!" }], latest_speaker: "sys" })!().accepted).toBe(1);
  });

  test("after an accept, Elisa wraps up: no candidates, no new suggestion", async () => {
    const is = after("About Time", "How about About Time?");
    is.accepted = 1;
    is.candidates = [movie(2, "Other Film")];
    is.history.push({ speaker: "usr", text: "yes this one" });
    const llm = llmSays({ say: "Great pick, enjoy About Time tonight.", recommend: null });
    expect(await respond(llm, is)).toEqual({ say: "Great pick, enjoy About Time tonight.", mode: "wrapup" });
    const [messages] = llm.json.mock.calls[0] as [{ role: string; content: string }[]];
    expect(messages[0].content).toContain("WRAP-UP MODE");
    const sent = JSON.parse(messages[1].content);
    expect(sent.acceptedMovie).toBe("About Time");
    expect(sent.candidates).toBeUndefined();
  });


});

describe("wrap-up with a duplicate title", () => {
  test("a recommend id is ignored, and the accepted title may be named even if another candidate shares it", async () => {
    const is = after("Solaris", "How about Solaris?");
    is.accepted = 1;
    is.candidates = [movie(2, "Solaris"), movie(3, "Other Film")];
    is.history.push({ speaker: "usr", text: "yes, this one!!" });
    const llm = llmSays({ say: "Solaris it is, enjoy it.", recommend: 1 });
    expect(await respond(llm, is)).toEqual({ say: "Solaris it is, enjoy it.", mode: "wrapup" });
    expect(llm.json).toHaveBeenCalledTimes(1);
  });
});

describe("B: moves the user's words do not support are dropped", () => {
  const elisa = "Back to the Future has that fun, goofy vibe with a sweet hint of romance, perfect for a light date night.";
  test("a wish made of the assistant's words is dropped; the user's own (or a bare yes to it) is kept", () => {
    const copied: Move[] = [{ type: "wish", text: "A goofy movie for a light date night." }];
    expect(ground(copied, "the second one", elisa, null)).toEqual([]);
    expect(ground(copied, "goofy sounds right, a date night", elisa, null)).toEqual(copied);
    expect(ground(copied, "yes!", elisa, null)).toEqual(copied);
    // Only the words a rewrite adds count: the old wish's words are not "copied".
    expect(ground([{ type: "wish", text: "A cozy, funny movie." }], "funnier", elisa, null, "A cozy movie.")).toHaveLength(1);
  });

  test("a person needs their name in the user's words", () => {
    expect(ground([{ type: "person", name: "Michael J. Fox" }], "sounds fun", elisa, null)).toEqual([]);
    expect(ground([{ type: "person", name: "Christopher Nolan" }], "a nolan movie", undefined, null)).toHaveLength(1);
  });


});

describe("a negation in the wish", () => {
  // Found by replaying lost wishes: any negation dropped the whole wish, and a mid-sentence one was cut in the wrong place.
  const old = "A gentle animated adventure.";
  const repaired = (text: string) => ground(repairMoves([{ type: "wish", text }], old, []), "x", undefined, null, old);
  test.each([
    "A non-stop action adventure.",
    "A funny movie about a kid who can't stop laughing.",
    "A sweet story about a robot that doesn't fit in, with lots of humor.",
    "A movie about animals that can't talk.",
    "A heartwarming story about a dog who never gives up.",
  ])("part of the story, kept as it is: %s", (text) => {
    expect(repaired(text)).toEqual([{ type: "wish", text }]);
  });

  test.each([
    ["A magical adventure with no princesses and lots of laughs.", "A magical adventure with lots of laughs.", "princesses"],
    ["A funny animated adventure, not too scary.", "A funny animated adventure.", "scary"],
    ["A story of friendship, not romance.", "A story of friendship.", "romance"],
  ])("a refusal goes to avoid: %s", (text, wish, avoid) => {
    expect(repaired(text)).toEqual([{ type: "wish", text: wish }, { type: "avoid", text: avoid }]);
  });
});
