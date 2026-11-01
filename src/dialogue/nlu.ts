import { understandSystem } from "../config/prompts";
import { settings } from "../config/settings";
import { lastSuggested, stateSummary } from "../core/state";
import type { InformationState, LlmClient, Move } from "../core/types";

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

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
      return slot ? { type: "retract", slot } : null;
    }
    case "vibe": {
      const text = str(m.text);
      return text ? { type: "vibe", text } : null;
    }
    case "restart":
      return { type: "restart" };
    default:
      return null;
  }
}

/** One LLM call: utterance (+ short history and known state) → moves. */
export async function understand(llm: LlmClient, text: string, is: InformationState): Promise<Move[]> {
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
  return raw.map(clean).filter((m): m is Move => m !== null);
}
