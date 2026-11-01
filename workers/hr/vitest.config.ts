import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // O PGlite leva alguns segundos para subir, e o nx roda os projetos em
    // paralelo: com o limite padrão de 5 s o teste falhava por máquina cheia.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
