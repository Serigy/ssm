import type { CreateEmployee } from '@ssm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// A numeração vem do Durable Object, que não existe aqui: o corpo recebe o
// próximo número e o resto da transação é o código de verdade.
vi.mock('@ssm/worker-common', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ssm/worker-common')>();
  let n = 0;
  return {
    ...real,
    withReservedNumber: async (
      _env: unknown,
      _tenant: string,
      _seq: string,
      seed: number,
      body: (v: number) => Promise<unknown>,
    ) => body(Math.max(seed, n++) + 1),
  };
});

import {
  activateEmployee,
  createEmployee,
  offboardEmployee,
  terminateOverdue,
} from './commands.js';
import { drainOutbox } from './index.js';
import { decryptPii } from './pii.js';
import { findEmployeeRow, listEmployees, searchQuery } from './queries.js';
import { openTestDb, type TestDb } from './test-db.js';

const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';
const ACTOR = '00000000-0000-4000-8000-0000000000b1';

// Chave e "CPF" sintéticos: nada aqui é dado de pessoa.
const KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const FAKE_ID = 'documento-sintetico-0001';
const env = { PII_ENCRYPTION_KEY: KEY } as never;

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.pg.exec('DELETE FROM outbox; DELETE FROM employees;');
  // Tira qualquer constraint de sabotagem deixada por um teste anterior.
  await t.pg.exec(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS boom;
                   ALTER TABLE outbox DROP CONSTRAINT IF EXISTS boom;`);
});

let seq = 0;
const dto = (over: Partial<CreateEmployee> = {}): CreateEmployee =>
  ({
    firstName: 'Ana',
    lastName: 'Teste',
    workEmail: `ana${++seq}@serigy.local`,
    contractType: 'permanent',
    jobTitle: 'Analista',
    startDate: '2026-01-05',
    ...over,
  }) as CreateEmployee;

const count = async (sql: string) =>
  ((await t.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0]!.n);

describe('PII: o banco só recebe o texto cifrado', () => {
  test('o CPF é gravado cifrado e volta decifrado', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto({ nationalId: FAKE_ID }));
    const row = await findEmployeeRow(t.db, T1, e.id);

    expect(row!.national_id_enc).not.toBeNull();
    expect(row!.national_id_enc).not.toContain(FAKE_ID);
    expect(await decryptPii(env, row!.national_id_enc, e.id)).toBe(FAKE_ID);
    expect(e.nationalId).toBe(FAKE_ID);
  });

  test('nenhum texto em claro fica em nenhuma coluna da linha', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto({ nationalId: FAKE_ID }));
    const { rows } = await t.pg.query<{ raw: string }>(
      `SELECT employees::text AS raw FROM employees WHERE id = $1`,
      [e.id],
    );
    expect(rows[0]!.raw).not.toContain(FAKE_ID);
  });

  test('o banco recusa um valor em claro, mesmo gravado por fora do Worker', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    await expect(
      t.pg.query(`UPDATE employees SET national_id_enc = $1 WHERE id = $2`, [FAKE_ID, e.id]),
    ).rejects.toThrow(/national_id_cipher/);
  });
});

describe('outbox e mudança de domínio são uma transação', () => {
  async function onboarding() {
    return createEmployee(env, t.db, T1, ACTOR, dto());
  }

  test('ativar grava a mudança e o evento juntos', async () => {
    const e = await onboarding();
    await activateEmployee(env, t.db, T1, ACTOR, e.id, 'corr-1');

    expect((await findEmployeeRow(t.db, T1, e.id))!.status).toBe('active');
    const { rows } = await t.pg.query<{ type: string; payload: { employeeId: string } }>(
      `SELECT type, payload FROM outbox`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('hr.employee.activated');
    expect(rows[0]!.payload.employeeId).toBe(e.id);
  });

  test('se o INSERT do outbox falha, a mudança de situação é desfeita', async () => {
    const e = await onboarding();
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (false)`);

    await expect(activateEmployee(env, t.db, T1, ACTOR, e.id, 'corr-1')).rejects.toThrow(/boom/);

    expect((await findEmployeeRow(t.db, T1, e.id))!.status).toBe('onboarding');
    expect(await count('outbox')).toBe(0);
  });

  test('se o UPDATE do colaborador falha, nenhum evento é gravado', async () => {
    const e = await onboarding();
    await t.pg.exec(`ALTER TABLE employees ADD CONSTRAINT boom CHECK (status <> 'active')`);

    await expect(activateEmployee(env, t.db, T1, ACTOR, e.id, 'corr-1')).rejects.toThrow(/boom/);

    expect(await count('outbox')).toBe(0);
    expect((await findEmployeeRow(t.db, T1, e.id))!.status).toBe('onboarding');
  });

  test('quem perde a corrida recebe 409 e nenhum evento fantasma é gravado', async () => {
    const e = await onboarding();
    // Outra pessoa já moveu a situação depois da leitura: simulado fazendo a
    // leitura enxergar "onboarding" e o UPDATE encontrar outra coisa.
    const real = t.db.prepare.bind(t.db);
    let first = true;
    const racing = {
      ...t.db,
      prepare: (sql: string) => {
        const s = real(sql);
        if (first && sql.startsWith('SELECT * FROM employees')) {
          first = false;
          return {
            ...s,
            bind: (...v: unknown[]) => ({
              ...s.bind(...v),
              first: async () => {
                const row = await s.bind(...v).first();
                await t.pg.exec(`UPDATE employees SET status = 'on_leave' WHERE id = '${e.id}'`);
                return row;
              },
            }),
          } as never;
        }
        return s;
      },
    };

    await expect(
      activateEmployee(env, racing as never, T1, ACTOR, e.id, 'corr-1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(await count('outbox')).toBe(0);
  });

  test('desligar com data futura vai a offboarding e emite o evento com o estado', async () => {
    const e = await onboarding();
    const out = await offboardEmployee(
      env, t.db, T1, ACTOR, e.id, { lastDay: '2999-12-31', reason: 'resignation' }, 'corr-2',
    );
    expect(out.status).toBe('offboarding');
    const { rows } = await t.pg.query<{ payload: { status: string; lastDay: string } }>(
      `SELECT payload FROM outbox WHERE type = 'hr.employee.offboarded'`,
    );
    expect(rows[0]!.payload).toMatchObject({ status: 'offboarding', lastDay: '2999-12-31' });
  });

  test('desligar duas vezes: a segunda é 409 e não gera segundo evento', async () => {
    const e = await onboarding();
    const body = { lastDay: '2026-02-01', reason: 'termination' as const };
    await offboardEmployee(env, t.db, T1, ACTOR, e.id, body, 'c');
    await expect(
      offboardEmployee(env, t.db, T1, ACTOR, e.id, body, 'c'),
    ).rejects.toMatchObject({ status: 409 });
    expect(await count('outbox')).toBe(1);
  });

  test('último dia anterior à admissão é 400, sem tocar no banco', async () => {
    const e = await onboarding();
    await expect(
      offboardEmployee(env, t.db, T1, ACTOR, e.id, { lastDay: '2025-01-01', reason: 'resignation' }, 'c'),
    ).rejects.toMatchObject({ status: 400 });
    expect(await count('outbox')).toBe(0);
  });
});

