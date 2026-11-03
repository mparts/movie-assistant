import { describe, expect, test } from "vitest";
import { llmBackends, services } from "../src/config/services";
import { settings } from "../src/config/settings";
import { orderByPreference } from "../src/services/llm";

describe("service config", () => {
  test("no proxy prefix starts with another one (the Vite proxy would pick the wrong target)", () => {
    const prefixes = Object.values(services).map((s) => s.proxy);
    for (const a of prefixes) for (const b of prefixes) if (a !== b) expect(a.startsWith(b)).toBe(false);
  });


  test("NLU tries the local model, then the university one, and Groq last; NLG starts with Groq", () => {
    const on = llmBackends.filter((b) => b.enabled !== false);
    const names = (prefer?: string | string[]) => orderByPreference(on, prefer).map((b) => b.name);
    expect(names(settings.llm.understand.prefer)).toEqual(["local", "ollama", "groq"]);
    expect(names(settings.llm.respond.prefer)).toEqual(["groq", "ollama", "local"]);
  });



});
