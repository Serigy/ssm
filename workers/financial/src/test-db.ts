import { PGlite } from '@electric-sql/pglite';
import { databaseOver, pgTypeParser, type Database } from '@ssm/worker-common';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Postgres em memória para os testes do hr, com as migrações de verdade.
 *
 * Os conversores de tipo são os mesmos do driver de produção (`pgTypeParser`):
 * sem isso o PGlite devolveria `Date` e `bigint`, e o teste passaria sobre
 * dados com forma diferente da que o Worker recebe do Neon.
 */
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../migrations/postgres/financial');

const OIDS = [1184, 20, 1082];

export interface TestDb {
  db: Database;
  pg: PGlite;
  close(): Promise<void>;
}

export async function openTestDb(): Promise<TestDb> {
  const parsers = Object.fromEntries(
    OIDS.map((oid) => [oid, (v: string) => pgTypeParser(oid, 'text', () => (x: string) => x)(v)]),
  );
  const pg = new PGlite({ parsers });
  // Mesmo `search_path` que o papel ssm_hr tem em produção: o SQL do Worker não
  // qualifica as tabelas.
  for (const f of readdirSync(migrations).filter((n) => n.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(migrations, f), 'utf8'));
  }
  await pg.exec('SET search_path = financial');

  const db = databaseOver({
    query: async (text, values) => {
      const r = await pg.query(text, values as unknown[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return { db, pg, close: () => pg.close() };
}
