#!/usr/bin/env node
// Aplica as migrações Postgres (Neon) de cada módulo.
//
//   NEON_MIGRATION_URL=... node workers/migrations/postgres/apply.mjs          # CI
//   node workers/migrations/postgres/apply.mjs --url-file secrets/local/neon_development_url
//   node workers/migrations/postgres/apply.mjs --url-file ... identity         # só um módulo
//
// A URL é a do dono do banco (precisa de DDL) e, de preferência, a do endpoint
// direto, sem `-pooler`: o pooler do Neon é PgBouncer em modo de transação e
// DDL com lock consultivo é mais previsível numa conexão de verdade.
//
// Idempotente: o que já foi aplicado é pulado. Nunca imprime a URL nem a senha.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readUrl, redact, withClient } from './connection.mjs';
import { applyModule, listModules } from './runner.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

let url;
try {
  url = readUrl({ envName: 'NEON_MIGRATION_URL', argv });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

// Argumento posicional é módulo; o valor de uma opção (`--url-file x`) não é.
const wanted = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const all = listModules(root);
const modules = wanted.length ? wanted : all;
for (const m of modules) {
  if (!all.includes(m)) {
    console.error(`Módulo sem migração Postgres: ${m}. Existem: ${all.join(', ')}`);
    process.exit(2);
  }
}

try {
  await withClient(url, async (client) => {
    for (const m of modules) {
      const applied = await applyModule(client, m, root);
      console.log(
        applied.length
          ? `${m}: aplicadas ${applied.join(', ')}`
          : `${m}: nada a aplicar`,
      );
    }
  });
} catch (err) {
  console.error('Falha ao migrar:', redact(err instanceof Error ? err.message : err, url));
  process.exit(1);
}
