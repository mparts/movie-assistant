import { understandByQud, understandCore } from "../config/prompts";
import { settings } from "../config/settings";
import { lastSuggested, stateSummary } from "../core/state";
import type { InformationState, LlmClient, Move } from "../core/types";
import { isDebug, namesTitle } from "../core/util";
import { ground, isAffirmation, repairMoves } from "./grounding";

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/** Accept only well-formed moves; anything else the LLM produced is dropped. */
function clean(m: any): Move | null {
  if (!m || typeof m !== "object") return null;
  switch (m.type) {
    case "wish":
    case "avoid": {
      const text = str(m.text);
      return text ? { type: m.type, text } : null;
    }
    case "person": {
      const name = str(m.name);
      return name ? { type: "person", name, negated: m.negated === true } : null;
    }
    case "seen":
    case "reject":
      return { type: m.type, title: str(m.title) };
    case "accept":
      return { type: "accept" };
    default:
      return null;
  }
}

/** One LLM call: utterance (+ short history and known state) → moves. */
export async function understand(llm: LlmClient, text: string, is: InformationState): Promise<Move[]> {
  const suggested = lastSuggested(is);
  const lastTurn = is.history[is.history.length - 1];
  const lastSystem = lastTurn?.speaker === "sys" ? lastTurn.text : undefined;
  // A bare "yes" / "let's go with that" right after Elisa named the suggestion is taking it: no LLM needed (and none
  // gets it wrong). After any other turn of Elisa's (an answer, or "want something lighter?") the LLM decides.
  if (suggested && is.qud === "suggestion" && lastSystem && namesTitle(lastSystem, suggested) && isAffirmation(text))
    return [{ type: "accept" }];

  const out: any = await llm.json(
    [
      { role: "system", content: understandCore + understandByQud[is.qud] },
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
  return ground(moves, text, lastSystem, suggested, is.wish);
}
