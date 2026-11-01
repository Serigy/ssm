import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshAll, refuses, root } from './helpers.mjs';
import { listModules } from '../postgres/runner.mjs';

/**
 * Isolamento entre módulos, para TODO par de papéis.
 *
 * Num banco só, o que impedia um Worker de ler a folha de pagamento do outro
 * era existirem bancos separados; agora é permissão (ADR 0014). Este teste
 * percorre os schemas que as migrações realmente criaram — um módulo novo entra
 * no teste sozinho, e esquecer o GRANT ou concedê-lo demais o derruba.
 */
const modules = listModules(root);

describe('isolamento entre papéis', () => {
  test('há mais de um módulo para isolar', () => {
    assert.ok(modules.length >= 2, modules.join(','));
  });

  for (const me of modules) {
    test(`ssm_${me}: lê e escreve só no próprio schema`, async () => {
      const db = await freshAll();
      const tables = (
        await db.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = '${me}' AND table_name <> 'schema_migrations'`,
        )
      ).rows.map((r) => r.table_name);
      assert.ok(tables.length > 0, 'o módulo tem tabelas');

      await db.exec(`SET ROLE ssm_${me}`);
      for (const t of tables) {
        await db.query(`SELECT 1 FROM ${me}.${t} LIMIT 1`); // não lança
      }
      await refuses(db, `SELECT 1 FROM ${me}.schema_migrations`, [], 'ler o registro de migrações');
      await refuses(db, `DELETE FROM ${me}.schema_migrations`, [], 'apagar o registro de migrações');
      await refuses(db, `CREATE TABLE ${me}.intruso (a int)`, [], 'criar tabela no próprio schema');
      await refuses(db, `CREATE TABLE public.intruso (a int)`, [], 'criar tabela em public');
    });

    for (const other of modules.filter((m) => m !== me)) {
      test(`ssm_${me} é recusado em todas as tabelas de ${other}`, async () => {
        const db = await freshAll();
        const tables = (
          await db.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = '${other}'`,
          )
        ).rows.map((r) => r.table_name);
        assert.ok(tables.length > 0);

        await db.exec(`SET ROLE ssm_${me}`);
        for (const t of tables) {
          await refuses(db, `SELECT 1 FROM ${other}.${t} LIMIT 1`, [], `ler ${other}.${t}`);
          await refuses(db, `DELETE FROM ${other}.${t}`, [], `apagar de ${other}.${t}`);
        }
      });
    }
  }

  test('nenhum papel de módulo é superusuário nem pode criar papéis ou bancos', async () => {
    const db = await freshAll();
    const { rows } = await db.query(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'ssm\\_%'
          AND (rolsuper OR rolcreaterole OR rolcreatedb)`,
    );
    assert.deepEqual(rows, []);
  });
});
