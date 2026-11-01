import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { freshAll, refuses } from './helpers.mjs';

/**
 * operations · invariantes do esquema Postgres, em memória (PGlite).
 * Cada teste exige que o BANCO recuse a violação.
 */
const fresh = () => freshAll(['operations']);

const env = (db, id = 'e1', over = '') =>
  db.query(`INSERT INTO operations.environments (id, tenant_id, code, name, kind${over ? ', ' + over.split('=')[0] : ''})
    VALUES ('${id}', 't1', 'cod-${id}', 'Nome', 'production'${over ? ', ' + over.split('=')[1] : ''})`);

const ticket = (db, id, extra = {}) => {
  const v = { status: 'open', sev: 'sev3', resolved: null, opened: '2026-07-01T10:00:00Z', ...extra };
  return db.query(
    `INSERT INTO operations.tickets (id, tenant_id, number, subject, severity, status, opened_at, resolved_at, response_due_at)
     VALUES ($1,'t1',$2,'Assunto',$3,$4,$5,$6,$5)`,
    [id, extra.number ?? Math.floor(Math.random() * 1e6), v.sev, v.status, v.opened, v.resolved],
  );
};

describe('operations · ambientes', () => {
  test('meta de disponibilidade fora de 0..10000 é recusada', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `UPDATE operations.environments SET availability_target_bps = 10001`, [], 'meta > 100%');
    await refuses(db, `UPDATE operations.environments SET availability_target_bps = -1`, [], 'meta negativa');
  });

  test('prazo de resposta zero ou negativo é recusado', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `UPDATE operations.environments SET response_sev2_minutes = 0`, [], 'prazo zero');
  });

  test('kind, status e formato de tags/janela são recusados quando inválidos', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `UPDATE operations.environments SET kind = 'lab'`, [], 'kind');
    await refuses(db, `UPDATE operations.environments SET status = 'caiu'`, [], 'status');
    await refuses(db, `UPDATE operations.environments SET tags = '{"a":1}'::jsonb`, [], 'tags objeto');
    await refuses(db, `UPDATE operations.environments SET next_window = '[1]'::jsonb`, [], 'janela array');
  });

  test('o código é único por tenant', async () => {
    const db = await fresh();
    await env(db, 'e1');
    await refuses(db, `INSERT INTO operations.environments (id, tenant_id, code, name, kind)
      VALUES ('x','t1','cod-e1','N','staging')`, [], 'código repetido');
    await db.query(`INSERT INTO operations.environments (id, tenant_id, code, name, kind)
      VALUES ('y','t2','cod-e1','N','staging')`);
  });
});

describe('operations · chamados', () => {
  test('chamado resolvido sem resolved_at é recusado', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO operations.tickets (id,tenant_id,number,subject,severity,status,opened_at,response_due_at)
      VALUES ('t','t1',1,'x','sev1','resolved', now(), now())`, [], 'resolved sem data');
    await ticket(db, 'ok', { status: 'resolved', resolved: '2026-07-01T11:00:00Z' });
  });

  test('resolução anterior à abertura é recusada', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO operations.tickets (id,tenant_id,number,subject,severity,status,opened_at,resolved_at,response_due_at)
      VALUES ('t','t1',1,'x','sev1','closed','2026-07-02T00:00:00Z','2026-07-01T00:00:00Z', now())`, [], 'resolved < opened');
  });

  test('severidade, status e pausa negativa são recusados', async () => {
    const db = await fresh();
    await ticket(db, 'a', { number: 1 });
    await refuses(db, `UPDATE operations.tickets SET severity = 'sev9'`, [], 'severidade');
    await refuses(db, `UPDATE operations.tickets SET status = 'perdido'`, [], 'status');
    await refuses(db, `UPDATE operations.tickets SET paused_minutes = -1`, [], 'pausa negativa');
    await refuses(db, `UPDATE operations.tickets SET timeline = '{}'::jsonb`, [], 'timeline fora de array');
  });

  test('response_breached é boolean de verdade: 0/1 e texto solto são recusados', async () => {
    const db = await fresh();
    await ticket(db, 'a', { number: 1 });
    await refuses(db, `UPDATE operations.tickets SET response_breached = 2`, [], 'inteiro 2');
    await refuses(db, `UPDATE operations.tickets SET response_breached = 'talvez'`, [], 'texto');
    await db.query(`UPDATE operations.tickets SET response_breached = true`);
  });

  test('número do chamado é único por tenant', async () => {
    const db = await fresh();
    await ticket(db, 'a', { number: 7 });
    await refuses(db, `INSERT INTO operations.tickets (id,tenant_id,number,subject,severity,opened_at,response_due_at)
      VALUES ('b','t1',7,'x','sev3', now(), now())`, [], 'número repetido');
  });

  test('busca: prefixo, sem acento, e pelo código do ambiente', async () => {
    const db = await fresh();
    await db.query(`INSERT INTO operations.tickets (id,tenant_id,number,subject,severity,opened_at,response_due_at,environment_code)
      VALUES ('t','t1',1,'Latência elevada','sev2', now(), now(), 'amb-prod-01')`);
    for (const q of ['latencia:*', 'elev:*', 'prod:* & 01:*']) {
      const { rows } = await db.query(`SELECT 1 FROM operations.tickets WHERE search @@ to_tsquery('simple', $1)`, [q]);
      assert.equal(rows.length, 1, q);
    }
  });
});

