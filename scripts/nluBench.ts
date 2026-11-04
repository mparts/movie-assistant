/**
 * NLU benchmark: cases, scoring and timing. No I/O of its own, so it is testable with a stub LlmClient.
 * The CLI is scripts/nlu-bench.ts.
 *
 * Each case is a state + utterance + a check on the cleaned moves. Checks are deliberately loose
 * (any reasonable reading passes) so a model fails for being wrong, not for being worded differently.
 */
import { initialIS } from "../src/core/state";
import { parseIntake } from "../src/core/intake";
import sampleProfile from "../profiles/solo.json";
import type { InformationState, LlmClient, Move, Movie, Qud, Turn } from "../src/core/types";
import { understand } from "../src/dialogue/nlu";

export interface BenchCase {
  name: string;
  history?: Turn[];
  /** Movie the assistant last suggested (the focus for "that one"). */
  suggested?: string;
  /** Did the assistant's last turn recommend it? Default: yes when `suggested` is set. */
  justSuggested?: boolean;
  /** What Jake's last turn left open. Default: a suggestion if he just made one, taste if he spoke last, otherwise none. */
  qud?: Qud;
  /** Edits to the information state before the utterance (what the system already knows). */
  state?: (is: InformationState) => InformationState;
  utterance: string;
  /** null = pass, otherwise why it failed. */
  check: (moves: Move[]) => string | null;
}

const sys = (text: string): Turn => ({ speaker: "sys", text });
const usr = (text: string): Turn => ({ speaker: "usr", text });
const stub = (title: string): Movie => ({ id: 1, title, genres: [], rating: 7, votes: 1000, overview: "" });

const of = <T extends Move["type"]>(moves: Move[], type: T) =>
  moves.filter((m): m is Extract<Move, { type: T }> => m.type === type);
const expect = (ok: boolean, why: string) => (ok ? null : why);
/** The first part of the chat in chat.log that broke the app ("real-*" cases below). */
const realHistory: Turn[] = [
  sys("Hey! I'm Jake, your movie companion. How are you feeling today?"),
  usr("hey I am alright, how are you?"),
  sys("I'm good, thanks. Anything particular you're in the mood for tonight?"),
  usr("I was thinking something romantic but also funny!!"),
];
const offer = sys("Romance and laughs, nice combo. Are you leaning more toward a lighthearted date vibe or something with a bit more heart?");
const realSuggestion = [...realHistory, offer, usr("yeap you got me... lighthearted date vibe it is!!"), sys("Roman Holiday has that sweet, breezy romance and funny moments perfect for a light date night.")];
const onlyAccept = (m: Move[]) => expect(m.length === 1 && m[0].type === "accept", `expected one accept move, got ${JSON.stringify(m)}`);
const romcom = (is: InformationState): InformationState => ({ ...is, genres: ["Romance", "Comedy"], wish: "A light, funny romantic comedy." });
const wishes = (m: Move[], re: RegExp) => of(m, "wish").some((w) => re.test(w.text));
/** Words that turn a wish into its opposite: they belong in "avoid" or a negated genre. */
const NEGATION = /\b(no|not|without|never|nothing|avoid|but)\b/i;
/** A family chat where the taste changed after Jake asked or suggested, and the new words got lost. */
const familyAsked: Turn[] = [
  sys("Hey! I'm Jake, your movie companion. How are you feeling today?"),
  usr("hey! something for the family tonight, maybe an animated adventure"),
  sys("Sounds lovely. Anything in particular the kids enjoy?"),
];
const familySuggested: Turn[] = [
  ...familyAsked,
  usr("not really, you pick"),
  sys("How about Luca? It's a gentle animated adventure about two sea monsters spending a summer on the Italian coast."),
];
const familyWish = (is: InformationState): InformationState => ({ ...is, wish: "A gentle animated adventure." });
/** "animals", not "animated": the model tends to fold the new word into the old wish. */
const ANIMALS = /\banimals?\b/i;

