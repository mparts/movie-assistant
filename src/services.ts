import { createLlm, Backend } from "./llm";
import { createTmdb } from "./tmdb";

/**
 * Browser wiring. Keys never reach the browser: the Vite dev server (vite.config.ts)
 * proxies /tmdb and /groq and adds the Authorization headers from .env.local.
 */
export const tmdb = createTmdb({ baseUrl: "/tmdb" });

const backends: Backend[] = [
  {
    name: "groq",
    baseUrl: "/groq/openai/v1",
    model: import.meta.env.VITE_GROQ_MODEL ?? "openai/gpt-oss-120b",
  },
];
// Optional failsafe: set VITE_OLLAMA_MODEL=<model> in .env.local (needs Ollama on localhost:11434).
if (import.meta.env.VITE_OLLAMA_MODEL) {
  backends.push({
    name: "ollama",
    baseUrl: "/ollama/v1",
    model: import.meta.env.VITE_OLLAMA_MODEL,
    timeoutMs: 30000,
  });
}

export const llm = createLlm(backends);
