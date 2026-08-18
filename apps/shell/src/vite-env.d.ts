/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_REMOTE_FINANCIAL?: string;
  readonly VITE_REMOTE_HR?: string;
  readonly VITE_REMOTE_LEGAL?: string;
  readonly VITE_REMOTE_OPERATIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The federated remotes are declared in remotes.d.ts.
