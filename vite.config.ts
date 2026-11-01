import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { authHeaders, services } from "./src/config/services";

/**
 * Dev-server proxy, generated from src/config/services.ts: the browser calls `proxy` prefixes,
 * this forwards them to each `upstream` and adds the secret, so keys never reach the browser.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy: Record<string, ProxyOptions> = {};
  for (const [name, s] of Object.entries(services)) {
    const url = new URL(s.upstream);
    let headers: Record<string, string> | undefined;
    try {
      headers = authHeaders(s, env);
    } catch (e) {
      console.warn(`[proxy ${name}] ${(e as Error).message}`);
    }
    proxy[s.proxy] = {
      target: url.origin,
      changeOrigin: true,
      rewrite: (p) => p.replace(new RegExp(`^${s.proxy}`), url.pathname.replace(/\/$/, "")),
      headers,
    };
  }
  return { server: { proxy } };
});
