import { defineConfig, loadEnv } from "vite";

// Dev-server proxy: adds API credentials server-side so they never end up in the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // reads .env.local (gitignored)
  return {
    server: {
      proxy: {
        "/tmdb": {
          target: "https://api.themoviedb.org",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/tmdb/, "/3"),
          headers: { Authorization: `Bearer ${env.TMDB_TOKEN}` },
        },
        "/groq": {
          target: "https://api.groq.com",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/groq/, ""),
          headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        },
        "/ollama": {
          target: "http://localhost:11434",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/ollama/, ""),
        },
      },
    },
  };
});
