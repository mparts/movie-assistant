export const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Does `text` name this movie title? Whole words, any case: "Up" is not in "supper". */
export const namesTitle = (text: string, title: string) => new RegExp(`(^|\\W)${escape(title)}(\\W|$)`, "i").test(text);
export const sameIds = <T extends { id: number }>(a: T[], b: T[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i].id);

/** Dump the full information state when `DEBUG=1` (node) or `globalThis.DME_DEBUG = true` (browser). */
export const isDebug = () => !!(globalThis as any).DME_DEBUG || !!(globalThis as any).process?.env?.DEBUG;

/** Per-turn timing totals per stage, filled by `timed` and printed once per turn by `flushTimings`. */
const timings = new Map<string, { ms: number; calls: number }>();

function addTiming(stage: string, t0: number) {
  const cur = timings.get(stage) ?? { ms: 0, calls: 0 };
  timings.set(stage, { ms: cur.ms + performance.now() - t0, calls: cur.calls + 1 });
}

/** Runs `fn` and adds its duration (and call count) to the current turn's total for `stage`. */
export async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    addTiming(stage, t0);
  }
}

/** `timed` for synchronous work (ranking the pool). */
export function timedSync<T>(stage: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    addTiming(stage, t0);
  }
}

/** Prints one line with every stage's total for this turn (debug only), then starts the next turn from zero. */
export function flushTimings(): string | undefined {
  const parts = [...timings].map(
    ([stage, t]) => `${stage} ${Math.round(t.ms)}ms (${t.calls} ${t.calls === 1 ? "call" : "calls"})`
  );
  timings.clear();
  if (!parts.length || !isDebug()) return undefined;
  const line = `[timing] ${parts.join(" · ")}`;
  console.log(line);
  return line;
}
