import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Remote configuration for the legal module.
 *
 * Exposes exactly one entry — `./Module` — which default-exports an
 * SsmModuleDefinition. The shell imports that and nothing else, so this
 * module's internals can be restructured freely without touching the host.
 *
 * `base` matters: the built chunks are served from /legal/ behind the Ingress,
 * and remoteEntry.js resolves its siblings relative to it. Get this wrong and
 * the module loads in development and 404s in the cluster.
 */
export default defineConfig({
  base: process.env.VITE_PUBLIC_PATH ?? '/',
  plugins: [
    react(),
    federation({
      name: 'legal',
      filename: 'remoteEntry.js',
      exposes: {
        './Module': './src/module.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.1.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
        'react-router-dom': { singleton: true, requiredVersion: '^7.5.2' },
        '@ssm/ui-kit': { singleton: true },
        '@ssm/mfe-runtime': { singleton: true },
        '@ssm/contracts': { singleton: true },
      },
    }),
  ],
  // No `resolve.alias` for the @ssm/* libraries.
  //
  // pnpm already symlinks every workspace package into node_modules, and their
  // package.json points `main` at the TypeScript source, so Vite resolves and
  // transforms them without help. Aliasing them here did two harmful things:
  //
  //   1. a string alias is a prefix rewrite, so '@ssm/ui-kit/styles.css'
  //      became '<...>/src/index.ts/styles.css';
  //   2. Module Federation warns — correctly — that an aliased module bypasses
  //      the sharing mechanism entirely, so the singleton guarantee below
  //      would have been silently void.
  server: {
    port: 4203,
    strictPort: true,
    // The shell fetches remoteEntry.js cross-origin during development.
    cors: true,
    proxy: {
      '/api': { target: process.env.VITE_API_URL ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { target: 'esnext', modulePreload: false, cssCodeSplit: false, sourcemap: true },
});
