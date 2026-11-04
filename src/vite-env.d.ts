/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Azure speech key (the only secret the browser must hold, because speechstate talks to Azure directly). */
  readonly VITE_AZURE_KEY: string;
}