describe('operations · apuração de SLA', () => {
  const period = (db, over = {}) => {
    const v = { month: '2026-07-01', measured: 44640, down: 720, ach: 9839, target: 9950, breached: true, credit: 1000, cur: 'BRL', ...over };
    return db.query(
      `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
         downtime_minutes,achieved_bps,target_bps,breached,credit_minor,credit_currency)
       VALUES ($1,'t1','e1','cod',$2,$3,$4,$5,$6,$7,$8,$9)`,
      [over.id ?? crypto.randomUUID(), v.month, v.measured, v.down, v.ach, v.target, v.breached, v.credit, v.cur],
    );
  };

  test('crédito sem descumprimento é recusado (este número vai para uma fatura)', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps,breached,credit_minor,credit_currency)
      VALUES ('p','t1','e1','c','2026-07-01',100,0,10000,9950,false,500,'BRL')`, [], 'crédito com breached = false');
    await period(db, { breached: false, credit: null, cur: null, ach: 10000, down: 0 });
  });

  test('crédito sem moeda, moeda sem crédito, zero e negativo são recusados', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps,breached,credit_minor) VALUES ('p','t1','e1','c','2026-07-01',100,1,9900,9950,true,500)`, [], 'sem moeda');
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps,breached,credit_currency) VALUES ('p','t1','e1','c','2026-07-02',100,1,9900,9950,true,'BRL')`, [], 'sem valor');
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps,breached,credit_minor,credit_currency) VALUES ('p','t1','e1','c','2026-07-01',100,1,9900,9950,true,0,'BRL')`, [], 'crédito zero');
  });

  test('indisponibilidade maior que o período medido é recusada', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps,breached) VALUES ('p','t1','e1','c','2026-07-01',100,101,0,9950,true)`, [], 'down > measured');
  });

  test('o mês precisa ser dia 1', async () => {
    const db = await fresh();
    await env(db);
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps) VALUES ('p','t1','e1','c','2026-07-15',100,0,10000,9950)`, [], 'dia 15');
  });

  test('uma apuração por ambiente por mês: o INSERT repetido é recusado e ON CONFLICT não duplica', async () => {
    const db = await fresh();
    await env(db);
    await period(db, { breached: false, credit: null, cur: null, ach: 10000, down: 0 });
    await refuses(db, `INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps) VALUES ('q','t1','e1','c','2026-07-01',100,0,10000,9950)`, [], 'mês repetido');
    const again = await db.query(`INSERT INTO operations.sla_periods (id,tenant_id,environment_id,environment_code,month,measured_minutes,
      downtime_minutes,achieved_bps,target_bps) VALUES ('q','t1','e1','c','2026-07-01',100,0,10000,9950)
      ON CONFLICT (tenant_id, environment_id, month) DO NOTHING RETURNING id`);
    assert.equal(again.rows.length, 0);
  });

  test('apagar o ambiente apaga as apurações; apagar o ambiente solta o chamado', async () => {
    const db = await fresh();
    await env(db);
    await period(db, { breached: false, credit: null, cur: null, ach: 10000, down: 0 });
    await ticket(db, 'a', { number: 1 });
    await db.query(`UPDATE operations.tickets SET environment_id = 'e1'`);
    await db.query(`DELETE FROM operations.environments WHERE id = 'e1'`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM operations.sla_periods`)).rows[0].n, 0);
    assert.equal((await db.query(`SELECT environment_id FROM operations.tickets`)).rows[0].environment_id, null);
  });

  test('dinheiro é bigint + char(3), sem numeric nem float', async () => {
    const db = await fresh();
    const { rows } = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='operations' AND data_type IN ('numeric','real','double precision')`);
    assert.deepEqual(rows, []);
  });
});

describe('operations · outbox e processed_events', () => {
  test('payload é jsonb e attempts não é negativo', async () => {
    const db = await fresh();
    await refuses(db, `INSERT INTO operations.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id)
      VALUES ('o','a','a','t','nao-e-json','t','c')`, [], 'payload inválido');
    await refuses(db, `INSERT INTO operations.outbox (id,aggregate_type,aggregate_id,type,payload,tenant_id,correlation_id,attempts)
      VALUES ('o','a','a','t','{}','t','c',-1)`, [], 'attempts < 0');
  });

  test('o mesmo event_id não entra duas vezes', async () => {
    const db = await fresh();
    const ins = `INSERT INTO operations.processed_events (event_id, type, processed_at) VALUES ($1,'x', now())`;
    await db.query(ins, ['ev']);
    await refuses(db, ins, ['ev'], 'evento repetido');
    const again = await db.query(`${ins} ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, ['ev']);
    assert.equal(again.rows.length, 0);
  });
});
