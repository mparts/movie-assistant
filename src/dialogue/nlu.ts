import { understandSystem } from "../config/prompts";
import { settings } from "../config/settings";
import { lastSuggested, stateSummary } from "../core/state";
import type { InformationState, LlmClient, Move } from "../core/types";
import { isDebug } from "../core/util";
import { ground, isAffirmation, repairMoves } from "./grounding";

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/**
 * The names the NLU sees in "whatWeKnow" (wantedGenres, avoidGenres, ...) and other natural names → the slots `retract`
 * knows. The model often copies a name it was shown, and an unknown slot would silently do nothing.
 */
const SLOT_ALIASES: Record<string, string> = {
  wish: "wish", taste: "wish",
  wantedgenres: "genres", wanted: "genres", genre: "genres", genres: "genres",
  avoidgenres: "avoidGenres", dislikes: "avoidGenres", dislike: "avoidGenres", dislikedgenres: "avoidGenres",
  avoid: "avoid", avoids: "avoid",
  people: "people", person: "people", wantedpeople: "people", avoidpeople: "people", actors: "people", director: "people",
  year: "year", era: "year", fromyear: "year", toyear: "year",
  language: "language", originallanguage: "language",
};
const slotName = (raw: string): string => SLOT_ALIASES[raw.toLowerCase().replace(/[^a-z]/g, "")] ?? raw;

/** Accept only well-formed moves; anything else the LLM produced is dropped. */
function clean(m: any): Move | null {
  if (!m || typeof m !== "object") return null;
  switch (m.type) {
    case "wish":
    case "avoid": {
      const text = str(m.text);
      return text ? { type: m.type, text } : null;
    }
    case "prefer": {
      const genre = str(m.genre);
      return genre ? { type: "prefer", genre, negated: m.negated === true } : null;
    }
    case "person": {
      const name = str(m.name);
      return name ? { type: "person", name, negated: m.negated === true } : null;
    }
    case "constrain": {
      if (!["runtime", "year", "language"].includes(m.slot)) return null;
      if (!["lte", "gte", "eq"].includes(m.op)) return null;
      // A runtime request only points to tonight's settings, so "shorter" without a number counts too.
      const value = typeof m.value === "number" ? m.value : (str(m.value) ?? (m.slot === "runtime" && m.value == null ? "unspecified" : undefined));
      // A zero or negative limit is nonsense (a model's way of saying "no limit"): drop it.
      if (typeof value === "number" && value <= 0) return null;
      return value === undefined ? null : { type: "constrain", slot: m.slot, op: m.op, value };
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
  if (isDebug()) console.log(`[NLU raw] ${JSON.stringify(raw)}`);
  const moves = repairMoves(raw.map(clean).filter((m): m is Move => m !== null), is.wish, raw);
  const lastTurn = is.history[is.history.length - 1];
  return ground(moves, text, lastTurn?.speaker === "sys" ? lastTurn.text : undefined, suggested, is.wish);
}
