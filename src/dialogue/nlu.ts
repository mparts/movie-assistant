import { understandByQud, understandCore } from "../config/prompts";
import { settings } from "../config/settings";
import { lastSuggested, stateSummary } from "../core/state";
import type { InformationState, LlmClient, Move, Understood } from "../core/types";
import { isDebug, namesTitle } from "../core/util";

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

/** One LLM call: utterance (+ short history and known state) → moves, and the moves grounding dropped. */
export async function understand(llm: LlmClient, text: string, is: InformationState): Promise<Understood> {
  const suggested = lastSuggested(is);
  const lastTurn = is.history[is.history.length - 1];
  const lastSystem = lastTurn?.speaker === "sys" ? lastTurn.text : undefined;
  // A bare "yes" / "let's go with that" right after Elisa named the suggestion is taking it: no LLM needed (and none
  // gets it wrong). After any other turn of Elisa's (an answer, or "want something lighter?") the LLM decides.
  if (suggested && is.qud === "suggestion" && lastSystem && namesTitle(lastSystem, suggested) && isAffirmation(text))
    return { moves: [{ type: "accept" }], dropped: [] };

  const out: any = await llm.json(
    [
      { role: "system", content: understandCore + understandByQud[is.qud] },
      {
        role: "user",
        content: JSON.stringify({
          conversation: is.history.slice(-settings.dialogue.historyForNlu),
          whatWeKnow: stateSummary(is),
          lastSuggestedMovie: suggested,
          utterance: text,
        }),
      },
    ],
    settings.llm.understand
  );
  const raw: unknown[] = Array.isArray(out?.moves) ? out.moves : [];
  if (isDebug()) console.log(`[NLU raw] ${JSON.stringify(raw)}`);
  const repaired = repairMoves(raw.map(clean).filter((m): m is Move => m !== null), is.wish, raw);
  const moves = ground(repaired, text, lastSystem, suggested, is.wish);
  return { moves, dropped: repaired.filter((m) => !moves.includes(m)) };
}

/**
 * Checks on what the LLM extracted, using only the user's own words. Small models sometimes copy the assistant's
 * words into the user's moves ("yes this one" → a wish the assistant just said). A move the user's words do not
 * support is dropped, never changed.
 */

/** Lowercase words: apostrophes removed ("don't" → "dont"), everything else that is not a letter or digit is a gap. */
const words = (s: string): string[] =>
  s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/** Only agreement, nothing else: "yes", "sounds good", "yeah why not, let's go with that". */
export function isAffirmation(text: string): boolean {
  const w = words(text);
  return w.length > 0 && w.length <= settings.dialogue.affirmationMaxWords && settings.dialogue.affirmation.test(w.join(" "));
}

const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "with", "it", "is", "that", "this", "one", "movie", "film", "vibe"]);
const content = (s: string) => words(s).filter((w) => w.length >= 3 && !STOP.has(w));

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Same word, allowing a shared 5-letter start ("lighthearted"/"light") or a misheard letter or two. */
const same = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && (a.slice(0, 5) === b.slice(0, 5) || distance(a, b) <= 2));
const mentions = (text: string, word: string) => words(text).some((t) => same(t, word));

/** Words that make up "I'm not sure" / "you decide": hesitation, not taste. */
const HEDGE = new Set(["not", "no", "sure", "yet", "idea", "dont", "know", "dunno", "you", "decide", "pick", "choose", "your", "call", "whatever", "anything", "either", "care", "maybe", "hmm", "um", "uh", "think", "what", "do", "i", "am", "really", "so", "well"]);

/** Is a movie title (as the LLM wrote it) in what the user said? At least half of its words must be. */
function titleSaid(title: string, utterance: string): boolean {
  const w = content(title);
  if (!w.length) return true;
  return w.filter((x) => mentions(utterance, x)).length >= Math.ceil(w.length / 2);
}

/**
 * A refusal inside a wish ("no princesses", "not too scary", "without office settings", "isn't gory"), up to the
 * next comma, full stop, "and" or "but". A "not" after "does", "can" and similar is part of the story, and so are
 * "never", "can't" and "non-stop".
 */
const REFUSAL =
  /(?<glue>\s*,?\s*\b(?:but|and|that|which|with)\s+|\s*,\s*|\s+|^)(?<!\b(?:do|does|did|can|could|will|would|should|must)\s+)(?<cue>\b(?:no|without|nothing|not|isn['’]t|aren['’]t|is\s+not|are\s+not)\b(?:\s+too\b)?)\s+(?<what>[^,;.!?]+?)(?<end>\s*[,;]\s*|\s+(?:and|but)\s+|\s*[.!?]*\s*$)/i;