export const cases: BenchCase[] = [
  {
    name: "real-pick-offered-vibe",
    history: [...realHistory, offer],
    state: romcom,
    utterance: "yeap you got me... lighthearted date vibe it is!!",
    check: (m) => expect(wishes(m, /light|date/i), "the chosen vibe did not reach the wish"),
  },
  {
    name: "real-reject-and-funnier",
    history: realSuggestion,
    suggested: "Roman Holiday",
    state: romcom,
    utterance: "hhmm... no I do not like this.. maybe something more funny",
    // The "no" belongs to "this", not to funny: Comedy must never end up avoided.
    check: (m) =>
      expect(
        !of(m, "prefer").some((p) => p.negated) && (of(m, "reject").length > 0 || wishes(m, /funn|comed|laugh|humou?r/i)),
        "the 'no' was attached to a genre, or neither the rejection nor 'funnier' was understood"
      ),
  },
  {
    name: "real-accept-bare-yes",
    history: [...realSuggestion, usr("hhmm... no, maybe something more funny"), sys("How about About Time? It mixes sweet romance with a lot of humor, perfect for a light date night.")],
    suggested: "About Time",
    state: romcom,
    utterance: "yeah why not.. let's go with that!!",
    check: onlyAccept,
  },
  {
    name: "real-yes-drops-the-restriction",
    history: [...realSuggestion, sys("Got it, you want more laughs. Would you be willing to drop the no-comedy restriction?")],
    suggested: "About Time",
    justSuggested: false,
    qud: "change",
    state: (is) => ({ ...is, genres: ["Romance"], avoidGenres: ["Comedy"] }),
    utterance: "yes please do that!!",
    // Either way the avoided genre is released: a retract, or a plain "wants Comedy" (which removes it from the avoided).
    check: (m) =>
      expect(
        of(m, "retract").some((r) => r.slot === "avoidGenres") || of(m, "prefer").some((p) => !p.negated && /comedy/i.test(p.genre)),
        "the avoided genre was not released"
      ),
  },
  {
    name: "real-yes-to-an-alternative",
    history: [...realSuggestion, sys("Looks like none of the picks are big comedies, but we could go with a sweet romance like Past Lives if that works for you.")],
    justSuggested: false,
    qud: "change",
    state: romcom,
    utterance: "yes it works!!",
    // A yes to Jake's proposal may update the wish or accept; never a negated genre, an avoid, or a liked movie.
    check: (m) =>
      expect(
        !of(m, "prefer").some((p) => p.negated) && !of(m, "avoid").length && !of(m, "like").length,
        `recorded ${JSON.stringify(m)} from the assistant's words`
      ),
  },
  {
    name: "real-confirm-this-one",
    history: [...realSuggestion, sys("Back to the Future has that fun, goofy vibe with a sweet hint of romance, perfect for a light date night.")],
    suggested: "Back to the Future",
    state: romcom,
    utterance: "yes this one",
    check: onlyAccept,
  },
  {
    name: "accept-with-extra-words",
    history: [sys("How about Palm Springs? It's a funny, warm time-loop romance.")],
    suggested: "Palm Springs",
    state: romcom,
    utterance: "ok that sounds great, let's watch it tonight",
    check: (m) => expect(of(m, "accept").length === 1 && m.every((x) => x.type === "accept"), `expected only an accept, got ${JSON.stringify(m)}`),
  },
  {
    name: "unsure-copies-nothing-from-jake",
    history: [sys("Back to the Future has that fun, goofy vibe with a sweet hint of romance, perfect for a light date night.")],
    suggested: "Back to the Future",
    state: romcom,
    utterance: "hmm, I'm not sure about that one",
    check: (m) =>
      expect(!wishes(m, /goofy|future|time travel/i) && !of(m, "like").length && !of(m, "avoid").length && !of(m, "prefer").some((p) => p.negated), `recorded ${JSON.stringify(m)}`),
  },
  {
    name: "no-genre-kept",
    utterance: "no scary stuff please",
    check: (m) =>
      expect(
        of(m, "prefer").some((p) => p.negated && /horror/i.test(p.genre)) || of(m, "avoid").some((a) => /scar|horror|fright/i.test(a.text)),
        "neither a negated Horror nor an avoid"
      ),
  },
  {
    name: "pick-offered-option",
    history: [
      usr("I was thinking a romantic comedy will be nice"),
      sys("Sounds like a rom-com could hit the spot. Any particular vibe, like goofy or more heartfelt?"),
    ],
    state: romcom,
    utterance: "goofy huh? yeah let's go with that!!",
    check: (m) => expect(wishes(m, /goof|sill|zan|wack/i), "'goofy' did not reach the wish"),
  },
  {
    name: "question-alone-adds-nothing",
    history: [
      usr("I was thinking a romantic comedy will be nice"),
      sys("Sounds like a rom-com could hit the spot. Are you after something light and funny, or more heartfelt?"),
    ],
    state: romcom,
    utterance: "hmm, not sure yet, what do you think?",
    // Jake's offered options or the user's hesitation must not become taste.
    check: (m) =>
      expect(!wishes(m, /heartfelt|not sure/i) && !of(m, "avoid").length && !of(m, "prefer").some((p) => p.negated), `recorded ${JSON.stringify(m)}`),
  },
  {
    name: "negated-setting",
    history: [sys("How about The Hating Game? It's a playful office rivalry that turns sweet and funny.")],
    suggested: "The Hating Game",
    state: romcom,
    utterance: "hhhmmm... not really... I don't like office settings",
    check: (m) =>
      expect(
        (of(m, "avoid").some((a) => /office/i.test(a.text)) || of(m, "reject").length > 0) && !wishes(m, /office/i),
        "neither the office setting nor a rejection was recorded, or 'office' went into the wish"
      ),
  },
  {
    name: "greeting-gives-nothing",
    history: [sys("Hey! I'm Jake, your movie companion. How are you feeling today?")],
    utterance: "I am alright Jake, how are you?",
    check: (m) => expect(m.length === 0, `expected no moves, got ${m.length}`),
  },
  {
    name: "genre-pair",
    history: [sys("I'm good, thanks. Anything particular you're in the mood for tonight?")],
    utterance: "I was thinking a romantic comedy will be nice!!",
    check: (m) => {
      const t = [...of(m, "prefer").map((p) => p.genre), ...of(m, "wish").map((w) => w.text)].join(" ");
      return expect(/roman/i.test(t) && /comed/i.test(t), "Romance and Comedy not both found");
    },
  },
  {
    name: "first-wish",
    history: [sys("What are you in the mood for tonight?")],
    utterance: "something cozy and funny for a rainy evening",
    check: (m) => expect(wishes(m, /cozy|cosy/i) && wishes(m, /funn|comed|laugh|humou?r/i), "no wish with cozy and funny"),
  },
  {
    name: "wish-update-keeps-the-old",
    history: [sys("A tense crime thriller, got it. Anything else?")],
    state: (is) => ({ ...is, wish: "A tense, gritty crime thriller about a detective hunting a killer." }),
    utterance: "maybe with a bit more humor",
    check: (m) => expect(wishes(m, /crime|thriller|detective/i) && wishes(m, /humou?r|funn|comed|witty/i), "the rewritten wish lost the old taste or the new humor"),
  },
  {
    name: "avoid-is-not-in-the-wish",
    utterance: "an adventure for the kids, but no princesses please",
    check: (m) =>
      expect(
        of(m, "avoid").some((a) => /princess/i.test(a.text)) && !of(m, "wish").some((w) => /princess/i.test(w.text) || NEGATION.test(w.text)),
        "princesses not avoided, or they (or a negation) ended up in the wish"
      ),
  },
  {
    name: "scary-not-gory",
    utterance: "something scary with ghosts, but not gory",
    check: (m) =>
      expect(
        wishes(m, /ghost|haunt|scary|creepy/i) && of(m, "avoid").some((a) => /gor|blood/i.test(a.text)) && !of(m, "wish").some((w) => NEGATION.test(w.text) || /gor/i.test(w.text)),
        "no ghost wish, no gore avoid, or a negation in the wish"
      ),
  },
  {
    name: "person-wanted",
    utterance: "anything with Tom Hanks?",
    check: (m) => expect(of(m, "person").some((p) => /hanks/i.test(p.name) && !p.negated), "no wanted Tom Hanks"),
  },
  {
    name: "person-avoided",
    utterance: "please nothing with Adam Sandler",
    check: (m) => expect(of(m, "person").some((p) => /sandler/i.test(p.name) && p.negated), "no avoided Adam Sandler"),
  },
  {
    name: "director",
    utterance: "I'm in the mood for a Nolan film",
    check: (m) => expect(of(m, "person").some((p) => /nolan/i.test(p.name) && !p.negated), "no wanted Nolan"),
  },
  {
    name: "runtime-limit",
    utterance: "I only have an hour and a half tonight",
    check: (m) =>
      expect(
        of(m, "constrain").some((c) => c.slot === "runtime" && c.op === "lte" && typeof c.value === "number" && c.value >= 85 && c.value <= 100),
        "no runtime <= ~90"
      ),
  },
  {
    name: "negated-genre",
    utterance: "anything but horror, I can't sleep after those",
    check: (m) => expect(of(m, "prefer").some((p) => /horror/i.test(p.genre) && p.negated === true), "no negated Horror"),
  },
  {
    name: "seen-the-one-suggested",
    history: [sys("How about Knives Out? It's a clever whodunit.")],
    suggested: "Knives Out",
    utterance: "oh I watched that one ages ago",
    check: (m) => expect(of(m, "seen").length === 1, "no 'seen' move"),
  },
  {
    name: "reject-the-one-suggested",
    history: [sys("How about Knives Out? It's a clever whodunit.")],
    suggested: "Knives Out",
    utterance: "nah, that's not for me",
    check: (m) => expect(of(m, "reject").length === 1, "no 'reject' move"),
  },
  {
    // From a live chat: with a person in the same sentence, the like was dropped and Jake suggested Inception back.
    name: "like-next-to-a-person",
    history: [sys("Sounds like you want something that'll twist your brain a bit. More cerebral puzzles or flashy action?")],
    state: (is) => ({ ...is, wish: "A mind-bending sci-fi movie." }),
    utterance: "something like Inception, maybe even by Nolan",
    check: (m) => expect(of(m, "like").some((l) => /inception/i.test(l.title)) && of(m, "person").some((p) => /nolan/i.test(p.name)), "the like or the person was lost"),
  },
  {
    name: "like-a-named-movie",
    utterance: "something along the lines of Parasite",
    check: (m) => expect(of(m, "like").some((l) => /parasite/i.test(l.title)), "no 'like Parasite'"),
  },
  {
    name: "relative-shorter",
    history: [sys("Maybe The Godfather? It's a classic.")],
    suggested: "The Godfather",
    utterance: "do you have anything a bit shorter than that?",
    check: (m) =>
      expect(
        of(m, "constrain").some((c) => c.slot === "runtime" && c.op === "lte"),
        "no shorter-runtime request"
      ),
  },
  {
    name: "decade",
    utterance: "only movies from the nineties please",
    check: (m) =>
      expect(
        of(m, "constrain").some((c) => c.slot === "year" && typeof c.value === "number" && c.value >= 1988 && c.value <= 2000),
        "no 1990s year bound"
      ),
  },
  {
    name: "recent-years",
    utterance: "something from the last few years",
    // The model has to know today's date: "last few years" is about 5 years back, not 2010.
    check: (m) => {
      const year = new Date().getFullYear();
      return expect(
        of(m, "constrain").some((c) => c.slot === "year" && c.op === "gte" && typeof c.value === "number" && c.value >= year - 7 && c.value <= year),
        "no year bound within about 7 years of today"
      );
    },
  },
  {
    name: "question-gives-nothing",
    history: [sys("How about Knives Out? It's a clever whodunit.")],
    suggested: "Knives Out",
    utterance: "who's in it?",
    check: (m) => expect(m.length === 0, `expected no moves, got ${JSON.stringify(m)}`),
  },
  {
    name: "talking-animals-after-suggestion",
    history: familySuggested,
    suggested: "Luca",
    state: familyWish,
    utterance: "something with talking animals would be great",
    check: (m) => expect(wishes(m, ANIMALS), "'animals' did not reach the wish"),
  },
  {
    name: "dinosaurs-after-suggestion",
    history: familySuggested,
    suggested: "Luca",
    state: familyWish,
    utterance: "something with dinosaurs",
    check: (m) => expect(wishes(m, /dinosaur/i), "'dinosaurs' did not reach the wish"),
  },
  {
    name: "kids-love-animals-after-suggestion",
    history: familySuggested,
    suggested: "Luca",
    state: familyWish,
    utterance: "the kids love animals",
    check: (m) => expect(wishes(m, ANIMALS), "'animals' did not reach the wish"),
  },
  {
    name: "friendship-after-suggestion",
    history: familySuggested,
    suggested: "Luca",
    state: familyWish,
    utterance: "how about a movie about friendship",
    check: (m) => expect(wishes(m, /friend/i), "'friendship' did not reach the wish"),
  },
  {
    name: "funny-animals-keeps-the-word",
    history: familyAsked,
    state: familyWish,
    utterance: "something funny with animals",
    check: (m) => expect(of(m, "wish").some((w) => ANIMALS.test(w.text) && /funn|comed|laugh|humou?r/i.test(w.text)), "no wish with both 'animals' and funny"),
  },
];

