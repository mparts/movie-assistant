/** Builds the three clients from config. The one place that turns config + secrets into live services. */
import { authHeaders, embeddings as embCfg, Env, llmBackends, services } from "../config/services";
import { settings } from "../config/settings";
import type { LlmClient, TmdbClient } from "../core/types";
import { createEmbedder, type Embedder, type EmbeddingStore } from "./embeddings";
import { createLlm, LlmBackend } from "./llm";
import { createTmdb } from "./tmdb";

export interface Clients {
  tmdb: TmdbClient;
  llm: LlmClient;
  embedder?: Embedder;
}

/**
 * `where: "upstream"` → real URLs + auth headers (Node scripts).
 * `where: "proxy"`    → Vite proxy prefixes, no secrets (browser).
 *
 * `extras.embeddingStore` makes description vectors survive restarts (Node scripts pass a file store).
 */
export function createClients(
  where: "upstream" | "proxy",
  env: Env = {},
  extras: { embeddingStore?: EmbeddingStore } = {}
): Clients {
  const url = (s: keyof typeof services) => services[s][where];
  const headers = (s: keyof typeof services) => (where === "upstream" ? authHeaders(services[s], env) : undefined);

  const tmdb = createTmdb({
    baseUrl: url("tmdb"),
    headers: headers("tmdb"),
    ...settings.search,
  });

  const backends: LlmBackend[] = llmBackends
    .filter((b) => b.enabled !== false)
    .map((b) => ({
      name: b.name,
      baseUrl: url(b.service),
      model: b.model,
      timeoutMs: b.timeoutMs,
      headers: headers(b.service),
      extraBody: b.extraBody,
    }));

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
