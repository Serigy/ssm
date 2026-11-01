import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyModule, listModules } from '../postgres/runner.mjs';

/** Pasta das migrações Postgres, de onde os testes aplicam o que o CI aplica. */
export const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'postgres');

/**
 * PGlite com a interface do `pg.Client`. Sem parâmetros o `pg` usa o protocolo
 * simples, que aceita um arquivo de migração inteiro; o `query` do PGlite usa
 * o estendido, que não aceita.
 */
export function pglite() {
  const raw = new PGlite();
  return {
    exec: (sql) => raw.exec(sql),
    async query(text, params) {
      if (params === undefined) return (await raw.exec(text)).at(-1) ?? { rows: [] };
      return raw.query(text, params);
    },
  };
}

/**
 * Banco novo com todos os módulos migrados e os papéis criados ANTES, como
 * roles.mjs garante em produção — assim os GRANTs das migrações são exercitados.
 */
export async function freshAll(modules = listModules(root)) {
  const db = pglite();
  for (const m of modules) await db.exec(`CREATE ROLE ssm_${m} LOGIN;`);
  for (const m of modules) await applyModule(db, m, root);
  return db;
}

export const refuses = (db, sql, params, what) =>
  assert.rejects(() => db.query(sql, params), undefined, `o banco deveria recusar: ${what}`);

/** Entra como o papel do módulo, com o search_path que o login real teria. */
export const asRole = (db, module) =>
  db.exec(`SET ROLE ssm_${module}; SET search_path = ${module}`);
