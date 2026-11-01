import { computeTotals } from '@ssm/contracts';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Coordinator } from '@ssm/worker-common';
import {
  createInvoice,
  deleteDraft,
  issueInvoice,
  recordPayment,
  updateInvoice,
  voidInvoice,
} from './commands.js';
import { drainOutbox, handleEvent, type QueueEvent } from './index.js';
import { findInvoice, listInvoices, searchQuery } from './queries.js';
import { openTestDb, type TestDb } from './test-db.js';

const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';
const ACTOR = '00000000-0000-4000-8000-0000000000b1';
const CP = '00000000-0000-4000-8000-0000000000c1';

/**
 * O Coordinator de verdade (a numeração sem buracos é dele), sobre um
 * armazenamento em memória, atrás de um binding falso. Nada de mock de
 * numeração: o teste de "sem lacuna" precisa do contrato real de conceder,
 * confirmar e devolver.
 */
function fakeCoordinatorNamespace() {
  const objects = new Map<string, Coordinator>();
  const make = () => {
    const map = new Map<string, unknown>();
    let alarm: number | null = null;
    const state = {
      storage: {
        get: async (k: string) => map.get(k),
        put: async (k: string, v: unknown) => void map.set(k, structuredClone(v)),
        delete: async (k: string) => void map.delete(k),
        list: async () => new Map(map),
        getAlarm: async () => alarm,
        setAlarm: async (at: number) => void (alarm = at),
      },
    };
    return new Coordinator(state as never, {} as never);
  };
  return {
    idFromName: (n: string) => n,
    get: (n: string) => {
      if (!objects.has(n)) objects.set(n, make());
      return { fetch: (url: string, init?: RequestInit) => objects.get(n)!.fetch(new Request(url, init)) };
    },
  };
}

let t: TestDb;
let env: never;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  env = { COORDINATOR: fakeCoordinatorNamespace() } as never;
  await t.pg.exec(`
    ALTER TABLE outbox DROP CONSTRAINT IF EXISTS boom;
    DELETE FROM outbox; DELETE FROM processed_events; DELETE FROM invoices;
  `);
});

const count = async (sql: string) =>
  (await t.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0]!.n;
const events = async () =>
  (await t.pg.query<{ type: string }>(`SELECT type FROM outbox ORDER BY created_at, type`)).rows.map((r) => r.type);

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

const lines = (n = 1) =>
  Array.from({ length: n }, (_, i) => ({
    description: `Item ${i + 1}`,
    quantityMilli: 1500, // 1,5 unidade
    unitPrice: { amountMinor: 10_001, currency: 'BRL' },
    taxRateBps: 500,
  }));

const draft = (over: Record<string, unknown> = {}) =>
  createInvoice(t.db, T1, ACTOR, {
    counterpartyId: CP,
    counterpartyName: 'Prefeitura de Aracaju',
    dueDate: '2026-12-31',
    currency: 'brl',
    lines: lines(2),
    ...over,
  } as never);

const issued = async () => {
  const d = await draft();
  return issueInvoice(env, t.db, T1, ACTOR, d.id, 'corr');
};

describe('dinheiro: inteiro, sem segundo ponto de arredondamento', () => {
  test('os totais gravados são exatamente os de computeTotals', async () => {
    const d = await draft({ lines: lines(3) });
    const expected = computeTotals(lines(3) as never);
    expect(d.subtotal.amountMinor).toBe(expected.subtotalMinor);
    expect(d.taxTotal.amountMinor).toBe(expected.taxTotalMinor);
    expect(d.total.amountMinor).toBe(expected.totalMinor);
    expect(d.lines.map((l) => l.lineTotal.amountMinor)).toEqual(expected.lines.map((l) => l.lineTotalMinor));
    expect(Number.isInteger(d.total.amountMinor)).toBe(true);
    expect(d.currency).toBe('BRL'); // normalizada para maiúsculas
  });

  test('o banco confere a soma: total diferente de subtotal + imposto é recusado', async () => {
    const d = await draft();
    await expect(
      t.pg.query(`UPDATE invoices SET total_minor = total_minor + 1 WHERE id = $1`, [d.id]),
    ).rejects.toThrow(/total_sum/);
  });

  test('guarda: o código do financeiro não arredonda nem usa ponto flutuante', () => {
    for (const f of ['commands.ts', 'queries.ts', 'index.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');
      expect(src, f).not.toMatch(/Math\.(round|floor|ceil|trunc)|toFixed|parseFloat|\bfloat\b|numeric/i);
    }
  });

  test('criação é atômica: uma linha inválida desfaz a fatura inteira', async () => {
    await expect(
      draft({ lines: [{ ...lines(1)[0]!, quantityMilli: 0 }] }),
    ).rejects.toThrow(/quantity/);
    expect(await count('invoices')).toBe(0);
    expect(await count('invoice_lines')).toBe(0);
  });
});

