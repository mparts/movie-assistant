/**
 * Everything about OUTSIDE services lives here: URLs, models, timeouts, and the NAMES of the secrets.
 * The secrets themselves live only in .env.local (see .env.example).
 *
 * Every HTTP service has an `upstream` (the real URL, used directly by Node scripts) and a `proxy`
 * prefix (used by the browser: the Vite dev server forwards it to `upstream` and adds the secret,
 * so keys never reach the browser). No proxy prefix may start with another one.
 */
export interface HttpService {
  upstream: string;
  proxy: string;
  /** Name of the .env.local variable holding the bearer token; omit for open servers. */
  secret?: string;
}

export const services = {
  tmdb: { upstream: "https://api.themoviedb.org/3", proxy: "/tmdb", secret: "TMDB_TOKEN" },
  groq: { upstream: "https://api.groq.com/openai/v1", proxy: "/groq", secret: "GROQ_API_KEY" },
  /** University Ollama through an SSH tunnel:  ssh -f -N -L 11435:127.0.0.1:11434 mltgpu-2 */
  universityOllama: { upstream: "http://localhost:11435/v1", proxy: "/uni-ollama" },
  /** Ollama running on this machine: native API (used for embeddings). */
  localOllama: { upstream: "http://localhost:11434/api", proxy: "/local-ollama" },
  /** The same Ollama through its OpenAI-compatible API, which is what the chat client speaks. */
  localLlm: { upstream: "http://localhost:11434/v1", proxy: "/local-llm" },
} satisfies Record<string, HttpService>;

export type ServiceName = keyof typeof services;

export interface LlmBackendConfig {
  name: string;
  service: ServiceName;
  model: string;
  timeoutMs: number;
  /** Extra fields merged into every request body. */
  extraBody?: Record<string, unknown>;
  enabled?: boolean;
}

/** In fallback order: the first enabled backend answers; the next ones are tried if it fails. */
export const llmBackends: LlmBackendConfig[] = [
  {
    name: "groq",
    service: "groq",
    model: "openai/gpt-oss-120b",
    timeoutMs: 20_000,
    extraBody: { reasoning_effort: "low" }, // gpt-oss "thinks" first; keep it short, this is a spoken conversation
  },
  { name: "ollama", service: "universityOllama", model: "llama3.1:latest", timeoutMs: 60_000 },
  /**
   * Model on this machine, the last resort for every call. Of the models tried, qwen2.5:7b-instruct was the most
   * accurate for NLU (14/15 on `npm run nlu-bench`); it runs about a quarter on CPU on the 6 GB GPU (~0.7 s per NLU call).
   * Replies from it are weaker than Groq's. Set `enabled: false` to drop it (the bench can still use it by name).
   */
  { name: "local", service: "localLlm", model: "qwen2.5:7b-instruct", timeoutMs: 60_000 },
];

/** Semantic ranking of candidates. Set `enabled: false` to rank without embeddings. */
export const embeddings = {
  enabled: true,
  service: "localOllama" as ServiceName,
  path: "/embed",
  model: "nomic-embed-text",
  /** nomic-embed-text is trained with these task prefixes; other models usually need none. */
  queryPrefix: "search_query: ",
  documentPrefix: "search_document: ",
  batchSize: 64,
  timeoutMs: 20_000,
};

/** Azure speech (browser only). The key is VITE_AZURE_KEY in .env.local. */
export const azure = {
  region: "germanywestcentral",
  tokenEndpoint: "https://germanywestcentral.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
};

/* ------------------------------------------------------------------ */

export type Env = Record<string, string | undefined>;

/** Authorization header for a service, or undefined for open servers. Throws if its secret is missing. */
export function authHeaders(service: HttpService, env: Env): Record<string, string> | undefined {
  if (!service.secret) return undefined;
  const token = env[service.secret];
  if (!token) throw new Error(`Missing ${service.secret}: add it to .env.local (see .env.example)`);
  return { Authorization: `Bearer ${token}` };
}
