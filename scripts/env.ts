import { readFileSync } from "node:fs";
import type { Env } from "../src/config/services";

/** process.env overlaid with .env.local (KEY=value lines; `#` comments, quotes and inline comments handled). */
export function loadEnv(file = ".env.local"): Env {
  const env: Env = { ...process.env };
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      const quoted = v.match(/^(["'])(.*?)\1/);
      v = quoted ? quoted[2] : v.replace(/\s+#.*$/, "");
      env[m[1]] = v;
    }
  } catch {
    /* no file: fall back to process.env */
  }
  return env;
}
