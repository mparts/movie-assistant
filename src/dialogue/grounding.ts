/**
 * Checks on what the LLM extracted, using only the user's own words. Small models sometimes copy the assistant's
 * words into the user's moves ("yes this one" → a wish the assistant just said) or attach a "no" to the wrong thing
 * ("no I don't like this, maybe something more funny" → no Comedy). A move the user's words do not support is
 * dropped, never changed.
 */
import { settings } from "../config/settings";
import { resolveGenres, wordsFor } from "../core/lexicon";
import type { Move } from "../core/types";

/** Lowercase words: apostrophes removed ("don't" → "dont"), everything else that is not a letter or digit is a gap. */
export const words = (s: string): string[] =>
  s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/** Like `words`, but sentence and clause breaks (. , ; ! ? : and dashes) stay as "|" so a "no" cannot reach across one. */
const clauseWords = (s: string): string[] =>
  s.toLowerCase().replace(/['’]/g, "").replace(/[.,;:!?…—–-]+/g, " | ").replace(/[^a-z0-9|]+/g, " ").trim().split(" ").filter(Boolean);

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

const CUES = new Set(["no", "not", "dont", "doesnt", "cant", "cannot", "wont", "never", "without", "hate", "hates", "avoid", "except", "skip", "nothing", "none", "nor"]);
/** Between a "no" and what it applies to, these mean the person has moved on to what they DO want. */
const BLOCKERS = new Set(["more", "maybe", "something", "rather", "instead", "also", "any", "but"]);
const REACH = 6; // a cue applies to a word at most this many words after it, within one clause

/** Positions (word index) in `said` where any of these terms occurs, plural forms included. */
function positions(said: string[], terms: string[]): number[] {
  const joined = ` ${said.join(" ")} `;
  const out: number[] = [];
  for (const t of terms) {
    for (const form of [t, `${t}s`, `${t}es`]) {
      for (let at = joined.indexOf(` ${form} `); at >= 0; at = joined.indexOf(` ${form} `, at + 1)) {
        out.push(joined.slice(0, at + 1).trim().split(" ").filter(Boolean).length);
      }
    }
  }
  return out;
}

/** Does a "no" sit right before position p, with nothing in between that turns the sentence positive? */
function negatedAt(said: string[], p: number): boolean {
  for (let q = p - 1; q >= 0 && p - q <= REACH; q--) {
    const w = said[q];
    if (w === "|") return false; // a new sentence or clause
    if (CUES.has(w) || (w === "but" && ["anything", "everything", "all"].includes(said[q - 1]))) return true;
    if (BLOCKERS.has(w)) return false;
  }
  return false;
}

/** A negated genre needs the word (or an alias) in the user's utterance, and a "no" right before it. */
function negationSupported(m: Extract<Move, { type: "prefer" }>, utterance: string): boolean {
  const said = clauseWords(utterance);
  const terms = new Set([words(m.genre).join(" "), ...wordsFor(resolveGenres(m.genre))]);
  return positions(said, [...terms]).some((p) => negatedAt(said, p));
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
export function splitRefusals(text: string): { wish: string; avoid: string[] } {
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
 * last turn and none in the user's words: "cozy" offered by Jake and answered with "the second one, please".
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
        // Only the words the rewrite adds to the old wish count. A bare "yes" to Jake's proposal takes it.
        const fresh = content(m.text).filter((x) => !mentions(wish, x));
        return isAffirmation(utterance) || !copied(fresh, utterance, lastSystem);
      }
      case "avoid":
        return !words(m.text).every((w) => HEDGE.has(w)) && !copied(content(m.text), utterance, lastSystem);
      case "prefer":
        return m.negated ? negationSupported(m, utterance) : true;
      case "accept":
        return suggested !== null;
      default:
        return true;
    }
  });
}
