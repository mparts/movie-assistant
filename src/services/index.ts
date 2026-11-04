/** Builds the clients from config. The one place that turns config + secrets into live services. */
import { authHeaders, embeddings as embCfg, Env, llmBackends, LlmBackendConfig, services } from "../config/services";
import { settings } from "../config/settings";
import type { EmbedQuery, LlmClient, TmdbClient } from "../core/types";
import { createEmbedQuery } from "./embeddings";
import { createLlm, LlmBackend, type LlmAnswer } from "./llm";
import { createTmdb } from "./tmdb";

interface Clients {
  tmdb: TmdbClient;
  llm: LlmClient;
  embedQuery: EmbedQuery;
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
 * `extras.onLlmAnswer` is told which LLM backend answered each call.
 */
export function createClients(
  where: "upstream" | "proxy",
  env: Env = {},
  extras: { onLlmAnswer?: (a: LlmAnswer) => void } = {}
): Clients {
  const url = (s: keyof typeof services) => services[s][where];
  const headers = (s: keyof typeof services) => (where === "upstream" ? authHeaders(services[s], env) : undefined);
  const backends = llmBackends.filter((b) => b.enabled !== false).map((b) => resolveBackend(b, where, env));
  return {
    tmdb: createTmdb({ baseUrl: url("tmdb"), headers: headers("tmdb"), ...settings.search }),
    llm: createLlm(backends, extras.onLlmAnswer),
    embedQuery: createEmbedQuery({
      url: url(embCfg.service) + embCfg.path,
      model: embCfg.model,
      queryPrefix: embCfg.queryPrefix,
      timeoutMs: embCfg.timeoutMs,
    }),
  };
}
