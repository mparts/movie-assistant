import { settings } from "../config/settings";
import type { ChatMessage, LlmClient, LlmOptions } from "../core/types";

/** One OpenAI-compatible chat endpoint (Groq, Ollama, ...), fully resolved: URL and headers included. */
export interface LlmBackend {
  name: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

/** The preferred names first, in the order given; everything else after them in its original order. */
export function orderByPreference<T extends { name: string }>(list: T[], prefer?: string | string[]): T[] {
  const names = prefer === undefined ? [] : [prefer].flat();
  const rank = (b: T) => (names.includes(b.name) ? names.indexOf(b.name) : names.length);
  return [...list].sort((a, b) => rank(a) - rank(b)); // the sort is stable
}

/** Reported after every successful call: who answered, how long it took, and which backends failed first. */
export interface LlmAnswer {
  purpose?: string;
  backend: string;
  model: string;
  ms: number;
  failed: string[];
}

/** Tries the backends in order (`opts.prefer` goes first); the first that answers wins. */
export function createLlm(backends: LlmBackend[], onAnswer?: (a: LlmAnswer) => void): LlmClient {
  return {
    async json(messages, opts) {
      const ordered = orderByPreference(backends, opts?.prefer);
      const failed: string[] = [];
      const t0 = performance.now();
      let lastError: unknown;
      for (const b of ordered) {
        try {
          const out = await call(b, messages, opts);
          onAnswer?.({ purpose: opts?.purpose, backend: b.name, model: b.model, ms: performance.now() - t0, failed });
          return out;
        } catch (e) {
          console.warn(`[LLM ${b.name} failed]`, e);
          failed.push(b.name);
          lastError = e;
        }
      }
      throw lastError ?? new Error("No LLM backend configured");
    },
  };
}

async function call(b: LlmBackend, messages: ChatMessage[], opts?: LlmOptions): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), b.timeoutMs);
  try {
    const res = await fetch(`${b.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...b.headers },
      body: JSON.stringify({
        model: b.model,
        messages,
        temperature: opts?.temperature ?? settings.llm.defaults.temperature,
        max_completion_tokens: opts?.maxTokens ?? settings.llm.defaults.maxTokens,
        response_format: { type: "json_object" },
        ...b.extraBody,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${b.name} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const content: unknown = (await res.json()).choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${b.name}: empty completion`);
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } finally {
    clearTimeout(timer);
  }
}