describe('estado do colaborador protegido no banco', () => {
  test('um desligado sem último dia é recusado pelo CHECK, mesmo por UPDATE manual', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    await expect(
      t.pg.query(`UPDATE employees SET status = 'terminated' WHERE id = $1`, [e.id]),
    ).rejects.toThrow(/terminated_end/);
  });

  test('status fora da lista é recusado', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    await expect(
      t.pg.query(`UPDATE employees SET status = 'ferias' WHERE id = $1`, [e.id]),
    ).rejects.toThrow(/status_ck/);
  });

  test('a rotina diária promove quem chegou ao último dia, e só ele', async () => {
    const past = await createEmployee(env, t.db, T1, ACTOR, dto());
    const future = await createEmployee(env, t.db, T1, ACTOR, dto());
    await offboardEmployee(env, t.db, T1, ACTOR, past.id, { lastDay: '2999-01-01', reason: 'retirement' }, 'c');
    await offboardEmployee(env, t.db, T1, ACTOR, future.id, { lastDay: '2999-01-01', reason: 'retirement' }, 'c');
    await t.pg.exec(`UPDATE employees SET end_date = '2026-01-06' WHERE id = '${past.id}'`);

    expect(await terminateOverdue(t.db)).toBe(1);
    expect((await findEmployeeRow(t.db, T1, past.id))!.status).toBe('terminated');
    expect((await findEmployeeRow(t.db, T1, future.id))!.status).toBe('offboarding');
  });
});

