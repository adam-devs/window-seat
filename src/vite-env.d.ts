/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Proxy path prefix used for OpenSky requests. Defaults to `/opensky`. */
  readonly VITE_OPENSKY_PROXY_URL?: string;
  /** Default auto-refresh interval in ms, clamped to 15 s–5 min. */
  readonly VITE_DEFAULT_REFRESH_MS?: string;
  /** Serve deterministic mock aircraft for local failure testing. */
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
