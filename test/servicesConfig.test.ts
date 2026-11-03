import { describe, expect, test } from "vitest";
import { llmBackends, services } from "../src/config/services";
import { resolveBackend } from "../src/services";

describe("service config", () => {
  test("no proxy prefix starts with another one (the Vite proxy would pick the wrong target)", () => {
    const prefixes = Object.values(services).map((s) => s.proxy);
    for (const a of prefixes) for (const b of prefixes) if (a !== b) expect(a.startsWith(b)).toBe(false);
  });

  test("the local LLM backend speaks the OpenAI-compatible API on this machine and is off in production", () => {
    const local = llmBackends.find((b) => b.name === "local")!;
    expect(local.enabled).toBe(false);
    const r = resolveBackend(local, "upstream");
    expect(r.baseUrl).toBe("http://localhost:11434/v1");
    expect(r.model).toBe(local.model);
    expect(r.headers).toBeUndefined(); // open server: no key
  });

  test("the browser gets the proxy prefix instead of the real URL", () => {
    expect(resolveBackend(llmBackends.find((b) => b.name === "local")!, "proxy").baseUrl).toBe("/local-llm");
  });

  test("every llmBackends service exists, and backend names are unique", () => {
    for (const b of llmBackends) expect(services[b.service]).toBeDefined();
    expect(new Set(llmBackends.map((b) => b.name)).size).toBe(llmBackends.length);
  });
});
