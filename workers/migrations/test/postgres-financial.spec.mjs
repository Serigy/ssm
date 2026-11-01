import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshAll, refuses } from './helpers.mjs';

/**
 * financial · invariantes do esquema Postgres, em memória (PGlite).
 * Cada teste exige que o BANCO recuse a violação: é o que vale contra um UPDATE
 * manual, e este esquema guarda dinheiro.
 */
const fresh = () => freshAll(['financial']);

const inv = (db, id, over = {}) => {
  const v = {
    status: 'draft', number: null, issue: null, cur: 'BRL', sub: 1000, tax: 100, total: 1100, paid: 0,
    tenant: 't1', due: '2026-12-31', ...over,
  };
  return db.query(
    `INSERT INTO financial.invoices (id,tenant_id,number,status,counterparty_id,counterparty_name,issue_date,due_date,
       currency,subtotal_minor,tax_total_minor,total_minor,amount_paid_minor)
     VALUES ($1,$2,$3,$4,'cp','Cliente',$5,$6,$7,$8,$9,$10,$11)`,
    [id, v.tenant, v.number, v.status, v.issue, v.due, v.cur, v.sub, v.tax, v.total, v.paid],
  );
};
const issued = (db, id, over = {}) =>
  inv(db, id, { status: 'issued', number: `FAT-${id}`, issue: '2026-08-01', ...over });

