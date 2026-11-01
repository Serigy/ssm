import { computeAvailabilityBps, computeSlaCredit } from '@ssm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// A numeração vem do Durable Object, que não existe aqui: o corpo recebe o
// próximo número e o resto da transação é o código de verdade.
vi.mock('@ssm/worker-common', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ssm/worker-common')>();
  return {
    ...real,
    withReservedNumber: async (
      _env: unknown,
      _tenant: string,
      _seq: string,
      seed: number,
      body: (v: number) => Promise<unknown>,
    ) => body(seed + 1),
  };
});

import {
  assignTicket,
  createEnvironment,
  createTicket,
  reckonSla,
  transitionTicket,
} from './commands.js';
import { drainOutbox, markBreachedResponses } from './index.js';
import { findEnvironmentRow, listTickets, searchQuery } from './queries.js';
import { openTestDb, type TestDb } from './test-db.js';

const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';
const ACTOR = '00000000-0000-4000-8000-0000000000b1';
const ENV = '00000000-0000-4000-8000-0000000000e1';
const env = {} as never;

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(() => t.close());

beforeEach(async () => {
  await t.pg.exec(`
    ALTER TABLE outbox DROP CONSTRAINT IF EXISTS boom;
    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS boom;
    DELETE FROM outbox; DELETE FROM sla_periods; DELETE FROM tickets; DELETE FROM environments;
    INSERT INTO environments (id, tenant_id, code, name, kind, availability_target_bps)
    VALUES ('${ENV}', '${T1}', 'amb-prod-01', 'Produção', 'production', 9950);
  `);
});

const count = async (sql: string) =>
  (await t.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0]!.n;
const envStatus = async () =>
  (await t.pg.query<{ status: string }>(`SELECT status FROM environments WHERE id = '${ENV}'`))
    .rows[0]!.status;
const eventTypes = async () =>
  (await t.pg.query<{ type: string }>(`SELECT type FROM outbox ORDER BY created_at, type`)).rows.map(
    (r) => r.type,
  );

/**
 * Simula uma corrida: depois da primeira leitura cujo SQL começa por `prefix`, executa
 * `action` (outra pessoa mexendo no banco) antes de o código seguir para a escrita.
 * Devolve a função que restaura o banco.
 */
function raceAfterRead(prefix: string, action: string): () => void {
  const db = t.db as unknown as { prepare: (sql: string) => unknown };
  const real = db.prepare.bind(db) as (sql: string) => {
    bind: (...v: unknown[]) => { first: () => Promise<unknown> };
  };
  let armed = true;
  db.prepare = (sql: string) => {
    const s = real(sql);
    if (!armed || !sql.startsWith(prefix)) return s;
    armed = false;
    return {
      ...s,
      bind: (...v: unknown[]) => {
        const b = s.bind(...v);
        return {
          ...b,
          first: async () => {
            const row = await b.first();
            await t.pg.exec(action);
            return row;
          },
        };
      },
    };
  };
  return () => {
    delete (db as { prepare?: unknown }).prepare;
  };
}

const open = (severity: 'sev1' | 'sev2' | 'sev3' = 'sev1', environmentId: string | null = ENV) =>
  createTicket(
    env, t.db, T1, ACTOR,
    { subject: 'Cluster fora', description: '', kind: 'incident', severity, environmentId } as never,
    'corr',
  );

