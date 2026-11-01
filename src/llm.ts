import { ChatMessage, LlmClient } from "./types";

/** Any OpenAI-compatible chat endpoint (Groq, Ollama, ...). */
export interface Backend {
  name: string;
  baseUrl: string; // e.g. "/groq/openai/v1" (browser, via the Vite proxy) or "https://api.groq.com/openai/v1" (node)
  model: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Tries the backends in order; the first that answers wins. */
export function createLlm(backends: Backend[]): LlmClient {
  return {
    async json(messages, opts) {
      let lastError: unknown;
      // `prefer` moves one backend (by name) to the front for this call; the others keep their order as fallbacks.
      const ordered = opts?.prefer
        ? [...backends].sort((a, b) => Number(b.name === opts.prefer) - Number(a.name === opts.prefer))
        : backends;
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

async function call(
  b: Backend,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), b.timeoutMs ?? 10000);
  try {
    const body: Record<string, unknown> = {
      model: b.model,
      messages,
      temperature: opts?.temperature ?? 0,
      max_completion_tokens: opts?.maxTokens ?? 800,
      response_format: { type: "json_object" },
    };
    // gpt-oss models "think" before answering; keep it short, this is a spoken conversation.
    if (/gpt-oss/.test(b.model)) body.reasoning_effort = "low";

    const res = await fetch(`${b.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...b.headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${b.name} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const content: unknown = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${b.name}: empty completion`);
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } finally {
    clearTimeout(timer);
  }
}