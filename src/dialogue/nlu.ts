import { understandSystem } from "../config/prompts";
import { settings } from "../config/settings";
import { lastSuggested, stateSummary } from "../core/state";
import type { InformationState, LlmClient, Move } from "../core/types";
import { ground, isAffirmation } from "./grounding";

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/**
 * The names the NLU sees in "whatWeKnow" (wantedGenres, avoidGenres, ...) and other natural names → the slots `retract`
 * knows. The model often copies a name it was shown, and an unknown slot would silently do nothing.
 */
const SLOT_ALIASES: Record<string, string> = {
  avoidgenres: "dislikes", avoid: "dislikes", dislike: "dislikes", dislikes: "dislikes", dislikedgenres: "dislikes",
  wantedgenres: "genres", wanted: "genres", genre: "genres", genres: "genres",
  runtime: "runtime", maxruntimeminutes: "runtime", minruntimeminutes: "runtime", runtimeminutes: "runtime", length: "runtime", time: "runtime",
  year: "year", era: "year", fromyear: "year", toyear: "year",
  rating: "rating", minrating: "rating",
  language: "language", originallanguage: "language",
  vibe: "vibe", vibes: "vibe",
  all: "all", everything: "all",
};
const slotName = (raw: string): string => SLOT_ALIASES[raw.toLowerCase().replace(/[^a-z]/g, "")] ?? raw;

/** Accept only well-formed moves; anything else the LLM produced is dropped. */
function clean(m: any): Move | null {
  if (!m || typeof m !== "object") return null;
  switch (m.type) {
    case "prefer": {
      const genre = str(m.genre);
      const mood = str(m.mood);
      return genre || mood ? { type: "prefer", genre, mood, negated: m.negated === true } : null;
    }
    case "constrain": {
      if (!["runtime", "year", "rating", "language"].includes(m.slot)) return null;
      if (!["lte", "gte", "eq"].includes(m.op)) return null;
      const value = typeof m.value === "number" ? m.value : str(m.value);
      // A zero or negative limit is nonsense (a model's way of saying "no limit"): drop it.
      if (typeof value === "number" && value <= 0) return null;
      return value === undefined ? null : { type: "constrain", slot: m.slot, op: m.op, value };
    }
    case "adjust": {
      const direction = str(m.direction);
      return direction && ["tone", "runtime", "era", "rating"].includes(m.dimension)
        ? { type: "adjust", dimension: m.dimension, direction }
        : null;
    }
    case "like": {
      const title = str(m.title);
      return title ? { type: "like", title } : null;
    }
    case "seen":
    case "reject":
      return { type: m.type, title: str(m.title) };
    case "retract": {
      const slot = str(m.slot);
      return slot ? { type: "retract", slot: slotName(slot) } : null;
    }
    case "vibe": {
      const text = str(m.text);
      return text ? { type: "vibe", text } : null;
    }
    case "restart":
      return { type: "restart" };
    case "accept":
      return { type: "accept" };
    default:
      return null;
  }
}

/** One LLM call: utterance (+ short history and known state) → moves. */
export async function understand(llm: LlmClient, text: string, is: InformationState): Promise<Move[]> {
  const suggested = lastSuggested(is);
  // A bare "yes" / "let's go with that" right after a suggestion is taking it: no LLM needed (and none gets it wrong).
  if (suggested && is.recommendStreak > 0 && isAffirmation(text)) return [{ type: "accept" }];

  const out: any = await llm.json(
    [
      { role: "system", content: understandSystem },
      {
        role: "user",
        content: JSON.stringify({
          conversation: is.history.slice(-settings.dialogue.historyForNlu),
          whatWeKnow: stateSummary(is),
          lastSuggestedMovie: lastSuggested(is),
          utterance: text,
        }),
      },
    ],
    settings.llm.understand
  );
  const raw: unknown[] = Array.isArray(out?.moves) ? out.moves : [];
  const moves = raw.map(clean).filter((m): m is Move => m !== null);
  const lastTurn = is.history[is.history.length - 1];
  return ground(moves, text, lastTurn?.speaker === "sys" ? lastTurn.text : undefined, suggested);
}
