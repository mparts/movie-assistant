/** Phase 1: the hard facts from the settings form (or a profile file in the typed chat), checked once and then read-only. */
import { settings } from "../config/settings";
import { GENRES } from "./lexicon";

export type Company = "alone" | "relationship" | "family" | "friends";
const COMPANIES: Company[] = ["alone", "relationship", "family", "friends"];

export interface Intake {
  /** `name` absent = Guest (nothing is saved). `platforms`: TMDB watch-provider ids; empty = "I don't stream", no platform filter. */
  profile: { name?: string; age: number; country: string; platforms: number[] };
  /** `youngestAge` is always set after parsing: for alone and relationship it is the user's own age. */
  tonight: { maxMinutes?: number; avoidGenres: string[]; company: Company; youngestAge: number };
}

const isAge = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) < 120;

/** Untrusted JSON → Intake. Throws with the first problem found. */
export function parseIntake(raw: unknown): Intake {
  const fail = (msg: string): never => {
    throw new Error(`Invalid intake: ${msg}`);
  };
  const o = (raw ?? {}) as any;
  const p = o.profile ?? fail("missing profile");
  const t = o.tonight ?? fail("missing tonight");

  const name = p.name === undefined ? undefined : typeof p.name === "string" && p.name.trim() ? p.name.trim() : fail("name");
  const age = isAge(p.age) ? p.age : fail("age");
  const country = typeof p.country === "string" && /^[A-Z]{2}$/.test(p.country) ? p.country : fail("country");
  const platforms = Array.isArray(p.platforms ?? []) && (p.platforms ?? []).every(Number.isInteger)
    ? [...(p.platforms ?? [])] : fail("platforms");

  const company: Company = COMPANIES.includes(t.company) ? t.company : fail("company");
  const maxMinutes = t.maxMinutes === undefined || (Number.isInteger(t.maxMinutes) && t.maxMinutes > 0)
    ? t.maxMinutes : fail("maxMinutes");
  const avoidGenres = Array.isArray(t.avoidGenres ?? []) && (t.avoidGenres ?? []).every((g: unknown) => GENRES.includes(g as string))
    ? [...(t.avoidGenres ?? [])] : fail("avoidGenres");
  // Asked only for family and friends; otherwise the user's own age.
  const shared = company === "family" || company === "friends";
  const youngestAge = shared && t.youngestAge !== undefined ? (isAge(t.youngestAge) ? t.youngestAge : fail("youngestAge")) : age;

  return { profile: { ...(name !== undefined && { name }), age, country, platforms }, tonight: { maxMinutes, avoidGenres, company, youngestAge } };
}

/** Highest US certification allowed for the youngest viewer, or undefined for no limit. */
export function certificationFor(youngestAge: number): string | undefined {
  return settings.intake.certification.find((c) => youngestAge <= c.maxAge)?.cert;
}