describe('emissão: número sem lacuna, e CAS por versão', () => {
  test('emite com número sequencial do ano e grava o evento junto', async () => {
    const a = await issued();
    const b = await issued();
    const year = new Date().getUTCFullYear();
    expect(a.number).toBe(`FAT-${year}-00001`);
    expect(b.number).toBe(`FAT-${year}-00002`);
    expect(a.status).toBe('issued');
    expect(a.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await events()).toEqual(['financial.invoice.issued', 'financial.invoice.issued']);
  });

  test('quem perde a corrida de versão recebe 409, devolve o número e não grava evento', async () => {
    const d = await draft();
    const restore = raceAfterRead('SELECT version, status FROM invoices', `UPDATE invoices SET version = version + 1`);
    try {
      await expect(issueInvoice(env, t.db, T1, ACTOR, d.id, 'c')).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect(await events()).toEqual([]);
    expect((await findInvoice(t.db, T1, d.id))!.status).toBe('draft');

    // O número não foi queimado: a próxima emissão pega o 00001, sem buraco.
    const next = await issueInvoice(env, t.db, T1, ACTOR, d.id, 'c');
    expect(next.number).toBe(`FAT-${new Date().getUTCFullYear()}-00001`);
  });

  test('se o outbox falha, a emissão é desfeita e o número volta', async () => {
    const d = await draft();
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (false)`);
    await expect(issueInvoice(env, t.db, T1, ACTOR, d.id, 'c')).rejects.toThrow(/boom/);
    expect((await findInvoice(t.db, T1, d.id))!.status).toBe('draft');

    await t.pg.exec(`ALTER TABLE outbox DROP CONSTRAINT boom`);
    expect((await issueInvoice(env, t.db, T1, ACTOR, d.id, 'c')).number).toMatch(/-00001$/);
  });

  test('só rascunho emite; outro tenant vê 404', async () => {
    const a = await issued();
    await expect(issueInvoice(env, t.db, T1, ACTOR, a.id, 'c')).rejects.toMatchObject({ status: 409 });
    const d = await draft();
    await expect(issueInvoice(env, t.db, T2, ACTOR, d.id, 'c')).rejects.toMatchObject({ status: 404 });
  });

  test('o banco recusa fatura emitida sem número, mesmo por UPDATE manual', async () => {
    const a = await issued();
    await expect(
      t.pg.query(`UPDATE invoices SET number = NULL WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/issued_has_number/);
  });
});

