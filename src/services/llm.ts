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

/** Tries the backends in order (`opts.prefer` goes first); the first that answers wins. */
export function createLlm(backends: LlmBackend[]): LlmClient {
  return {
    async json(messages, opts) {
      const ordered = opts?.prefer
        ? [...backends].sort((a, b) => Number(b.name === opts.prefer) - Number(a.name === opts.prefer))
        : backends;
      let lastError: unknown;
      for (const b of ordered) {
        try {
          return await call(b, messages, opts);
        } catch (e) {
          console.warn(`[LLM ${b.name} failed]`, e);
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
        temperature: opts?.temperature ?? 0,
        max_completion_tokens: opts?.maxTokens ?? 800,
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
