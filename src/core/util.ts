export const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];
export const addUnique = (xs: string[], ys: string[]) => [...xs, ...ys.filter((y) => !xs.includes(y))];
export const without = (xs: string[], ys: string[]) => xs.filter((x) => !ys.includes(x));
export const sameIds = <T extends { id: number }>(a: T[], b: T[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i].id);

/** Dump the full information state when `DEBUG=1` (node) or `globalThis.DME_DEBUG = true` (browser). */
export const isDebug = () => !!(globalThis as any).DME_DEBUG || !!(globalThis as any).process?.env?.DEBUG;
