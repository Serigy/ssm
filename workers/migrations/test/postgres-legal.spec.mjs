import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshAll, refuses } from './helpers.mjs';

/**
 * legal · invariantes do esquema Postgres, em memória (PGlite).
 * A árvore de cláusulas é jsonb; cada teste exige que o BANCO recuse a violação.
 */
const fresh = () => freshAll(['legal']);

const con = (db, id, over = {}) => {
  const v = { tenant: 't1', ref: `REF-${id}`, kind: 'nda', status: 'draft', from: null, to: null, ...over };
  return db.query(
    `INSERT INTO legal.contracts (id,tenant_id,reference,title,kind,status,effective_from,effective_to)
     VALUES ($1,$2,$3,'Título',$4,$5,$6,$7)`,
    [id, v.tenant, v.ref, v.kind, v.status, v.from, v.to],
  );
};

describe('legal · contrato', () => {
  test('situação, tipo e risco fora do contrato são recusados', async () => {
    const db = await fresh();
    await con(db, 'a');
    await refuses(db, `UPDATE legal.contracts SET status = 'rascunho'`, [], 'status');
    await refuses(db, `UPDATE legal.contracts SET kind = 'outro'`, [], 'tipo');
    await refuses(db, `UPDATE legal.contracts SET risk = 'altissimo'`, [], 'risco');
    await db.query(`UPDATE legal.contracts SET risk = 'critical'`);
  });

  test('ativar exige data de início; vigência não pode terminar antes de começar', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO legal.contracts (id,tenant_id,reference,title,kind,status)
      VALUES ('x','t','R','T','nda','active')`, [], 'active sem início');
    await con(db, 'ok', { status: 'active', from: '2026-01-01' });
    await refuses(db, `INSERT INTO legal.contracts (id,tenant_id,reference,title,kind,effective_from,effective_to)
      VALUES ('y','t','R2','T','nda','2026-02-01','2026-01-01')`, [], 'fim < início');
  });

  test('datas são datas de verdade', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO legal.contracts (id,tenant_id,reference,title,kind,effective_from)
      VALUES ('x','t','R','T','nda','2026-02-30')`, [], '30 de fevereiro');
  });

  test('prazo de aviso fora de 0..365 é recusado', async () => {
    const db = await fresh();
    await con(db, 'a');
    await refuses(db, `UPDATE legal.contracts SET renewal_notice_days = 366`, [], '366 dias');
    await refuses(db, `UPDATE legal.contracts SET renewal_notice_days = -1`, [], 'negativo');
  });

  test('auto_renew é boolean de verdade', async () => {
    const db = await fresh();
    await con(db, 'a');
    await refuses(db, `UPDATE legal.contracts SET auto_renew = 2`, [], 'inteiro 2');
    await refuses(db, `UPDATE legal.contracts SET auto_renew = 'talvez'`, [], 'texto');
    await db.query(`UPDATE legal.contracts SET auto_renew = true`);
  });

  test('valor: bigint + char(3) em par, moeda em maiúsculas; sem numeric nem float', async () => {
    const db = await fresh();
    await con(db, 'a');
    await refuses(db, `UPDATE legal.contracts SET value_minor = 100`, [], 'valor sem moeda');
    await refuses(db, `UPDATE legal.contracts SET value_currency = 'BRL'`, [], 'moeda sem valor');
    await refuses(db, `UPDATE legal.contracts SET value_minor = 100, value_currency = 'brl'`, [], 'moeda minúscula');
    await db.query(`UPDATE legal.contracts SET value_minor = 15000000000000, value_currency = 'BRL'`);
    const bad = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='legal' AND data_type IN ('numeric','real','double precision')`);
    assert.deepEqual(bad.rows, []);
  });

  test('a árvore e as listas precisam ser array jsonb: objeto, texto e número são recusados', async () => {
    const db = await fresh();
    await con(db, 'a');
    for (const col of ['parties', 'tags', 'clauses', 'obligations']) {
      for (const bad of ['{"a":1}', '"x"', '5', 'null']) {
        await refuses(db, `UPDATE legal.contracts SET ${col} = $1::jsonb`, [bad], `${col} = ${bad}`);
      }
    }
  });

  test('referência única por tenant', async () => {
    const db = await fresh();
    await con(db, 'a', { ref: 'SER-2026-0001' });
    await refuses(db, `INSERT INTO legal.contracts (id,tenant_id,reference,title,kind) VALUES ('b','t1','SER-2026-0001','T','nda')`, [], 'referência repetida');
    await con(db, 'c', { ref: 'SER-2026-0001', tenant: 't2' });
  });
});

describe('legal · histórico de versões', () => {
  test('a versão é única por contrato, positiva, com cláusulas em array', async () => {
    const db = await fresh();
    await con(db, 'a');
    const v = (ver, clauses = '[]') =>
      db.query(`INSERT INTO legal.contract_versions (contract_id,version,created_at,clauses) VALUES ('a',$1,now(),$2::jsonb)`, [ver, clauses]);
    await v(1);
    await refuses(db, `INSERT INTO legal.contract_versions (contract_id,version,created_at,clauses) VALUES ('a',1,now(),'[]')`, [], 'versão repetida');
    await refuses(db, `INSERT INTO legal.contract_versions (contract_id,version,created_at,clauses) VALUES ('a',0,now(),'[]')`, [], 'versão 0');
    await refuses(db, `INSERT INTO legal.contract_versions (contract_id,version,created_at,clauses) VALUES ('a',2,now(),'{}')`, [], 'cláusulas objeto');
    await refuses(db, `INSERT INTO legal.contract_versions (contract_id,version,created_at,clauses) VALUES ('fantasma',1,now(),'[]')`, [], 'contrato inexistente');
  });

  test('apagar o contrato apaga o histórico', async () => {
    const db = await fresh();
    await con(db, 'a');
    await db.query(`INSERT INTO legal.contract_versions (contract_id,version,created_at,clauses) VALUES ('a',1,now(),'[]')`);
    await db.query(`DELETE FROM legal.contracts WHERE id = 'a'`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM legal.contract_versions`)).rows[0].n, 0);
  });
});