describe('pagamento: CAS, soma exata, evento junto', () => {
  const pay = (id: string, amountMinor: number, currency = 'BRL') =>
    recordPayment(t.db, T1, ACTOR, id, { amount: { amountMinor, currency }, paidAt: '2026-11-01T10:00:00Z' } as never, 'c');

  test('parcial e depois total: situação, saldo e eventos corretos', async () => {
    const a = await issued();
    const total = a.total.amountMinor;
    const p1 = await pay(a.id, 1000);
    expect(p1.status).toBe('partially_paid');
    expect(p1.amountPaid.amountMinor).toBe(1000);
    const p2 = await pay(a.id, total - 1000);
    expect(p2.status).toBe('paid');
    expect(p2.amountPaid.amountMinor).toBe(total);
    // Ordem de gravação é do relógio; o que importa é o conjunto, um por fato.
    expect((await events()).sort()).toEqual([
      'financial.invoice.issued',
      'financial.invoice.paid',
      'financial.invoice.partially_paid',
    ]);
  });

  test('pagar a mais, em outra moeda ou valor não positivo é recusado sem tocar no banco', async () => {
    const a = await issued();
    await expect(pay(a.id, a.total.amountMinor + 1)).rejects.toMatchObject({ status: 400 });
    await expect(pay(a.id, 100, 'USD')).rejects.toMatchObject({ status: 400 });
    await expect(pay(a.id, 0)).rejects.toMatchObject({ status: 400 });
    expect((await findInvoice(t.db, T1, a.id))!.amountPaid.amountMinor).toBe(0);
  });

  test('o banco recusa pago acima do total e situação incoerente com o valor', async () => {
    const a = await issued();
    await expect(
      t.pg.query(`UPDATE invoices SET amount_paid_minor = total_minor + 1 WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/paid_range/);
    await expect(
      t.pg.query(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/paid_status/);
    await expect(
      t.pg.query(`UPDATE invoices SET status = 'partially_paid' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/paid_status/);
  });

  test('perder a corrida de versão: 409, saldo intacto e nenhum evento de pagamento', async () => {
    const a = await issued();
    await t.pg.exec('DELETE FROM outbox');
    const restore = raceAfterRead('SELECT version, status FROM invoices', `UPDATE invoices SET version = version + 1`);
    try {
      await expect(pay(a.id, 500)).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect((await findInvoice(t.db, T1, a.id))!.amountPaid.amountMinor).toBe(0);
    expect(await events()).toEqual([]);
  });

  test('dois pagamentos simultâneos que juntos excedem o total: nunca passa do total', async () => {
    const a = await issued();
    const total = a.total.amountMinor;
    const half = Math.ceil(total / 2) + 1; // dois juntos excedem
    const r = await Promise.allSettled([pay(a.id, half), pay(a.id, half)]);

    const final = (await findInvoice(t.db, T1, a.id))!;
    expect(final.amountPaid.amountMinor).toBeLessThanOrEqual(total);
    const ok = r.filter((x) => x.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect(await count(`outbox WHERE type LIKE 'financial.invoice.%paid'`)).toBe(1);
  });

  test('pagamento em fatura de rascunho ou cancelada é 409', async () => {
    const d = await draft();
    await expect(pay(d.id, 100)).rejects.toMatchObject({ status: 409 });
  });
});

describe('cancelar e excluir', () => {
  test('cancelar uma emitida: situação e evento juntos, número mantido', async () => {
    const a = await issued();
    const v = await voidInvoice(t.db, T1, ACTOR, a.id, 'erro de digitação', 'c');
    expect(v.status).toBe('void');
    expect(v.number).toBe(a.number);
    expect(await events()).toContain('financial.invoice.voided');
  });

  test('rascunho não se cancela; paga não se cancela; cancelada não se cancela de novo', async () => {
    const d = await draft();
    await expect(voidInvoice(t.db, T1, ACTOR, d.id, 'x', 'c')).rejects.toMatchObject({ status: 409 });
    const a = await issued();
    await recordPayment(
      t.db, T1, ACTOR, a.id,
      { amount: { amountMinor: a.total.amountMinor, currency: 'BRL' }, paidAt: '2026-11-01T00:00:00Z' } as never, 'c',
    );
    await expect(voidInvoice(t.db, T1, ACTOR, a.id, 'x', 'c')).rejects.toMatchObject({ status: 409 });
  });

  test('cancelar perdendo a corrida não deixa evento', async () => {
    const a = await issued();
    await t.pg.exec('DELETE FROM outbox');
    const restore = raceAfterRead('SELECT version, status FROM invoices', `UPDATE invoices SET version = version + 1`);
    try {
      await expect(voidInvoice(t.db, T1, ACTOR, a.id, 'x', 'c')).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect(await events()).toEqual([]);
    expect((await findInvoice(t.db, T1, a.id))!.status).toBe('issued');
  });

  test('excluir rascunho apaga as linhas em cascata; emitida não se exclui', async () => {
    const d = await draft();
    await deleteDraft(t.db, T1, d.id);
    expect(await count('invoices')).toBe(0);
    expect(await count('invoice_lines')).toBe(0);

    const a = await issued();
    await expect(deleteDraft(t.db, T1, a.id)).rejects.toMatchObject({ status: 409 });
  });

  test('uma emissão que vence a corrida não tem a fatura apagada pelo DELETE', async () => {
    const d = await draft();
    const restore = raceAfterRead(
      'SELECT version, status FROM invoices',
      `UPDATE invoices SET status = 'issued', number = 'FAT-X-1', issue_date = '2026-11-01', version = version + 1`,
    );
    try {
      await expect(deleteDraft(t.db, T1, d.id)).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect(await count('invoices')).toBe(1);
  });
});

describe('edição do rascunho', () => {
  test('troca as linhas e recalcula os totais com computeTotals', async () => {
    const d = await draft();
    const novo = lines(3);
    const u = await updateInvoice(t.db, T1, ACTOR, d.id, { lines: novo } as never);
    expect(u.lines).toHaveLength(3);
    expect(u.total.amountMinor).toBe(computeTotals(novo as never).totalMinor);
    expect(await count('invoice_lines')).toBe(3);
  });

  test('perder a corrida de versão não mexe nas linhas do outro editor', async () => {
    const d = await draft({ lines: lines(2) });
    const restore = raceAfterRead('SELECT version, status FROM invoices', `UPDATE invoices SET version = version + 1`);
    try {
      await expect(
        updateInvoice(t.db, T1, ACTOR, d.id, { lines: lines(5) } as never),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    // Antes (batch do D1) as 2 linhas eram apagadas e 5 reinseridas mesmo assim.
    expect(await count('invoice_lines')).toBe(2);
  });

  test('emitida não se edita', async () => {
    const a = await issued();
    await expect(updateInvoice(t.db, T1, ACTOR, a.id, { notes: 'x' } as never)).rejects.toMatchObject({ status: 409 });
  });

  test('linha inválida no meio da troca desfaz a edição inteira', async () => {
    const d = await draft({ lines: lines(2) });
    await expect(
      updateInvoice(t.db, T1, ACTOR, d.id, {
        lines: [lines(1)[0], { ...lines(1)[0]!, quantityMilli: 0 }],
      } as never),
    ).rejects.toThrow(/quantity/);
    expect(await count('invoice_lines')).toBe(2);
    expect((await findInvoice(t.db, T1, d.id))!.total.amountMinor).toBe(computeTotals(lines(2) as never).totalMinor);
  });
});

describe('consulta', () => {
  test('outro tenant não vê a fatura', async () => {
    const d = await draft();
    expect(await findInvoice(t.db, T2, d.id)).toBeNull();
    expect((await listInvoices(t.db, T2, {}, { limit: 10 } as never)).items).toEqual([]);
  });

  test('busca por prefixo e sem acento; filtro por vencimento', async () => {
    await draft({ counterpartyName: 'São Paulo Serviços' });
    await draft({ counterpartyName: 'Outra Empresa', dueDate: '2027-06-01' });
    const find = async (f: object) => (await listInvoices(t.db, T1, f as never, { limit: 10 } as never)).items.length;
    expect(await find({ q: 'sao paulo' })).toBe(1);
    expect(await find({ q: 'outr' })).toBe(1);
    expect(await find({ dueBefore: '2026-12-31' })).toBe(1);
    expect(await find({ dueAfter: '2027-01-01' })).toBe(1);
    expect(searchQuery("a' | b")).toBe('a:* & b:*');
  });

  test('paginação por cursor com carimbos iguais devolve cada fatura uma vez, com suas linhas', async () => {
    for (let i = 0; i < 5; i++) await draft();
    await t.pg.exec(`UPDATE invoices SET created_at = '2026-03-01T10:00:00.123Z'`);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let g = 0; g < 10; g++) {
      const p = await listInvoices(t.db, T1, {}, { limit: 2, cursor } as never);
      for (const i of p.items) expect(i.lines).toHaveLength(2);
      seen.push(...p.items.map((i) => i.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });
});

describe('consumo idempotente de eventos', () => {
  const ev = (id = 'ev-1', type = 'operations.sla.breached'): QueueEvent => ({
    id,
    type,
    data: { credit: { amountMinor: 100, currency: 'BRL' } },
    tenantId: T1,
    correlationId: 'c',
  });
  const marks = () => count('processed_events');

  test('a primeira entrega aplica o efeito; a reentrega não o repete', async () => {
    const effect = vi.fn().mockResolvedValue(undefined);
    expect(await handleEvent(t.db, ev(), effect)).toBe('processed');
    expect(await handleEvent(t.db, ev(), effect)).toBe('duplicate');
    expect(await handleEvent(t.db, ev(), effect)).toBe('duplicate');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await marks()).toBe(1);
  });

  test('entregas simultâneas do mesmo evento aplicam o efeito uma vez', async () => {
    const effect = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 10)));
    const r = await Promise.all([handleEvent(t.db, ev(), effect), handleEvent(t.db, ev(), effect), handleEvent(t.db, ev(), effect)]);
    expect(r.filter((x) => x === 'processed')).toHaveLength(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test('falha no meio: a marca é desfeita e a reentrega aplica o efeito', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('efeito falhou'));
    await expect(handleEvent(t.db, ev(), boom)).rejects.toThrow('efeito falhou');
    expect(await marks()).toBe(0); // sem marca: o evento NÃO está "já processado"

    const ok = vi.fn().mockResolvedValue(undefined);
    expect(await handleEvent(t.db, ev(), ok)).toBe('processed');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(await marks()).toBe(1);
  });

  test('falha depois de uma escrita do efeito: a escrita e a marca somem juntas', async () => {
    const writeThenFail = async (tx: import('@ssm/worker-common').Database) => {
      await tx
        .prepare(`INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload, tenant_id, correlation_id)
                  VALUES ('efeito-1','x','x','efeito.parcial','{}',?,?)`)
        .bind(T1, 'c')
        .run();
      throw new Error('quebrou depois de escrever');
    };
    await expect(handleEvent(t.db, ev(), writeThenFail)).rejects.toThrow();
    expect(await count(`outbox WHERE id = 'efeito-1'`)).toBe(0);
    expect(await marks()).toBe(0);

    const writeOnly = async (tx: import('@ssm/worker-common').Database) => {
      await tx
        .prepare(`INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload, tenant_id, correlation_id)
                  VALUES ('efeito-1','x','x','efeito.completo','{}',?,?)`)
        .bind(T1, 'c')
        .run();
    };
    expect(await handleEvent(t.db, ev(), writeOnly)).toBe('processed');
    expect(await handleEvent(t.db, ev(), writeOnly)).toBe('duplicate');
    expect(await count(`outbox WHERE id = 'efeito-1'`)).toBe(1);
  });

  test('o efeito padrão cobre os três eventos e ignora o desconhecido sem erro', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [i, type] of ['hr.employee.offboarded', 'legal.contract.active', 'operations.sla.breached', 'qualquer.outro'].entries()) {
      expect(await handleEvent(t.db, ev(`e${i}`, type))).toBe('processed');
    }
    expect(await marks()).toBe(4);
    spy.mockRestore();
    warn.mockRestore();
  });
});

describe('relay do outbox', () => {
  test('publica para o jurídico e marca como publicado; falha conta a tentativa', async () => {
    await issued();
    const ok = { send: vi.fn().mockResolvedValue(undefined) };
    await drainOutbox({ QUEUE_LEGAL: ok } as never, t.db);
    expect(ok.send.mock.calls[0]![0]).toMatchObject({ type: 'financial.invoice.issued', tenantId: T1 });
    expect(await count('outbox WHERE published_at IS NULL')).toBe(0);

    await t.pg.exec(`UPDATE outbox SET published_at = NULL`);
    await drainOutbox({ QUEUE_LEGAL: { send: vi.fn().mockRejectedValue(new Error('fila fora')) } } as never, t.db);
    expect((await t.pg.query<{ attempts: number }>(`SELECT attempts FROM outbox`)).rows[0]!.attempts).toBe(1);
  });
});
