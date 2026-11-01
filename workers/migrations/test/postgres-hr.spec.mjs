import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { randomBytes, createCipheriv } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyModule } from '../postgres/runner.mjs';

/**
 * hr · invariantes do esquema Postgres, num Postgres em memória (PGlite).
 *
 * Sem rede e sem segredo. Cada teste exige que o BANCO recuse a violação: o que
 * vale contra um UPDATE manual é o CHECK, não o código do Worker. Os valores de
 * documento são sintéticos; nenhum é dado de pessoa.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'postgres');

// PGlite com a interface do `pg.Client`: sem parâmetros usa o protocolo simples,
// que aceita um arquivo de migração inteiro.
function pglite() {
  const raw = new PGlite();
  return {
    exec: (sql) => raw.exec(sql),
    async query(text, params) {
      if (params === undefined) return (await raw.exec(text)).at(-1) ?? { rows: [] };
      return raw.query(text, params);
    },
  };
}

async function fresh() {
  const db = pglite();
  // Os papéis existem antes das migrações, como roles.mjs garante em produção.
  await db.exec(`CREATE ROLE ssm_hr LOGIN; CREATE ROLE ssm_identity LOGIN;`);
  await applyModule(db, 'identity', root);
  await applyModule(db, 'hr', root);
  return db;
}

/** Cifra no formato do Worker: base64(nonce(12) || AES-GCM(texto) || etiqueta(16)). */
function cipher(plain) {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', randomBytes(32), nonce);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
  return Buffer.concat([nonce, body]).toString('base64');
}

const refuses = (db, sql, params, what) =>
  assert.rejects(() => db.query(sql, params), undefined, `o banco deveria recusar: ${what}`);

const emp = (id, over = {}) => {
  const v = {
    tenant: 't1', number: `COL-${id}`, email: `${id}@x.com`, status: 'onboarding',
    start: '2026-01-05', end: null, minor: null, cur: null, enc: null, ...over,
  };
  return (db) =>
    db.query(
      `INSERT INTO hr.employees (id, tenant_id, employee_number, first_name, last_name, work_email,
         status, contract_type, job_title, start_date, end_date, salary_minor, salary_currency, national_id_enc)
       VALUES ($1,$2,$3,'Ana','Teste',$4,$5,'permanent','Analista',$6,$7,$8,$9,$10)`,
      [id, v.tenant, v.number, v.email, v.status, v.start, v.end, v.minor, v.cur, v.enc],
    );
};

describe('hr · invariantes do esquema', () => {
  test('status fora da lista é recusado', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      status,contract_type,job_title,start_date) VALUES ('e','t','n','A','B','a@x.com','ferias','permanent','x','2026-01-01')`, [], 'status inexistente');
  });

  test('o status padrão de um colaborador novo é onboarding', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      contract_type,job_title,start_date) VALUES ('e','t','n','A','B','a@x.com','permanent','x','2026-01-01')`);
    assert.equal((await db.query(`SELECT status FROM hr.employees`)).rows[0].status, 'onboarding');
  });

  test('desligado sem último dia é recusado', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      status,contract_type,job_title,start_date) VALUES ('e','t','n','A','B','a@x.com','terminated','permanent','x','2026-01-01')`, [], 'terminated sem end_date');
    await emp('ok', { status: 'terminated', end: '2026-02-01' })(db);
  });

  test('último dia anterior à admissão é recusado', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      status,contract_type,job_title,start_date,end_date) VALUES ('e','t','n','A','B','a@x.com','offboarding','permanent','x','2026-01-10','2026-01-09')`, [], 'end < start');
  });

  test('salário sem moeda e moeda sem salário são recusados', async () => {
    const db = await fresh();
    await emp('a')(db);
    await refuses(db, `UPDATE hr.employees SET salary_minor = 100 WHERE id = 'a'`, [], 'valor sem moeda');
    await refuses(db, `UPDATE hr.employees SET salary_currency = 'BRL' WHERE id = 'a'`, [], 'moeda sem valor');
    await db.query(`UPDATE hr.employees SET salary_minor = 100, salary_currency = 'BRL' WHERE id = 'a'`);
  });

  test('dinheiro é bigint + char(3): nenhuma coluna numeric ou float', async () => {
    const db = await fresh();
    const { rows } = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'hr' AND data_type IN ('numeric','real','double precision')`);
    assert.deepEqual(rows, []);
    const sal = (await db.query(`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='hr' AND table_name='employees' AND column_name LIKE 'salary%' ORDER BY 1`)).rows;
    assert.deepEqual(sal.map((r) => r.data_type), ['character', 'bigint']);
  });

  test('o CPF em claro é recusado; o cifrado é aceito', async () => {
    const db = await fresh();
    await emp('a')(db);
    for (const plain of ['000.000.000-00', '00000000000', 'documento-sintetico']) {
      await refuses(db, `UPDATE hr.employees SET national_id_enc = $1 WHERE id = 'a'`, [plain], `valor em claro "${plain.length} chars"`);
    }
    await db.query(`UPDATE hr.employees SET national_id_enc = $1 WHERE id = 'a'`, [cipher('x')]);
    await db.query(`UPDATE hr.employees SET national_id_enc = $1 WHERE id = 'a'`, [cipher('documento-sintetico-longo-0001')]);
  });

  test('matrícula única por tenant; e-mail único por tenant sem distinguir caixa', async () => {
    const db = await fresh();
    await emp('a', { number: 'COL-1', email: 'Ana@x.com' })(db);
    await refuses(db, `INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      contract_type,job_title,start_date) VALUES ('b','t1','COL-1','A','B','b@x.com','permanent','x','2026-01-01')`, [], 'matrícula repetida');
    await refuses(db, `INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      contract_type,job_title,start_date) VALUES ('c','t1','COL-2','A','B','ana@X.COM','permanent','x','2026-01-01')`, [], 'e-mail com outra caixa');
    await emp('d', { tenant: 't2', number: 'COL-1', email: 'ana@x.com' })(db); // outro tenant: aceito
  });

  test('apagar departamento ou gestor solta a referência, sem apagar o colaborador', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO hr.departments (id, tenant_id, name) VALUES ('d','t1','TI')`);
    await emp('gestor')(db);
    await emp('func')(db);
    await db.query(`UPDATE hr.employees SET department_id='d', manager_id='gestor' WHERE id='func'`);
    await db.query(`DELETE FROM hr.departments WHERE id='d'`);
    await db.query(`DELETE FROM hr.employees WHERE id='gestor'`);
    const r = (await db.query(`SELECT department_id, manager_id FROM hr.employees WHERE id='func'`)).rows[0];
    assert.deepEqual(r, { department_id: null, manager_id: null });
  });

  test('referência a departamento inexistente é recusada', async () => {
    const db = await fresh();
    await emp('a')(db);
    await refuses(db, `UPDATE hr.employees SET department_id = 'fantasma' WHERE id = 'a'`, [], 'FK órfã');
  });
});

