import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyModule, listModules } from '../postgres/runner.mjs';
import { redact } from '../postgres/connection.mjs';

/**
 * As migrações Postgres rodadas num Postgres de verdade, em memória (PGlite).
 *
 * Sem rede e sem segredo: roda no check do MR. É o mesmo `applyModule` que o
 * apply.mjs usa contra o Neon, então o que se testa aqui é o que se aplica lá.
 *
 * Cada teste recusa uma violação, e não apenas aceita o caminho feliz: um CHECK
 * que o banco recusa é um invariante que vale contra um UPDATE manual, e é o
 * único tipo que vale.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'postgres');

/**
 * PGlite com a interface do `pg.Client`. Sem parâmetros o `pg` usa o protocolo
 * simples, que aceita vários comandos num texto só — como um arquivo de
 * migração —, e o `query` do PGlite usa o estendido, que não aceita.
 */
function pglite() {
  const raw = new PGlite();
  return {
    exec: (sql) => raw.exec(sql),
    async query(text, params) {
      if (params === undefined) {
        const out = await raw.exec(text);
        return out.at(-1) ?? { rows: [] };
      }
      return raw.query(text, params);
    },
  };
}

async function fresh(module = 'identity') {
  const db = pglite();
  // PGlite roda como superusuário; o papel do módulo é criado ANTES da migração,
  // como roles.mjs faz, para os GRANTs da migração serem exercitados.
  await db.exec(`CREATE ROLE ssm_identity LOGIN NOSUPERUSER; ALTER ROLE ssm_identity SET search_path = identity;`);
  await applyModule(db, module, root);
  return db;
}

const refuses = (db, sql, params, what) =>
  assert.rejects(() => db.query(sql, params), undefined, `o banco deveria recusar: ${what}`);

const user = (id, email, over = {}) => {
  const v = { tenant: 't1', status: 'active', roles: '["platform:admin"]', attempts: 0, ...over };
  return db0 =>
    db0.query(
      `INSERT INTO identity.users (id, tenant_id, email, password_hash, display_name, status, roles, failed_attempts)
       VALUES ($1, $2, $3, 'h', 'Nome', $4, $5::jsonb, $6)`,
      [id, v.tenant, email, v.status, v.roles, v.attempts],
    );
};

const token = (hash, userId) => (db0) =>
  db0.query(
    `INSERT INTO identity.refresh_tokens (token_hash, user_id, tenant_id, family_id, expires_at)
     VALUES ($1, $2, 't1', 'f1', now() + interval '1 day')`,
    [hash, userId],
  );

const H64 = 'a'.repeat(64);

