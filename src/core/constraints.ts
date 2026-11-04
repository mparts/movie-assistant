/**
 * Pure state updates for the user's filters on tonight's pool: constrain (set) and retract (drop).
 * Runtime is not here: the time limit belongs to tonight's settings (the rules turn a runtime request into a notice).
 */
import { languageCode } from "./lexicon";
import { InformationState as IS, MoveOf } from "./types";

export function constrain(is: IS, m: MoveOf<"constrain">): IS {
  const c = is.constraints;
  const withC = (patch: Partial<IS["constraints"]>): IS => ({ ...is, constraints: { ...c, ...patch } });
  switch (m.slot) {
    case "year": {
      const n = Number(m.value);
      if (isNaN(n)) return is;
      const { min, max } = c.year;
      // A new bound beyond the opposite one replaces it: "recent, not the 90s" must not leave the empty range 2000 to 1999.
      if (m.op === "lte") return withC({ year: { min: min !== undefined && min > n ? undefined : min, max: n } });
      if (m.op === "gte") return withC({ year: { min: n, max: max !== undefined && max < n ? undefined : max } });
      return withC({ year: { min: n, max: n } });
    }
    case "language": {
      const code = languageCode(String(m.value));
      return code ? withC({ language: code }) : is;
    }
    default:
      return is;
  }
}

export function retract(is: IS, slot: string): IS {
  const c = is.constraints;
  switch (slot) {
    case "year": return { ...is, constraints: { ...c, year: {} } };
    case "language": return { ...is, constraints: { ...c, language: undefined } };
    case "wish": return { ...is, wish: "" };
    case "genres": return { ...is, genres: [] };
    case "avoidGenres": return { ...is, avoidGenres: [] };
    case "avoid": return { ...is, avoid: [] };
    case "people": return { ...is, people: [] };
    default: return is;
  }
}