describe('chamado e ambiente mudam juntos, com o evento na mesma transação', () => {
  test('sev1 em ambiente operacional: ambiente vai a incidente e o evento é gravado', async () => {
    const tk = await open();
    expect(tk.status).toBe('open');
    expect(tk.responseBreached).toBe(false); // boolean, e não 0/1
    expect(await envStatus()).toBe('incident');
    expect(await eventTypes()).toEqual(['operations.incident.opened']);
  });

  test('se o outbox falha, nem o chamado nem o ambiente mudam', async () => {
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (false)`);
    await expect(open()).rejects.toThrow(/boom/);
    expect(await count('tickets')).toBe(0);
    expect(await envStatus()).toBe('operational');
  });

  test('ambiente já em incidente: o chamado abre, mas não há evento de incidente novo', async () => {
    await open();
    await t.pg.exec('DELETE FROM outbox');
    await open();
    expect(await count('tickets')).toBe(2);
    expect(await eventTypes()).toEqual([]);
  });

  test('se outro sev1 pôs o ambiente em incidente depois da leitura, não há evento fantasma', async () => {
    const restore = raceAfterRead('SELECT * FROM environments', `UPDATE environments SET status = 'incident' WHERE id = '${ENV}'`);
    try {
      await createTicket(
        env, t.db, T1, ACTOR,
        { subject: 'x', description: '', kind: 'incident', severity: 'sev1', environmentId: ENV } as never,
        'c',
      );
    } finally {
      restore();
    }
    expect(await count('tickets')).toBe(1);
    expect(await eventTypes()).toEqual([]);
  });
});

describe('transição de chamado', () => {
  test('a primeira saída de open é a primeira resposta, e o atraso vira boolean true', async () => {
    const tk = await open('sev3', null);
    await t.pg.exec(`UPDATE tickets SET response_due_at = now() - interval '1 hour' WHERE id = '${tk.id}'`);
    const out = await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'in_progress', undefined, 'c');
    expect(out.firstResponseAt).not.toBeNull();
    expect(out.responseBreached).toBe(true);
  });

  test('transição fora do grafo é 409', async () => {
    const tk = await open('sev3', null);
    await expect(
      transitionTicket(env, t.db, T1, ACTOR, tk.id, 'resolved', undefined, 'c'),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('o tempo em waiting_customer é acumulado como pausa', async () => {
    const tk = await open('sev3', null);
    await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'in_progress', undefined, 'c');
    await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'waiting_customer', undefined, 'c');
    await t.pg.exec(`UPDATE tickets SET waiting_since = now() - interval '90 minutes' WHERE id = '${tk.id}'`);
    const out = await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'in_progress', undefined, 'c');
    expect(out.pausedMinutes).toBe(90);
  });

  test('resolver sev1: ambiente volta a operacional e o evento sai junto', async () => {
    const tk = await open();
    await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'in_progress', undefined, 'c');
    await t.pg.exec('DELETE FROM outbox');
    const out = await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'resolved', undefined, 'c');
    expect(out.status).toBe('resolved');
    expect(await envStatus()).toBe('operational');
    expect(await eventTypes()).toEqual(['operations.incident.resolved']);
  });

  test('dois sev1 abertos: resolver um não apaga o alarme do outro', async () => {
    const a = await open();
    const b = await open();
    for (const x of [a, b]) {
      await transitionTicket(env, t.db, T1, ACTOR, x.id, 'in_progress', undefined, 'c');
    }
    await transitionTicket(env, t.db, T1, ACTOR, a.id, 'resolved', undefined, 'c');
    expect(await envStatus()).toBe('incident');
    await transitionTicket(env, t.db, T1, ACTOR, b.id, 'resolved', undefined, 'c');
    expect(await envStatus()).toBe('operational');
  });

  test('se o outbox falha ao resolver, o chamado e o ambiente ficam como estavam', async () => {
    const tk = await open();
    await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'in_progress', undefined, 'c');
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (type <> 'operations.incident.resolved')`);

    await expect(
      transitionTicket(env, t.db, T1, ACTOR, tk.id, 'resolved', undefined, 'c'),
    ).rejects.toThrow(/boom/);

    const { rows } = await t.pg.query<{ status: string }>(`SELECT status FROM tickets WHERE id = '${tk.id}'`);
    expect(rows[0]!.status).toBe('in_progress');
    expect(await envStatus()).toBe('incident');
  });

  test('quem perde a corrida recebe 409, e não apaga o alarme nem grava evento', async () => {
    const tk = await open();
    await transitionTicket(env, t.db, T1, ACTOR, tk.id, 'in_progress', undefined, 'c');
    await t.pg.exec('DELETE FROM outbox');

    // A leitura vê in_progress; antes do UPDATE alguém o põe em waiting_customer.
    const restore = raceAfterRead('SELECT * FROM tickets', `UPDATE tickets SET status = 'waiting_customer' WHERE id = '${tk.id}'`);
    try {
      await expect(
        transitionTicket(env, t.db, T1, ACTOR, tk.id, 'resolved', undefined, 'c'),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }

    expect(await eventTypes()).toEqual([]);
    expect(await envStatus()).toBe('incident');
  });

  test('chamado de outro tenant é 404', async () => {
    const tk = await open();
    await expect(
      transitionTicket(env, t.db, T2, ACTOR, tk.id, 'in_progress', undefined, 'c'),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('duas atribuições simultâneas: as duas entradas ficam na linha do tempo', async () => {
    const tk = await open('sev3', null);
    await Promise.all([
      assignTicket(t.db, T1, ACTOR, tk.id, '00000000-0000-4000-8000-0000000000c1'),
      assignTicket(t.db, T1, ACTOR, tk.id, '00000000-0000-4000-8000-0000000000c2'),
    ]);
    const { rows } = await t.pg.query<{ n: number }>(
      `SELECT jsonb_array_length(timeline)::int AS n FROM tickets WHERE id = '${tk.id}'`,
    );
    expect(rows[0]!.n).toBe(3); // criação + 2 atribuições
  });
});

describe('apuração de SLA', () => {
  const MONTH = '2026-07-01';
  const JULY_MIN = 31 * 24 * 60;
  const fee = { amountMinor: 1_500_000, currency: 'BRL' };

  const sev1 = async (n: number, from: string, to: string | null, paused = 0, sev = 'sev1') => {
    await t.pg.query(
      `INSERT INTO tickets (id, tenant_id, number, subject, severity, status, environment_id, environment_code,
         opened_at, resolved_at, response_due_at, paused_minutes)
       VALUES ($1,$2,$3,'Queda',$4,$5,$6,'amb-prod-01',$7,$8,$7,$9)`,
      [crypto.randomUUID(), T1, n, sev, to ? 'closed' : 'in_progress', ENV, from, to, paused],
    );
  };
  const reckon = () =>
    reckonSla(t.db, T1, ACTOR, { month: MONTH, environmentId: ENV, monthlyFee: fee } as never, 'c');

  test('um incidente de 12 h: mede o mês inteiro, 720 min fora, e o crédito vem do contrato', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T14:00:00Z');
    const p = await reckon();
    expect(p.measuredMinutes).toBe(JULY_MIN);
    expect(p.downtimeMinutes).toBe(720);
    expect(p.achievedBps).toBe(computeAvailabilityBps(JULY_MIN, 720));
    expect(p.breached).toBe(true);
    expect(p.credit).toEqual({
      amountMinor: computeSlaCredit(p.achievedBps, 9950, fee.amountMinor),
      currency: 'BRL',
    });
    expect(p.credit!.amountMinor).toBeGreaterThan(0);
    expect(await eventTypes()).toEqual(['operations.sla.breached']);
  });

  test('incidentes sobrepostos contam uma vez: 02-10 e 08-14 dão 720, e não 840', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T10:00:00Z');
    await sev1(2, '2026-07-14T08:00:00Z', '2026-07-14T14:00:00Z');
    expect((await reckon()).downtimeMinutes).toBe(720);
  });

  test('incidente que atravessa a virada do mês é recortado ao mês', async () => {
    await sev1(1, '2026-06-30T22:00:00Z', '2026-07-01T02:00:00Z');
    expect((await reckon()).downtimeMinutes).toBe(120);
  });

  test('incidente ainda aberto conta até o fim do mês', async () => {
    await sev1(1, '2026-07-31T00:00:00Z', null);
    expect((await reckon()).downtimeMinutes).toBe(24 * 60);
  });

  test('a pausa (aguardando o cliente) é descontada', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T04:00:00Z', 30);
    expect((await reckon()).downtimeMinutes).toBe(90);
  });

  test('só sev1 conta; sev2 e sev3 não geram indisponibilidade', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T14:00:00Z', 0, 'sev2');
    const p = await reckon();
    expect(p.downtimeMinutes).toBe(0);
    expect(p.breached).toBe(false);
  });

  test('janela programada sai do denominador, e não vira indisponibilidade', async () => {
    await t.pg.exec(`UPDATE environments SET next_window =
      '{"startsAt":"2026-07-10T00:00:00Z","endsAt":"2026-07-10T10:00:00Z"}'::jsonb WHERE id = '${ENV}'`);
    const p = await reckon();
    expect(p.measuredMinutes).toBe(JULY_MIN - 600);
    expect(p.downtimeMinutes).toBe(0);
  });

  test('dentro da meta: não há descumprimento, crédito nem evento', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T03:40:00Z'); // 100 min < 0,5% do mês
    const p = await reckon();
    expect(p.breached).toBe(false);
    expect(p.credit).toBeNull();
    expect(await eventTypes()).toEqual([]);
  });

  test('apurar de novo devolve a mesma apuração, sem segunda linha nem segundo evento', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T14:00:00Z');
    const first = await reckon();
    // Muda o mundo depois: a prova não pode mudar.
    await sev1(2, '2026-07-20T00:00:00Z', '2026-07-20T10:00:00Z');
    const second = await reckon();
    expect(second).toEqual(first);
    expect(await count('sla_periods')).toBe(1);
    expect(await eventTypes()).toEqual(['operations.sla.breached']);
  });

  test('duas apurações simultâneas do mesmo mês: uma linha, um evento, nenhum erro', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T14:00:00Z');
    const [a, b] = await Promise.all([reckon(), reckon()]);
    expect(a.environmentId).toBe(b.environmentId);
    expect(await count('sla_periods')).toBe(1);
    expect(await count(`outbox WHERE type = 'operations.sla.breached'`)).toBe(1);
  });

  test('se o outbox falha, a apuração não fica gravada', async () => {
    await sev1(1, '2026-07-14T02:00:00Z', '2026-07-14T14:00:00Z');
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (false)`);
    await expect(reckon()).rejects.toThrow(/boom/);
    expect(await count('sla_periods')).toBe(0);
  });

  test('ambiente de outro tenant é 404', async () => {
    await expect(
      reckonSla(t.db, T2, ACTOR, { month: MONTH, environmentId: ENV, monthlyFee: fee } as never, 'c'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('ambientes', () => {
  test('código repetido é 409; em outro tenant é aceito', async () => {
    const dto = {
      code: 'amb-x', name: 'X', kind: 'staging', availabilityTargetBps: 9900,
      responseTargetMinutes: { sev1: 15, sev2: 60, sev3: 480 }, tags: ['a'],
    } as never;
    await createEnvironment(t.db, T1, ACTOR, dto);
    await expect(createEnvironment(t.db, T1, ACTOR, dto)).rejects.toMatchObject({ status: 409 });
    await expect(createEnvironment(t.db, T2, ACTOR, dto)).resolves.toBeDefined();
  });

  test('tags voltam como array, e não como texto', async () => {
    const e = await createEnvironment(t.db, T1, ACTOR, {
      code: 'amb-y', name: 'Y', kind: 'staging', availabilityTargetBps: 9900,
      responseTargetMinutes: { sev1: 15, sev2: 60, sev3: 480 }, tags: ['a', 'b'],
    } as never);
    expect(e.tags).toEqual(['a', 'b']);
    expect((await findEnvironmentRow(t.db, T2, e.id))).toBeNull();
  });
});

describe('listagem e varredura', () => {
  test('filtro breached pega o chamado vencido sem resposta', async () => {
    const tk = await open('sev3', null);
    await t.pg.exec(`UPDATE tickets SET response_due_at = now() - interval '1 hour' WHERE id = '${tk.id}'`);
    await open('sev3', null);
    const { rows } = await listTickets(t.db, T1, { breached: true } as never, { limit: 10 } as never);
    expect(rows.map((r) => r.id)).toEqual([tk.id]);
  });

  test('a varredura marca o vencido e não toca em quem já respondeu ou foi cancelado', async () => {
    const a = await open('sev3', null);
    const b = await open('sev3', null);
    const c = await open('sev3', null);
    await t.pg.exec(`UPDATE tickets SET response_due_at = now() - interval '1 hour'`);
    await t.pg.exec(`UPDATE tickets SET first_response_at = now() WHERE id = '${b.id}'`);
    await t.pg.exec(`UPDATE tickets SET status = 'cancelled' WHERE id = '${c.id}'`);

    expect(await markBreachedResponses(t.db)).toBe(1);
    const { rows } = await t.pg.query<{ id: string; response_breached: boolean }>(
      `SELECT id, response_breached FROM tickets`,
    );
    expect(rows.find((r) => r.id === a.id)!.response_breached).toBe(true);
    expect(rows.filter((r) => r.response_breached)).toHaveLength(1);
    expect(await markBreachedResponses(t.db)).toBe(0); // idempotente
  });

  test('paginação por cursor, com carimbos iguais, devolve cada chamado uma vez', async () => {
    for (let i = 0; i < 5; i++) await open('sev3', null);
    await t.pg.exec(`UPDATE tickets SET created_at = '2026-03-01T10:00:00.123Z'`);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listTickets(t.db, T1, {}, { limit: 2, cursor } as never);
      seen.push(...page.rows.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });

  test('busca por texto: prefixo e sem acento', async () => {
    await createTicket(
      env, t.db, T1, ACTOR,
      { subject: 'Latência elevada', description: '', kind: 'incident', severity: 'sev3', environmentId: null } as never,
      'c',
    );
    const find = async (q: string) =>
      (await listTickets(t.db, T1, { q } as never, { limit: 10 } as never)).rows.length;
    expect(await find('latencia')).toBe(1);
    expect(await find('ELEV')).toBe(1);
    expect(await find('nada')).toBe(0);
    expect(searchQuery("x' | !y")).toBe('x:* & y:*');
  });
});

describe('relay do outbox', () => {
  test('publica no financeiro e marca como publicado; falha conta a tentativa', async () => {
    await open();
    const ok = { send: vi.fn().mockResolvedValue(undefined) };
    await drainOutbox({ QUEUE_FINANCIAL: ok } as never, t.db);
    expect(ok.send.mock.calls[0]![0]).toMatchObject({ type: 'operations.incident.opened', tenantId: T1 });
    expect(await count('outbox WHERE published_at IS NULL')).toBe(0);

    await t.pg.exec(`UPDATE outbox SET published_at = NULL`);
    const bad = { send: vi.fn().mockRejectedValue(new Error('fila fora')) };
    await drainOutbox({ QUEUE_FINANCIAL: bad } as never, t.db);
    const { rows } = await t.pg.query<{ attempts: number }>(`SELECT attempts FROM outbox`);
    expect(rows[0]!.attempts).toBe(1);
  });
});
