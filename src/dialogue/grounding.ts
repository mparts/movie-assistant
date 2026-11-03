/**
 * Checks on what the LLM extracted, using only the user's own words. Small models sometimes copy the assistant's
 * words into the user's moves ("yes this one" → vibes the assistant just said) or attach a "no" to the wrong thing
 * ("no I don't like this, maybe something more funny" → no Comedy). A move the user's words do not support is
 * dropped, never changed.
 */
import { settings } from "../config/settings";
import { resolvePreference, wordsFor } from "../core/lexicon";
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

/** A negated genre/mood needs the word in the user's utterance, and a "no" right before it. */
function negationSupported(m: Extract<Move, { type: "prefer" }>, utterance: string): boolean {
  const said = clauseWords(utterance);
  const named = [m.genre, m.mood].filter((t): t is string => !!t?.trim());
  const terms = new Set([
    ...named.map((t) => words(t).join(" ")),
    ...wordsFor(named.flatMap((t) => resolvePreference(t).names)),
  ]);
  return positions(said, [...terms]).some((p) => negatedAt(said, p));
}

/**
 * `utterance`: what the user just said. `lastSystem`: the assistant's last turn, if any.
 * `suggested`: the movie the assistant last suggested, if any.
 */
export function ground(moves: Move[], utterance: string, lastSystem: string | undefined, suggested: string | null): Move[] {
  return moves.filter((m) => {
    switch (m.type) {
      case "like":
        return titleSaid(m.title, utterance);
      case "vibe": {
        if (words(m.text).every((w) => HEDGE.has(w))) return false; // "not sure yet" is not a taste
        // All its words come from the assistant's last turn, none from the user's: the assistant's words, not theirs.
        const w = content(m.text);
        return !(lastSystem && w.length && w.every((x) => mentions(lastSystem, x)) && !w.some((x) => mentions(utterance, x)));
      }
      case "prefer":
        return m.negated ? negationSupported(m, utterance) : true;
      case "accept":
        return suggested !== null;
      default:
        return true;
    }
  });
}