/**
 * Splits the refusals out of a wish, because an embedding ranks the refused thing first. "A magical adventure with
 * no princesses and lots of laughs." gives the wish "A magical adventure with lots of laughs." and the avoid
 * "princesses". The wish is empty when nothing else is left.
 */
function splitRefusals(text: string): { wish: string; avoid: string[] } {
  const avoid: string[] = [];
  let rest = text;
  for (let m = rest.match(REFUSAL); m?.groups; m = rest.match(REFUSAL)) {
    const { glue, what, end } = m.groups;
    avoid.push(what.trim());
    const atEnd = /^[\s.!?]*$/.test(end);
    // In the middle, "with" and a comma still join what comes before to what comes after.
    const keep = atEnd ? "" : /\bwith\b/i.test(glue) ? " with " : glue.includes(",") ? ", " : " ";
    rest = rest.slice(0, m.index) + keep + rest.slice(m.index! + m[0].length);
  }
  const wish = rest.replace(/\s+/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "");
  if (!/[a-z]/i.test(wish)) return { wish: "", avoid };
  const capital = wish[0].toUpperCase() + wish.slice(1);
  return { wish: /[.!?]$/.test(capital) ? capital : `${capital}.`, avoid };
}

/**
 * Repairs the model's two common slips on the way to the rules: refusals in the wish are split off into avoids,
 * and a relative tone request (an `adjust` move "goofier", which the prompt no longer offers but small models still
 * produce, and which `clean` drops) is folded into the wish. Anything else is left as it is.
 */
export function repairMoves(moves: Move[], wish: string, raw: unknown[]): Move[] {
  const out: Move[] = [];
  for (const m of moves) {
    if (m.type !== "wish") {
      out.push(m);
      continue;
    }
    const split = splitRefusals(m.text);
    if (split.wish) out.push({ type: "wish", text: split.wish });
    out.push(...split.avoid.map((text): Move => ({ type: "avoid", text })));
  }
  for (const r of raw as { type?: unknown; dimension?: unknown; direction?: unknown }[]) {
    const dir = typeof r?.direction === "string" ? r.direction.trim() : "";
    if (r?.type !== "adjust" || !dir || ["era", "rating", "runtime"].includes(String(r.dimension))) continue; // not a tone
    const i = out.findIndex((m) => m.type === "wish");
    const base = i >= 0 ? (out[i] as Extract<Move, { type: "wish" }>).text : wish;
    if (mentions(base, dir)) continue;
    const text = `${base ? `${base} ` : ""}${dir[0].toUpperCase()}${dir.slice(1)}.`;
    if (i >= 0) out[i] = { type: "wish", text };
    else out.push({ type: "wish", text });
  }
  return out;
}

/**
 * Did these words come from the assistant rather than the user? True when all of `fresh` are in the assistant's
 * last turn and none in the user's words: "cozy" offered by Elisa and answered with "the second one, please".
 */
const copied = (fresh: string[], utterance: string, lastSystem: string | undefined) =>
  !!lastSystem && fresh.length > 0 && fresh.every((x) => mentions(lastSystem, x)) && !fresh.some((x) => mentions(utterance, x));

/**
 * `utterance`: what the user just said. `lastSystem`: the assistant's last turn, if any.
 * `suggested`: the movie the assistant last suggested, if any. `wish`: the wish so far.
 */
export function ground(moves: Move[], utterance: string, lastSystem: string | undefined, suggested: string | null, wish = ""): Move[] {
  return moves.filter((m) => {
    switch (m.type) {
      case "person":
        return titleSaid(m.name, utterance);
      case "wish": {
        if (words(m.text).every((w) => HEDGE.has(w))) return false; // "not sure yet" is not a taste
        // Only the words the rewrite adds to the old wish count. A bare "yes" to Elisa's proposal takes it.
        const fresh = content(m.text).filter((x) => !mentions(wish, x));
        return isAffirmation(utterance) || !copied(fresh, utterance, lastSystem);
      }
      case "avoid":
        return !words(m.text).every((w) => HEDGE.has(w)) && !copied(content(m.text), utterance, lastSystem);
      case "accept":
        return suggested !== null;
      default:
        return true;
    }
  });
}
