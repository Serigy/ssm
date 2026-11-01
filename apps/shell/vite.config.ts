import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Host configuration.
 *
 * `remotes` point at the *deployed* entry of each module. In development each
 * remote runs on its own port; in the cluster the Ingress serves each one under
 * its path prefix, so the shell's build is identical in both — only the URLs
 * differ, and they come from the environment.
 */
const remoteUrl = (name: string, devPort: number): string =>
  process.env[`VITE_REMOTE_${name.toUpperCase()}`] ??
  `http://localhost:${devPort}/remoteEntry.js`;

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'shell',
      // Federated type sharing is off. It publishes an @mf-types.zip from each
      // remote for the host to download, and every dev boot logs three failures
      // while it tries. The remotes are typed statically in
      // apps/shell/src/remote-modules.d.ts instead, which is checked by tsc
      // rather than fetched over HTTP at dev time.
      dts: false,
      remotes: {
        financial: { type: 'module', name: 'financial', entry: remoteUrl('financial', 4201) },
        hr: { type: 'module', name: 'hr', entry: remoteUrl('hr', 4202) },
        legal: { type: 'module', name: 'legal', entry: remoteUrl('legal', 4203) },
        operations: { type: 'module', name: 'operations', entry: remoteUrl('operations', 4204) },
      },
      /**
       * Singletons, all of them. Two copies of React in one page produce the
       * "invalid hook call" error; two copies of the router produce two history
       * stacks and a back button that skips screens. `requiredVersion` makes a
       * mismatch a build-time failure rather than a runtime mystery.
       */
      shared: {
        react: { singleton: true, requiredVersion: '^19.1.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
        'react-router-dom': { singleton: true, requiredVersion: '^7.5.2' },
        // The @ssm/* workspace libraries are deliberately NOT listed here.
        //
        // They are symlinked to their TypeScript source, so each dev server
        // serves its own copy over /@fs/ and the share scope never sees them.
        // Declaring `singleton: true` on a package that cannot be shared does
        // not make it one — it only makes the duplicate-module failure look
        // like a federation bug instead of what it is.
        //
        // Anything that must be one instance across the boundary is passed
        // explicitly instead: host services go to the module Root as props.
        // React and the router below are real npm packages and DO share.
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
    port: 4200,
    strictPort: true,
    /**
     * O navegador fala com o Vite, que reencaminha /api para os Workers.
     *
     * Na pilha em contêiner havia um destino só, o gateway, que sabia rotear.
     * Na Cloudflare não há gateway proxy: cada Worker declara em wrangler.jsonc
     * a rota que atende, e a borda entrega direto. Em produção o navegador vai
     * para `ssm.serigy.net` e a Cloudflare resolve; aqui o Vite reproduz esse
     * roteamento, para o front-end ver a mesma origem única dos dois lados e os
     * cookies se comportarem igual.
     *
     * A ordem importa: `/api/v1` (o status agregado) precisa vir antes da regra
     * genérica, senão ele seria capturado por ela.
     *
     * Com `SSM_API_GATEWAY` definido (`make web-docker`), tudo vai para o gateway
     * da pilha em contêiner, mantendo a mesma origem única.
     */
    proxy: process.env.SSM_API_GATEWAY
      ? { '/api': { target: process.env.SSM_API_GATEWAY, changeOrigin: true } }
      : {
          '/api/identity': { target: 'http://localhost:8801', changeOrigin: true },
          '/api/financial': { target: 'http://localhost:8802', changeOrigin: true },
          '/api/hr': { target: 'http://localhost:8803', changeOrigin: true },
          '/api/legal': { target: 'http://localhost:8804', changeOrigin: true },
          '/api/operations': { target: 'http://localhost:8805', changeOrigin: true },
          '/api/v1': { target: 'http://localhost:8800', changeOrigin: true },
        },
  },
  build: {
    target: 'esnext',
    // Module Federation requires the shared chunks to stay addressable.
    modulePreload: false,
    cssCodeSplit: false,
    sourcemap: true,
  },
});
