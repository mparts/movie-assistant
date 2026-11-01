import type { Move } from "../core/types";

/** The LLM writes the wording; this only extracts what to speak. */
export const nlg = (moves: Move[]): string =>
  moves.flatMap((m) => (m.type === "say" ? [m.text] : [])).join(" ");
