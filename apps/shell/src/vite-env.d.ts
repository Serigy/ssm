/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_REMOTE_FINANCIAL?: string;
  readonly VITE_REMOTE_HR?: string;
  readonly VITE_REMOTE_LEGAL?: string;
  readonly VITE_REMOTE_OPERATIONS?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The federated remotes are declared in remotes.d.ts.
