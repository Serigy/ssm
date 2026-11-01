import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O miolo do aplicador de migrações, sem E/S de ambiente.
 *
 * Separado de apply.mjs para o teste rodar exatamente este código contra um
 * Postgres em memória: o que o CI aplica no Neon e o que o teste aplica no
 * PGlite é a mesma função.
 *
 * Recebe qualquer coisa com `query(text, params)` — `pg.Client` ou PGlite.
 */

const NAME = /^[a-z][a-z0-9_]*$/;

/** Os módulos que têm migração Postgres: uma pasta por módulo, com o nome do schema. */
export function listModules(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function listMigrations(root, module) {
  return readdirSync(join(root, module))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(root, module, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Aplica as migrações pendentes de um módulo, na ordem, uma transação por
 * arquivo. Devolve os nomes aplicados agora (vazio numa segunda execução).
 *
 * - O registro fica em `<schema>.schema_migrations`, na mesma transação do
 *   arquivo: ou o arquivo e a linha existem, ou nenhum dos dois.
 * - O checksum é conferido: editar uma migração já aplicada é erro, não ação
 *   silenciosa. Mudança de esquema é um arquivo novo.
 * - Um lock consultivo por schema serializa execuções concorrentes (dois
 *   pipelines ao mesmo tempo); quem chega depois reconfere o registro.
 */
export async function applyModule(conn, module, root) {
  if (!NAME.test(module)) throw new Error(`Nome de módulo inválido: ${module}`);

  // O nome do schema vem do nome da pasta e já foi validado acima; identificador
  // não aceita parâmetro, então a validação é o que sustenta a interpolação.
  await conn.query(`CREATE SCHEMA IF NOT EXISTS ${module}`);
  await conn.query(
    `CREATE TABLE IF NOT EXISTS ${module}.schema_migrations (
       name        text PRIMARY KEY,
       checksum    text NOT NULL,
       applied_at  timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const applied = [];
  for (const m of listMigrations(root, module)) {
    await conn.query('BEGIN');
    try {
      await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ssm-migrate:${module}`]);
      const { rows } = await conn.query(
        `SELECT checksum FROM ${module}.schema_migrations WHERE name = $1`,
        [m.name],
      );
      if (rows.length) {
        if (rows[0].checksum !== m.checksum) {
          throw new Error(
            `${module}/${m.name} já foi aplicada e o arquivo mudou. ` +
              'Migração aplicada não se edita: crie um arquivo novo.',
          );
        }
        await conn.query('COMMIT');
        continue;
      }
      await conn.query(m.sql);
      await conn.query(
        `INSERT INTO ${module}.schema_migrations (name, checksum) VALUES ($1, $2)`,
        [m.name, m.checksum],
      );
      await conn.query('COMMIT');
      applied.push(m.name);
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
  return applied;
}