describe('tenant e unicidade', () => {
  test('colaborador de outro tenant é invisível', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    expect(await findEmployeeRow(t.db, T2, e.id)).toBeNull();
    const { rows } = await listEmployees(t.db, T2, {}, { limit: 10 } as never);
    expect(rows).toHaveLength(0);
  });

  test('ativar colaborador de outro tenant é 404', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    await expect(activateEmployee(env, t.db, T2, ACTOR, e.id, 'c')).rejects.toMatchObject({
      status: 404,
    });
  });

  test('e-mail repetido no tenant é 409; em outro tenant é aceito', async () => {
    await createEmployee(env, t.db, T1, ACTOR, dto({ workEmail: 'Dup@serigy.local' }));
    await expect(
      createEmployee(env, t.db, T1, ACTOR, dto({ workEmail: 'dup@SERIGY.local' })),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createEmployee(env, t.db, T2, ACTOR, dto({ workEmail: 'dup@serigy.local' })),
    ).resolves.toBeDefined();
  });

  test('duas admissões simultâneas com o mesmo e-mail: uma passa, a outra é 409', async () => {
    const same = dto({ workEmail: 'corrida@serigy.local' });
    const r = await Promise.allSettled([
      createEmployee(env, t.db, T1, ACTOR, same),
      createEmployee(env, t.db, T1, ACTOR, same),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
  });
});

describe('listagem', () => {
  test('a paginação por cursor devolve cada colaborador exatamente uma vez', async () => {
    for (let i = 0; i < 5; i++) await createEmployee(env, t.db, T1, ACTOR, dto());
    // Mesmo carimbo em todos: o desempate pelo id é o que garante a ordem.
    await t.pg.exec(`UPDATE employees SET created_at = '2026-03-01T10:00:00.123Z'`);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listEmployees(t.db, T1, {}, { limit: 2, cursor } as never);
      seen.push(...page.rows.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test('busca por prefixo, sem acento e sem diferenciar caixa', async () => {
    await createEmployee(env, t.db, T1, ACTOR, dto({ firstName: 'Álvaro', lastName: 'Cândido' }));
    await createEmployee(env, t.db, T1, ACTOR, dto({ firstName: 'Beatriz', lastName: 'Lima' }));
    const find = async (q: string) =>
      (await listEmployees(t.db, T1, { q }, { limit: 10 } as never)).rows.map((r) => r.first_name);

    expect(await find('alvaro')).toEqual(['Álvaro']);
    expect(await find('CAND')).toEqual(['Álvaro']);
    expect(await find('beat lim')).toEqual(['Beatriz']);
    expect(await find('serigy')).toHaveLength(2); // domínio do e-mail
    expect(await find('inexistente')).toEqual([]);
  });

  test('searchQuery: só letras e dígitos viram termo; operador de tsquery não passa', () => {
    expect(searchQuery("Álvaro & (x) | !y:* 'z")).toBe('alvaro:* & x:* & y:* & z:*');
    expect(searchQuery('   ')).toBeNull();
    expect(searchQuery("'''")).toBeNull();
  });
});

describe('relay do outbox', () => {
  const queue = () => ({ send: vi.fn().mockResolvedValue(undefined) });

  test('publica nas duas filas e marca como publicado', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    await activateEmployee(env, t.db, T1, ACTOR, e.id, 'c');
    const fin = queue();
    const leg = queue();

    await drainOutbox({ QUEUE_FINANCIAL: fin, QUEUE_LEGAL: leg } as never, t.db);

    expect(fin.send).toHaveBeenCalledOnce();
    expect(leg.send).toHaveBeenCalledOnce();
    expect(fin.send.mock.calls[0]![0]).toMatchObject({
      type: 'hr.employee.activated',
      data: { employeeId: e.id },
      tenantId: T1,
    });
    expect(await count('outbox WHERE published_at IS NULL')).toBe(0);
  });

  test('falha de fila conta a tentativa, guarda o erro e mantém o evento', async () => {
    const e = await createEmployee(env, t.db, T1, ACTOR, dto());
    await activateEmployee(env, t.db, T1, ACTOR, e.id, 'c');
    const bad = { send: vi.fn().mockRejectedValue(new Error('fila fora')) };

    await drainOutbox({ QUEUE_FINANCIAL: bad, QUEUE_LEGAL: queue() } as never, t.db);

    const { rows } = await t.pg.query<{ attempts: number; last_error: string; published_at: unknown }>(
      `SELECT attempts, last_error, published_at FROM outbox`,
    );
    expect(rows[0]).toMatchObject({ attempts: 1, published_at: null });
    expect(rows[0]!.last_error).toContain('fila fora');
  });
});