describe('financial · dinheiro', () => {
  test('nenhuma coluna é numeric ou float; valores são bigint e moeda é char(3)', async () => {
    const db = await fresh();
    const bad = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='financial' AND data_type IN ('numeric','real','double precision')`);
    assert.deepEqual(bad.rows, []);
    const types = (await db.query(`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='financial' AND table_name='invoices' AND column_name LIKE '%\\_minor' ORDER BY 1`)).rows;
    assert.deepEqual(types.map((r) => r.data_type), ['bigint', 'bigint', 'bigint', 'bigint']);
    const cur = (await db.query(`SELECT data_type, character_maximum_length FROM information_schema.columns
      WHERE table_schema='financial' AND table_name='invoices' AND column_name='currency'`)).rows[0];
    assert.deepEqual(cur, { data_type: 'character', character_maximum_length: 3 });
  });

  test('valores acima de 2^31 cabem (bigint) sem perder dígito', async () => {
    const db = await fresh();
    await inv(db, 'a', { sub: 9_000_000_000_000, tax: 1, total: 9_000_000_000_001 });
    const r = await db.query(`SELECT total_minor::text t FROM financial.invoices`);
    assert.equal(r.rows[0].t, '9000000000001');
  });

  test('total diferente de subtotal + imposto é recusado', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,counterparty_id,counterparty_name,due_date,currency,
      subtotal_minor,tax_total_minor,total_minor) VALUES ('x','t','c','C','2026-01-01','BRL',100,10,111)`, [], 'soma errada');
  });

  test('moeda precisa ser três letras maiúsculas', async () => {
    const db = await fresh();
    for (const cur of ['br', 'brl', 'BRLX', '12A']) {
      await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,counterparty_id,counterparty_name,due_date,currency)
        VALUES ('x','t','c','C','2026-01-01', $1)`, [cur], `moeda "${cur}"`);
    }
  });

  test('pago acima do total e pago negativo são recusados', async () => {
    const db = await fresh();
    await issued(db, 'a');
    await refuses(db, `UPDATE financial.invoices SET amount_paid_minor = total_minor + 1`, [], 'pago > total');
    await refuses(db, `UPDATE financial.invoices SET amount_paid_minor = -1`, [], 'pago < 0');
  });

  test('situação coerente com o valor pago: paid exige total pago; partially_paid exige parcial', async () => {
    const db = await fresh();
    await issued(db, 'a');
    await refuses(db, `UPDATE financial.invoices SET status = 'paid'`, [], 'paid sem pagar');
    await refuses(db, `UPDATE financial.invoices SET status = 'partially_paid'`, [], 'partially_paid com zero');
    await refuses(db, `UPDATE financial.invoices SET status = 'partially_paid', amount_paid_minor = total_minor`, [], 'partially_paid com tudo');
    await db.query(`UPDATE financial.invoices SET status = 'partially_paid', amount_paid_minor = 500`);
    await db.query(`UPDATE financial.invoices SET status = 'paid', amount_paid_minor = total_minor`);
  });
});

describe('financial · fatura', () => {
  test('situação fora da lista é recusada', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,status,counterparty_id,counterparty_name,due_date,currency)
      VALUES ('x','t','cobrada','c','C','2026-01-01','BRL')`, [], 'status');
  });

  test('emitida sem número ou sem data de emissão é recusada; rascunho pode ficar sem', async () => {
    const db = await fresh();
    await inv(db, 'rascunho');
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,status,counterparty_id,counterparty_name,due_date,currency,issue_date)
      VALUES ('x','t','issued','c','C','2026-01-01','BRL','2026-01-01')`, [], 'issued sem número');
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,status,number,counterparty_id,counterparty_name,due_date,currency)
      VALUES ('x','t','issued','N-1','c','C','2026-01-01','BRL')`, [], 'issued sem data');
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,status,counterparty_id,counterparty_name,due_date,currency)
      VALUES ('x','t','void','c','C','2026-01-01','BRL')`, [], 'void sem número (a regra que impede cancelar rascunho)');
  });

  test('datas são datas: texto fora do formato é recusado', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,counterparty_id,counterparty_name,due_date,currency)
      VALUES ('x','t','c','C','2026-8-1x','BRL')`, [], 'data inválida');
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,counterparty_id,counterparty_name,due_date,currency)
      VALUES ('x','t','c','C','2026-02-30','BRL')`, [], '30 de fevereiro');
  });

  test('número único por tenant (vários rascunhos sem número são aceitos)', async () => {
    const db = await fresh();
    await inv(db, 'r1');
    await inv(db, 'r2');
    await issued(db, 'a', { number: 'FAT-1' });
    await refuses(db, `INSERT INTO financial.invoices (id,tenant_id,number,status,counterparty_id,counterparty_name,issue_date,due_date,currency)
      VALUES ('b','t1','FAT-1','issued','c','C','2026-01-01','2026-01-01','BRL')`, [], 'número repetido');
    await issued(db, 'c', { number: 'FAT-1', tenant: 't2' });
  });

  test('versão nunca fica abaixo de 1', async () => {
    const db = await fresh();
    await inv(db, 'a');
    await refuses(db, `UPDATE financial.invoices SET version = 0`, [], 'versão 0');
  });
});

describe('financial · linhas', () => {
  const line = (db, id, inv_, pos, over = '') =>
    db.query(`INSERT INTO financial.invoice_lines (id,invoice_id,position,description,quantity_milli,unit_price_minor,tax_rate_bps,line_total_minor)
      VALUES ('${id}','${inv_}',${pos},'d',${over || 1000},100,0,100)`);

  test('quantidade não positiva, alíquota fora de 0..10000 e posição repetida são recusadas', async () => {
    const db = await fresh();
    await inv(db, 'a');
    await line(db, 'l1', 'a', 0);
    await refuses(db, `INSERT INTO financial.invoice_lines (id,invoice_id,position,description,quantity_milli,unit_price_minor,line_total_minor)
      VALUES ('l2','a',1,'d',0,1,1)`, [], 'quantidade 0');
    await refuses(db, `INSERT INTO financial.invoice_lines (id,invoice_id,position,description,quantity_milli,unit_price_minor,tax_rate_bps,line_total_minor)
      VALUES ('l3','a',2,'d',1,1,10001,1)`, [], 'alíquota > 100%');
    await refuses(db, `INSERT INTO financial.invoice_lines (id,invoice_id,position,description,quantity_milli,unit_price_minor,line_total_minor)
      VALUES ('l4','a',0,'d',1,1,1)`, [], 'posição repetida');
  });

  test('linha de fatura inexistente é recusada, e apagar a fatura apaga as linhas', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO financial.invoice_lines (id,invoice_id,position,description,quantity_milli,unit_price_minor,line_total_minor)
      VALUES ('l','fantasma',0,'d',1,1,1)`, [], 'FK órfã');
    await inv(db, 'a');
    await line(db, 'l1', 'a', 0);
    await db.query(`DELETE FROM financial.invoices WHERE id='a'`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM financial.invoice_lines`)).rows[0].n, 0);
  });
});

describe('financial · busca, outbox e processed_events', () => {
  test('busca por número e por contraparte, com prefixo e sem acento', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO financial.invoices (id,tenant_id,number,status,counterparty_id,counterparty_name,issue_date,due_date,currency)
      VALUES ('a','t','FAT-2026-00007','issued','c','São Paulo Serviços','2026-01-01','2026-02-01','BRL')`);
    for (const q of ['fat:* & 00007:*', 'sao:*', 'servic:*']) {
      const { rows } = await db.query(`SELECT 1 FROM financial.invoices WHERE search @@ to_tsquery('simple', $1)`, [q]);
      assert.equal(rows.length, 1, q);
    }
  });

  test('payload do outbox é jsonb e attempts não é negativo', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO financial.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id)
      VALUES ('o','a','a','t','xx','t','c')`, [], 'payload inválido');
    await refuses(db, `INSERT INTO financial.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id,attempts)
      VALUES ('o','a','a','t','{}','t','c',-1)`, [], 'attempts < 0');
  });

  test('processed_events: o mesmo evento não entra duas vezes, e ON CONFLICT não reprocessa', async () => {
    const db = await fresh();
    const ins = `INSERT INTO financial.processed_events (event_id,type,processed_at) VALUES ($1,'x',now())`;
    await db.query(ins, ['ev']);
    await refuses(db, ins, ['ev'], 'evento repetido');
    const again = await db.query(`${ins} ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, ['ev']);
    assert.equal(again.rows.length, 0);
  });
});
