import { describe, expect, test, vi } from "vitest";
import { utterances } from "../src/config/prompts";
import { settings } from "../src/config/settings";
import { respond } from "../src/dialogue/respond";
import { initialIS } from "../src/core/state";
import type { LlmClient, Movie } from "../src/core/types";

const fakeLlm = (out: unknown) => ({ json: vi.fn(async () => out) }) as unknown as LlmClient & { json: ReturnType<typeof vi.fn> };
const movie: Movie = { id: 42, title: "Example", genres: ["Adventure"], rating: 8, votes: 1000, overview: "An adventure" };

describe("scripted turns never call the LLM", () => {
  test("opening", async () => {
    const llm = fakeLlm({});
    expect(await respond(llm, initialIS())).toEqual({ say: utterances.opening });
    expect(llm.json).not.toHaveBeenCalled();
  });


});

describe("guards on the LLM", () => {
  const early = () => {
    const is = initialIS();
    is.prefs.genres = ["Adventure"];
    is.candidates = [movie];
    is.history = [{ speaker: "sys", text: utterances.opening }, { speaker: "usr", text: "adventure" }];
    return is;
  };

  test("before the readiness gate, naming a candidate is blocked (whole word) and falls back", async () => {
    const llm = fakeLlm({ say: "How about Example tonight?", recommend: null });
    expect(await respond(llm, early())).toEqual({ say: utterances.exploreFallback });
    expect(llm.json).toHaveBeenCalledTimes(settings.dialogue.respondAttempts);
  });

  test("a title inside another word is not a mention", async () => {
    const is = early();
    is.candidates = [{ ...movie, title: "Past" }];
    const llm = fakeLlm({ say: "That sounds like a fun night out.", recommend: null });
    expect(await respond(llm, is)).toEqual({ say: "That sounds like a fun night out." });
  });
});