export function stateFor(c: BenchCase): InformationState {
  const base = initialIS(parseIntake(sampleProfile));
  const justSuggested = !!c.suggested && c.justSuggested !== false;
  const sysLast = c.history?.[c.history.length - 1]?.speaker === "sys";
  const is: InformationState = {
    ...base,
    history: c.history ?? [],
    recommended: c.suggested ? [stub(c.suggested)] : [],
    recommendStreak: justSuggested ? 1 : 0,
    qud: c.qud ?? (justSuggested ? "suggestion" : sysLast ? "taste" : "none"),
  };
  return c.state ? c.state(is) : is;
}

export interface CaseResult {
  name: string;
  /** "ok" | "wrong" (valid answer, failed check) | "invalid" (call failed or no usable JSON) */
  status: "ok" | "wrong" | "invalid";
  ms: number;
  moves?: Move[];
  why?: string;
}

export async function runCase(llm: LlmClient, c: BenchCase): Promise<CaseResult> {
  const t0 = performance.now();
  try {
    const moves = await understand(llm, c.utterance, stateFor(c));
    const ms = performance.now() - t0;
    const why = c.check(moves);
    return { name: c.name, status: why ? "wrong" : "ok", ms, moves, why: why ?? undefined };
  } catch (e) {
    return { name: c.name, status: "invalid", ms: performance.now() - t0, why: String((e as Error).message ?? e).slice(0, 200) };
  }
}