describe('identity · invariantes do esquema', () => {
  test('status fora da lista é recusado', async () => {
    const db = await fresh();
    await refuses(
      db,
      `INSERT INTO identity.users (id, tenant_id, email, password_hash, display_name, status)
       VALUES ('u', 't1', 'a@x.com', 'h', 'A', 'banido')`,
      [],
      'status inexistente',
    );
  });

  test('o status padrão de um usuário novo é "invited", e não "active"', async () => {
    const db = await fresh();
    await db.query(
      `INSERT INTO identity.users (id, tenant_id, email, password_hash, display_name)
       VALUES ('u', 't1', 'a@x.com', 'h', 'A')`,
    );
    const { rows } = await db.query(`SELECT status FROM identity.users WHERE id = 'u'`);
    assert.equal(rows[0].status, 'invited');
  });

  test('tentativas negativas são recusadas', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO identity.users (id, tenant_id, email, password_hash, display_name, failed_attempts)
      VALUES ('u','t1','a@x.com','h','A',-1)`, [], 'failed_attempts < 0');
  });

  test('roles precisa ser um array JSON, e não objeto, texto ou número', async () => {
    const db = await fresh();
    await user('ok', 'ok@x.com', { roles: '[]' })(db);
    for (const bad of ['{"a":1}', '"admin"', '5', 'null']) {
      await refuses(db, `INSERT INTO identity.users (id, tenant_id, email, password_hash, display_name, roles)
        VALUES ('u${bad.length}','t1','${bad.length}@x.com','h','A', $1::jsonb)`, [bad], `roles = ${bad}`);
    }
  });

  test('e-mail é único por tenant, sem distinguir maiúsculas', async () => {
    const db = await fresh();
    await user('u1', 'Ana@X.com')(db);
    await refuses(
      db,
      `INSERT INTO identity.users (id, tenant_id, email, password_hash, display_name)
       VALUES ('u2','t1','ana@x.com','h','A')`,
      [],
      'mesmo e-mail com caixa diferente no mesmo tenant',
    );
  });

  test('o mesmo e-mail em outro tenant é aceito', async () => {
    const db = await fresh();
    await user('u1', 'ana@x.com')(db);
    await user('u2', 'ana@x.com', { tenant: 't2' })(db);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM identity.users`);
    assert.equal(rows[0].n, 2);
  });

  test('hash de refresh que não tem 64 caracteres é recusado', async () => {
    const db = await fresh();
    await user('u1', 'a@x.com')(db);
    await token(H64, 'u1')(db);
    await refuses(db, `INSERT INTO identity.refresh_tokens (token_hash, user_id, tenant_id, family_id, expires_at)
      VALUES ('curto','u1','t1','f1', now())`, [], 'hash de 5 caracteres');
  });

  test('refresh token de usuário inexistente é recusado pela chave estrangeira', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO identity.refresh_tokens (token_hash, user_id, tenant_id, family_id, expires_at)
      VALUES ($1,'fantasma','t1','f1', now())`, [H64], 'user_id órfão');
  });

  test('apagar o usuário apaga os refresh tokens dele', async () => {
    const db = await fresh();
    await user('u1', 'a@x.com')(db);
    await token(H64, 'u1')(db);
    await db.query(`DELETE FROM identity.users WHERE id = 'u1'`);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM identity.refresh_tokens`);
    assert.equal(rows[0].n, 0);
  });

  test('dinheiro não existe neste esquema: nenhuma coluna numeric ou float', async () => {
    const db = await fresh();
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'identity' AND data_type IN ('numeric','real','double precision')`,
    );
    assert.deepEqual(rows, []);
  });
});

describe('identity · isolamento entre schemas', () => {
  test('ssm_identity lê o próprio schema', async () => {
    const db = await fresh();
    await user('u1', 'a@x.com')(db);
    // SET ROLE não aplica o search_path do papel (só um login novo aplica);
    // em Neon isso foi conferido com login de verdade, ver o relatório.
    await db.exec('SET ROLE ssm_identity; SET search_path = identity');
    const { rows } = await db.query('SELECT id FROM users');
    assert.equal(rows.length, 1);
  });

  test('ssm_identity é recusado em outro schema, mesmo lendo por nome qualificado', async () => {
    const db = await fresh();
    await db.exec(`CREATE SCHEMA hr; CREATE TABLE hr.employees (id text); INSERT INTO hr.employees VALUES ('x');`);
    await db.exec('SET ROLE ssm_identity');
    await refuses(db, 'SELECT * FROM hr.employees', [], 'ssm_identity lendo hr.employees');
  });

  test('ssm_identity não altera o esquema do próprio módulo', async () => {
    const db = await fresh();
    await db.exec('SET ROLE ssm_identity; SET search_path = identity');
    await refuses(db, 'ALTER TABLE users ADD COLUMN x text', [], 'DDL pelo papel da aplicação');
    await refuses(db, 'DROP TABLE refresh_tokens', [], 'DROP pelo papel da aplicação');
  });

  test('ssm_identity não escreve em schema_migrations', async () => {
    const db = await fresh();
    await db.exec('SET ROLE ssm_identity; SET search_path = identity');
    await refuses(db, `DELETE FROM schema_migrations`, [], 'apagar o registro de migrações');
  });
});

describe('runner · aplicação', () => {
  test('é idempotente: a segunda execução não aplica nada nem muda o registro', async () => {
    const db = pglite();
    const first = await applyModule(db, 'identity', root);
    assert.deepEqual(first, ['0001_init.sql']);
    const before = (await db.query('SELECT * FROM identity.schema_migrations')).rows;

    const second = await applyModule(db, 'identity', root);
    assert.deepEqual(second, []);
    const after = (await db.query('SELECT * FROM identity.schema_migrations')).rows;
    assert.deepEqual(after, before);
  });

  test('todo módulo com pasta tem o schema com o nome da pasta', async () => {
    const db = pglite();
    for (const m of listModules(root)) {
      await applyModule(db, m, root);
      const { rows } = await db.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [m]);
      assert.equal(rows.length, 1, `schema ${m}`);
    }
  });

  test('migração já aplicada que foi editada é recusada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssm-mig-'));
    try {
      cpSync(join(root, 'identity'), join(dir, 'identity'), { recursive: true });
      const db = pglite();
      await applyModule(db, 'identity', dir);
      const f = join(dir, 'identity', '0001_init.sql');
      writeFileSync(f, readFileSync(f, 'utf8') + '\n-- editada depois\n');
      await assert.rejects(() => applyModule(db, 'identity', dir), /já foi aplicada e o arquivo mudou/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migração que falha no meio não deixa metade aplicada nem registro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssm-mig-'));
    try {
      mkdirSync(join(dir, 'demo'));
      writeFileSync(join(dir, 'demo', '0001_ok.sql'), 'CREATE TABLE demo.a (id int);');
      writeFileSync(
        join(dir, 'demo', '0002_quebrada.sql'),
        'CREATE TABLE demo.b (id int); INSERT INTO demo.inexistente VALUES (1);',
      );
      const db = pglite();
      await assert.rejects(() => applyModule(db, 'demo', dir));

      const reg = (await db.query('SELECT name FROM demo.schema_migrations')).rows.map((r) => r.name);
      assert.deepEqual(reg, ['0001_ok.sql'], 'só a primeira foi registrada');
      const t = await db.query(`SELECT to_regclass('demo.b') AS b`);
      assert.equal(t.rows[0].b, null, 'a tabela da migração quebrada foi desfeita');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nome de módulo que não é identificador seguro é recusado', async () => {
    const db = pglite();
    await assert.rejects(() => applyModule(db, 'x; DROP SCHEMA public', root), /inválido/);
  });
});

describe('connection · redact', () => {
  const url = 'postgresql://ssm_identity:S3gr3d0%2Fcom%40chars@ep-abc.neon.tech/neondb?sslmode=require';

  test('remove a URL, a senha (crua e decodificada), o usuário e o host do texto', () => {
    const text = `connect failed for ${url}; password S3gr3d0/com@chars; user ssm_identity at ep-abc.neon.tech`;
    const out = redact(text, url);
    for (const s of ['S3gr3d0', 'ssm_identity', 'ep-abc', url]) {
      assert.ok(!out.includes(s), `não deveria conter ${s}`);
    }
  });

  test('URL ilegível não derruba a redação', () => {
    assert.doesNotThrow(() => redact('erro', 'isto não é uma url'));
  });
});