describe('legal · busca e etiquetas', () => {
  test('a coluna gerada indexa referência, título e o nome das partes — não as chaves do JSON', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO legal.contracts (id,tenant_id,reference,title,kind,parties)
      VALUES ('a','t','SER-2026-0001','Sustentação mensal','service_agreement',
        '[{"id":"p1","name":"Prefeitura de Aracaju","role":"counterparty","externalRef":null}]')`);
    const hit = async (q) =>
      (await db.query(`SELECT 1 FROM legal.contracts WHERE search @@ to_tsquery('simple', $1)`, [q])).rows.length;
    assert.equal(await hit('sustentacao:*'), 1);
    assert.equal(await hit('aracaju:*'), 1);
    assert.equal(await hit('ser:* & 0001:*'), 1);
    // "role", "counterparty" e "externalRef" são chaves e valores estruturais,
    // não texto de busca: achá-los seria o ruído de indexar o JSON inteiro.
    assert.equal(await hit('counterparty:*'), 0);
    assert.equal(await hit('externalref:*'), 0);
  });

  test('tags @> usa correspondência exata de elemento', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO legal.contracts (id,tenant_id,reference,title,kind,tags) VALUES ('a','t','R','T','nda','["fiscalizacao"]')`);
    const has = async (tag) =>
      (await db.query(`SELECT 1 FROM legal.contracts WHERE tags @> $1::jsonb`, [JSON.stringify([tag])])).rows.length;
    assert.equal(await has('fiscalizacao'), 1);
    assert.equal(await has('fiscal'), 0);
  });
});

describe('legal · outbox e processed_events', () => {
  test('payload é jsonb e attempts não é negativo', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO legal.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id)
      VALUES ('o','a','a','t','xx','t','c')`, [], 'payload inválido');
    await refuses(db, `INSERT INTO legal.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id,attempts)
      VALUES ('o','a','a','t','{}','t','c',-1)`, [], 'attempts < 0');
  });

  test('processed_events: o mesmo evento não entra duas vezes, e ON CONFLICT não reprocessa', async () => {
    const db = await fresh();
    const ins = `INSERT INTO legal.processed_events (event_id,type,processed_at) VALUES ($1,'x',now())`;
    await db.query(ins, ['ev']);
    await refuses(db, ins, ['ev'], 'evento repetido');
    const again = await db.query(`${ins} ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, ['ev']);
    assert.equal(again.rows.length, 0);
  });
});
