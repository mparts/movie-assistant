import { createLlm, Backend } from "./llm";
import { createTmdb } from "./tmdb";
import { createOllamaEmbedder } from "./embeddings";

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
    baseUrl: "/ollama-llm/v1", // Vite proxy → the tunnelled university server (see vite.config.ts)
    model: import.meta.env.VITE_OLLAMA_MODEL,
    timeoutMs: 30000,
  });
}

// VITE_LLM_PRIMARY=ollama puts Ollama first (Groq becomes the fallback).
if (import.meta.env.VITE_LLM_PRIMARY === "ollama") backends.reverse();

export const llm = createLlm(backends);

/** Optional: Vite must proxy /ollama/api/embed to Ollama. */
export const embedder = import.meta.env.VITE_OLLAMA_EMBED_MODEL
  ? createOllamaEmbedder({ url: "/ollama/api/embed", model: import.meta.env.VITE_OLLAMA_EMBED_MODEL })
  : undefined;