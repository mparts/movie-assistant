import { repairWishSystem, understandByQud, understandCore } from "../config/prompts";
import { settings } from "../config/settings";
import { lastSuggested, stateSummary } from "../core/state";
import type { InformationState, LlmClient, Move } from "../core/types";
import { isDebug } from "../core/util";
import { ground, isAffirmation, missedWords, repairMoves, splitRefusals } from "./grounding";

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
  const lastTurn = is.history[is.history.length - 1];
  const lastSystem = lastTurn?.speaker === "sys" ? lastTurn.text : undefined;
  const grounded = ground(moves, text, lastSystem, suggested, is.wish);
  const missing = logMisses(text, moves, grounded, suggested);
  return missing.length ? repairWish(llm, text, grounded, missing, is.wish, lastSystem) : grounded;
}

/** A lost wish: the user's words are missing from the moves, or a "like" for the movie Jake just suggested was dropped. */
function logMisses(text: string, before: Move[], after: Move[], suggested: string | null): string[] {
  const missing = missedWords(text, after);
  if (missing.length) console.warn(`[NLU miss] missing: ${missing.join(", ")} in "${text}"`);
  const dropped = before.find((m) => m.type === "like" && !after.includes(m) && suggested && m.title.toLowerCase() === suggested.toLowerCase());
  if (dropped) console.warn(`[NLU miss] dropped like for the suggested movie: ${suggested}`);
  return missing;
}

/**
 * One narrow call that puts the missing words back into the wish. Kept only if fewer of the user's words are missing
 * afterwards; otherwise (or if the call fails, or the model says it was no wish) the moves stay as they were.
 */
async function repairWish(llm: LlmClient, text: string, moves: Move[], missing: string[], oldWish: string, lastSystem?: string): Promise<Move[]> {
  const current = [...moves].reverse().find((m): m is Extract<Move, { type: "wish" }> => m.type === "wish")?.text ?? oldWish;
  try {
    const out: any = await llm.json(
      [
        { role: "system", content: repairWishSystem },
        { role: "user", content: JSON.stringify({ wish: current || null, utterance: text, missingWords: missing, assistantSaid: lastSystem ?? null }) },
      ],
      settings.llm.repair
    );
    const wish = str(out?.wish);
    if (!wish) return moves;
    const split = splitRefusals(wish);
    const repaired: Move[] = [
      ...moves.filter((m) => m.type !== "wish"),
      ...(split.wish ? [{ type: "wish" as const, text: split.wish }] : []),
      ...split.avoid.filter((a) => !moves.some((m) => m.type === "avoid" && m.text === a)).map((a): Move => ({ type: "avoid", text: a })),
    ];
    if (missedWords(text, repaired).length >= missing.length) return moves;
    console.info(`[NLU repair] ${JSON.stringify(current)} → ${JSON.stringify(split.wish)}${split.avoid.length ? `, avoid ${JSON.stringify(split.avoid)}` : ""}`);
    return repaired;
  } catch (e) {
    console.warn("[NLU repair failed]", e);
    return moves;
  }
}
