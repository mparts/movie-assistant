/**
 * NLU benchmark: cases, scoring and timing. No I/O of its own, so it is testable with a stub LlmClient.
 * The CLI is scripts/nlu-bench.ts.
 *
 * Each case is a state + utterance + a check on the cleaned moves. Checks are deliberately loose
 * (any reasonable reading passes) so a model fails for being wrong, not for being worded differently.
 */
import { initialIS } from "../src/core/state";
import type { InformationState, LlmClient, Move, Movie, Turn } from "../src/core/types";
import { understand } from "../src/dialogue/nlu";

export interface BenchCase {
  name: string;
  history?: Turn[];
  /** Movie the assistant last suggested (the focus for "that one"). */
  suggested?: string;
  /** Did the assistant's last turn recommend it? Default: yes when `suggested` is set. */
  justSuggested?: boolean;
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
const romcom = (is: InformationState): InformationState => ({
  ...is,
  prefs: { ...is.prefs, genres: ["Romance", "Comedy"], required: ["Romance", "Comedy"] },
});

export const cases: BenchCase[] = [
  {
    name: "real-pick-offered-vibe",
    history: [...realHistory, offer],
    state: romcom,
    utterance: "yeap you got me... lighthearted date vibe it is!!",
    check: (m) => expect(of(m, "vibe").some((v) => /light|date/i.test(v.text)), "the chosen vibe was not recorded"),
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
        !of(m, "prefer").some((p) => p.negated) &&
          (of(m, "reject").length > 0 || of(m, "adjust").some((a) => /funn/i.test(a.direction))),
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
    state: (is) => ({ ...is, prefs: { ...is.prefs, genres: ["Romance"] }, dislikes: { genres: ["Comedy"] } }),
    utterance: "yes please do that!!",
    // Either way the avoided genre is released: a retract, or a plain "wants Comedy" (which removes it from the avoided).
    check: (m) =>
      expect(
        of(m, "retract").some((r) => r.slot === "dislikes") || of(m, "prefer").some((p) => !p.negated && /comedy/i.test(p.genre ?? "")),
        "the avoided genre was not released"
      ),
  },
  {
    name: "real-yes-to-an-alternative",
    history: [...realSuggestion, sys("Looks like none of the picks are big comedies, but we could go with a sweet romance like Past Lives if that works for you.")],
    justSuggested: false,
    state: (is) => ({ ...is, prefs: { ...is.prefs, genres: ["Romance", "Drama"] } }),
    utterance: "yes it works!!",
    // Nothing to record, or an accept; repeating the genres already known is harmless. Never a negated genre, a vibe
    // or a like taken from Jake's sentence.
    check: (m) =>
      expect(
        m.every((x) => x.type === "accept" || (x.type === "prefer" && !x.negated && /^(romance|comedy|drama)$/i.test(x.genre ?? ""))),
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
    check: (m) => expect(!of(m, "vibe").length && !of(m, "like").length && !of(m, "prefer").some((p) => p.negated), `recorded ${JSON.stringify(m)}`),
  },
  {
    name: "no-genre-kept",
    utterance: "no scary stuff please",
    check: (m) => expect(of(m, "prefer").some((p) => p.negated && /horror|scary/i.test(`${p.genre ?? ""} ${p.mood ?? ""}`)), "no negated Horror"),
  },
  {
    name: "6c-pick-offered-option",
    history: [
      usr("I was thinking a romantic comedy will be nice"),
      sys("Sounds like a rom-com could hit the spot. Any particular vibe, like goofy or more heartfelt?"),
    ],
    state: romcom,
    utterance: "goofy huh? yeah let's go with that!!",
    // Either a vibe or a mood/genre preference counts as having heard "goofy". (Whether the rules KEEP an unknown
    // mood is a separate question, covered by step 6d; this case only scores what the model understood.)
    check: (m) =>
      expect(
        of(m, "vibe").some((v) => /goofy|silly|funny|light/i.test(v.text)) ||
          of(m, "prefer").some((p) => !p.negated && /goofy|silly|funny|comed/i.test(`${p.mood ?? ""} ${p.genre ?? ""}`)),
        "'goofy' was not picked up (or came back negated)"
      ),
  },
  {
    name: "6c-question-alone-adds-nothing",
    history: [
      usr("I was thinking a romantic comedy will be nice"),
      sys("Sounds like a rom-com could hit the spot. Are you after something light and funny, or more heartfelt?"),
    ],
    state: romcom,
    utterance: "hmm, not sure yet, what do you think?",
    // Repeating the genres already known (Romance, Comedy) is harmless: the rules dedupe it. Anything else is
    // Jake's offered options or the user's hesitation ("not sure yet") recorded as taste.
    check: (m) =>
      expect(
        !of(m, "vibe").length && of(m, "prefer").every((p) => /^(romance|comedy)$/i.test(p.genre ?? "") && !p.negated),
        "recorded something that was not the user's answer (Jake's options, or hesitation)"
      ),
  },
  {
    name: "6b-negated-setting",
    history: [sys("How about The Hating Game? It's a playful office rivalry that turns sweet and funny.")],
    suggested: "The Hating Game",
    state: romcom,
    utterance: "hhhmmm... not really... I don't like office settings",
    check: (m) =>
      expect(
        of(m, "vibe").some((v) => /office/i.test(v.text)) || of(m, "reject").length > 0,
        "neither the office setting nor a rejection was recorded"
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
      const t = of(m, "prefer").map((p) => `${p.genre ?? ""} ${p.mood ?? ""}`).join(" ");
      return expect(/romanc|romantic/i.test(t) && /comed|funny/i.test(t), "Romance and Comedy not both found");
    },
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
    check: (m) => expect(of(m, "prefer").some((p) => /horror/i.test(p.genre ?? "") && p.negated === true), "no negated Horror"),
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
    name: "like-a-named-movie",
    utterance: "something along the lines of Parasite",
    check: (m) => expect(of(m, "like").some((l) => /parasite/i.test(l.title)), "no 'like Parasite'"),
  },
  {
    name: "restart",
    utterance: "actually, let's start over and forget all of that",
    check: (m) => expect(of(m, "restart").length === 1, "no 'restart' move"),
  },
  {
    name: "relative-shorter",
    history: [sys("Maybe The Godfather? It's a classic.")],
    suggested: "The Godfather",
    utterance: "do you have anything a bit shorter than that?",
    check: (m) =>
      expect(
        of(m, "adjust").some((a) => a.dimension === "runtime" && /short/i.test(a.direction)) ||
          of(m, "constrain").some((c) => c.slot === "runtime" && c.op === "lte"),
        "no shorter-runtime request"
      ),
  },
  {
    name: "retract-time-limit",
    state: (is) => ({ ...is, constraints: { ...is.constraints, runtime: { max: 90 } } }),
    utterance: "never mind the time limit, any length is fine",
    check: (m) => expect(of(m, "retract").some((r) => r.slot === "runtime"), "no retract of runtime"),
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
];

export function stateFor(c: BenchCase): InformationState {
  const base = initialIS();
  const is: InformationState = {
    ...base,
    history: c.history ?? [],
    recommended: c.suggested ? [stub(c.suggested)] : [],
    recommendStreak: c.suggested && c.justSuggested !== false ? 1 : 0,
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