export interface Summary {
  total: number;
  ok: number;
  wrong: number;
  invalid: number;
  p50: number;
  p95: number;
}

/** Nearest-rank percentile of the call times, in ms. */
export const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function summarize(results: CaseResult[]): Summary {
  const ms = results.map((r) => r.ms);
  return {
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    wrong: results.filter((r) => r.status === "wrong").length,
    invalid: results.filter((r) => r.status === "invalid").length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
  };
}

/** One untimed-in-stats warm-up call (loads the model), then every case once. */
export async function runBench(
  llm: LlmClient,
  list: BenchCase[] = cases
): Promise<{ warmupMs: number; results: CaseResult[]; summary: Summary }> {
  const warm = await runCase(llm, { name: "warm-up", utterance: "hello there", check: () => null });
  const results: CaseResult[] = [];
  for (const c of list) results.push(await runCase(llm, c));
  return { warmupMs: warm.ms, results, summary: summarize(results) };
}

/** Plain-text table, one row per model. */
export function formatTable(rows: { model: string; warmupMs: number; summary: Summary }[]): string {
  const head = ["model", "correct", "wrong", "invalid", "p50 ms", "p95 ms", "warm-up ms"];
  const body = rows.map(({ model, warmupMs, summary: s }) => [
    model,
    `${s.ok}/${s.total}`,
    String(s.wrong),
    String(s.invalid),
    String(Math.round(s.p50)),
    String(Math.round(s.p95)),
    String(Math.round(warmupMs)),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i])).join("  ").trimEnd();
  return [line(head), line(w.map((n) => "-".repeat(n))), ...body.map(line)].join("\n");
}
