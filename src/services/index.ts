/** Builds the three clients from config. The one place that turns config + secrets into live services. */
import { authHeaders, embeddings as embCfg, Env, llmBackends, LlmBackendConfig, services } from "../config/services";
import { settings } from "../config/settings";
import type { LlmClient, TmdbClient } from "../core/types";
import { createEmbedder, type Embedder, type EmbeddingStore } from "./embeddings";
import { createLlm, LlmBackend } from "./llm";
import { createTmdb, type RuntimeStore } from "./tmdb";

export interface Clients {
  tmdb: TmdbClient;
  llm: LlmClient;
  embedder?: Embedder;
}

/** One configured LLM backend → URL, model and headers. Used by `createClients`, and by the bench for disabled backends. */
export function resolveBackend(b: LlmBackendConfig, where: "upstream" | "proxy", env: Env = {}): LlmBackend {
  return {
    name: b.name,
    baseUrl: services[b.service][where],
    model: b.model,
    timeoutMs: b.timeoutMs,
    headers: where === "upstream" ? authHeaders(services[b.service], env) : undefined,
    extraBody: b.extraBody,
  };
}

/**
 * `where: "upstream"` → real URLs + auth headers (Node scripts).
 * `where: "proxy"`    → Vite proxy prefixes, no secrets (browser).
 *
 * `extras.embeddingStore` / `extras.runtimeStore` make description vectors / movie runtimes survive restarts
 * (Node scripts pass file stores; the browser passes nothing and keeps them in memory).
 */
export function createClients(
  where: "upstream" | "proxy",
  env: Env = {},
  extras: { embeddingStore?: EmbeddingStore; runtimeStore?: RuntimeStore } = {}
): Clients {
  const url = (s: keyof typeof services) => services[s][where];
  const headers = (s: keyof typeof services) => (where === "upstream" ? authHeaders(services[s], env) : undefined);
  const backends = llmBackends.filter((b) => b.enabled !== false).map((b) => resolveBackend(b, where, env));

  const tmdb = createTmdb({
    baseUrl: url("tmdb"),
    headers: headers("tmdb"),
    ...settings.search,
    store: extras.runtimeStore,
  });

  const embedder = embCfg.enabled
    ? createEmbedder({
        url: url(embCfg.service) + embCfg.path,
        model: embCfg.model,
        queryPrefix: embCfg.queryPrefix,
        documentPrefix: embCfg.documentPrefix,
        batchSize: embCfg.batchSize,
        timeoutMs: embCfg.timeoutMs,
        store: extras.embeddingStore,
      })
    : undefined;

  return { tmdb, llm: createLlm(backends), embedder };
}
