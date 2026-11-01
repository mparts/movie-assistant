import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
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
        // LOCAL Ollama: embeddings (/ollama/api/embed)
        "/ollama": {
          target: "http://localhost:11434",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/ollama/, ""),
        },
        // TUNNELLED university Ollama: the LLM (/ollama-llm/v1/...). Tunnel: ssh -f -N -L 11435:127.0.0.1:11434 mltgpu-2
        "/ollama-llm": {
          target: "http://localhost:11435",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/ollama-llm/, ""),
        },
      },
    },
  };
});