describe('hr · busca', () => {
  test('a coluna gerada acha por prefixo, sem acento e pelo domínio do e-mail', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO hr.employees (id,tenant_id,employee_number,first_name,last_name,work_email,
      contract_type,job_title,start_date) VALUES ('e','t','COL-00007','Álvaro','CÂNDIDO','alvaro@serigy.local','permanent','x','2026-01-01')`);
    for (const q of ['alvaro:*', 'cand:*', 'serigy:*', 'col:* & 00007:*']) {
      const { rows } = await db.query(`SELECT 1 FROM hr.employees WHERE search @@ to_tsquery('simple', $1)`, [q]);
      assert.equal(rows.length, 1, q);
    }
    const none = await db.query(`SELECT 1 FROM hr.employees WHERE search @@ to_tsquery('simple', 'zzz:*')`);
    assert.equal(none.rows.length, 0);
  });
});

describe('hr · outbox e processed_events', () => {
  test('o payload do outbox precisa ser JSON válido', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO hr.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id)
      VALUES ('o','employee','e','t','nao-e-json','t1','c')`, [], 'payload inválido');
    await db.query(`INSERT INTO hr.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id)
      VALUES ('o','employee','e','t','{"a":1}','t1','c')`);
  });

  test('tentativas negativas são recusadas', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO hr.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id,attempts)
      VALUES ('o','employee','e','t','{}','t1','c',-1)`, [], 'attempts < 0');
  });

  test('o mesmo event_id não entra duas vezes: INSERT puro é recusado e ON CONFLICT não processa de novo', async () => {
    const db = await fresh();
    const ins = `INSERT INTO hr.processed_events (event_id, type, processed_at) VALUES ($1, 'x', now())`;
    await db.query(ins, ['ev-1']);
    await refuses(db, ins, ['ev-1'], 'evento repetido');

    const first = await db.query(`${ins} ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, ['ev-2']);
    const again = await db.query(`${ins} ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, ['ev-2']);
    assert.equal(first.rows.length, 1, 'a primeira entrega processa');
    assert.equal(again.rows.length, 0, 'a reentrega não processa');
    assert.equal((await db.query(`SELECT count(*)::int n FROM hr.processed_events`)).rows[0].n, 2);
  });
});

describe('hr · isolamento entre papéis', () => {
  test('ssm_hr lê e escreve em hr', async () => {
    const db = await fresh();
    await db.exec('SET ROLE ssm_hr; SET search_path = hr');
    await db.query(`INSERT INTO departments (id, tenant_id, name) VALUES ('d','t1','TI')`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM departments`)).rows[0].n, 1);
    await db.query(`INSERT INTO processed_events (event_id, type, processed_at) VALUES ('e','x', now())`);
  });

  test('ssm_hr é recusado no schema identity', async () => {
    const db = await fresh();
    await db.exec('SET ROLE ssm_hr');
    await refuses(db, `SELECT * FROM identity.users`, [], 'ssm_hr lendo identity.users');
    await refuses(db, `SELECT * FROM identity.refresh_tokens`, [], 'ssm_hr lendo tokens de refresh');
  });

  test('ssm_identity é recusado no schema hr', async () => {
    const db = await fresh();
    await db.exec('SET ROLE ssm_identity');
    await refuses(db, `SELECT * FROM hr.employees`, [], 'ssm_identity lendo colaboradores');
    await refuses(db, `INSERT INTO hr.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id)
      VALUES ('o','e','e','t','{}','t','c')`, [], 'ssm_identity gravando no outbox do hr');
  });

  test('ssm_hr não altera o esquema nem o registro de migrações', async () => {
    const db = await fresh();
    await db.exec('SET ROLE ssm_hr; SET search_path = hr');
    await refuses(db, `ALTER TABLE employees ADD COLUMN x text`, [], 'DDL');
    await refuses(db, `DROP TABLE outbox`, [], 'DROP');
    await refuses(db, `DELETE FROM schema_migrations`, [], 'apagar o registro');
  });
});
