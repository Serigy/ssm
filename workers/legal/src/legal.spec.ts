import { documentPrefix, Coordinator, type Database } from '@ssm/worker-common';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  amendContract,
  attachDocument,
  createContract,
  noticeExpiring,
  transitionContract,
  updateContract,
} from './commands.js';
import { drainOutbox, handleEvent, type QueueEvent } from './index.js';
import { findContractRow, listContracts, searchQuery } from './queries.js';
import { openTestDb, type TestDb } from './test-db.js';

const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';
const ACTOR = '00000000-0000-4000-8000-0000000000b1';
const EMP = '00000000-0000-4000-8000-0000000000d1';

/** O Coordinator de verdade (numeração) sobre armazenamento em memória. */
function fakeCoordinatorNamespace() {
  const objects = new Map<string, Coordinator>();
  const make = () => {
    const map = new Map<string, unknown>();
    let alarm: number | null = null;
    return new Coordinator(
      {
        storage: {
          get: async (k: string) => map.get(k),
          put: async (k: string, v: unknown) => void map.set(k, structuredClone(v)),
          delete: async (k: string) => void map.delete(k),
          list: async () => new Map(map),
          getAlarm: async () => alarm,
          setAlarm: async (at: number) => void (alarm = at),
        },
      } as never,
      {} as never,
    );
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
  env = { COORDINATOR: fakeCoordinatorNamespace(), R2: { head: async () => ({}) } } as never;
  await t.pg.exec(`
    ALTER TABLE outbox DROP CONSTRAINT IF EXISTS boom;
    DELETE FROM outbox; DELETE FROM processed_events; DELETE FROM contracts;
  `);
});

const count = async (sql: string) =>
  (await t.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0]!.n;
const eventTypes = async () =>
  (await t.pg.query<{ type: string }>(`SELECT type FROM outbox`)).rows.map((r) => r.type).sort();

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

const party = (name: string, externalRef: string | null = null) => ({
  name,
  role: 'counterparty' as const,
  externalRef,
});

const draft = (over: Record<string, unknown> = {}) =>
  createContract(env, t.db, T1, ACTOR, {
    title: 'Sustentação de infraestrutura',
    kind: 'service_agreement',
    parties: [party('Prefeitura de Aracaju')],
    tags: ['sustentação'],
    renewalNoticeDays: 30,
    autoRenew: false,
    ...over,
  } as never);

/** Atalho de teste: leva o contrato direto a `active`, com vigência. */
async function activate(id: string, from = '2026-01-01', to: string | null = null, notice = 30) {
  await t.pg.query(
    `UPDATE contracts SET status = 'active', effective_from = $2, effective_to = $3, renewal_notice_days = $4 WHERE id = $1`,
    [id, from, to, notice],
  );
}
const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Árvore de cláusulas de profundidade arbitrária. */
const deepTree = (depth: number): unknown[] =>
  depth === 0
    ? []
    : [{ id: `cl-${depth}`, ordinal: String(depth), heading: `Nível ${depth}`, body: 'Texto com acentuação: ção, ã, é.', risk: null, tags: ['x'], children: deepTree(depth - 1) }];

describe('criação e a árvore em jsonb', () => {
  test('referência sequencial por tipo e ano, partes ganham id, tipos voltam como são', async () => {
    const a = await draft();
    const b = await draft({ kind: 'nda', title: 'NDA' });
    const c = await draft();
    const y = new Date().getUTCFullYear();
    expect(a.reference).toBe(`SER-${y}-0001`);
    expect(c.reference).toBe(`SER-${y}-0002`);
    expect(b.reference).toBe(`NDA-${y}-0001`);
    expect(a.status).toBe('draft');
    expect(a.autoRenew).toBe(false); // boolean, e não 0/1
    expect(a.parties[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.tags).toEqual(['sustentação']);
    expect(a.clauses).toEqual([]);
  });

  test('a árvore de 8 níveis sobrevive ao aditivo e volta idêntica', async () => {
    const c = await draft();
    const tree = deepTree(8);
    const out = await amendContract(t.db, T1, ACTOR, c.id, tree as never, 'árvore profunda');
    expect(out.clauses).toEqual(tree);
    expect(out.currentVersion).toBe(2);
  });

  test('o banco recusa cláusulas que não sejam array, e tipo/risco fora do contrato', async () => {
    const c = await draft();
    await expect(t.pg.query(`UPDATE contracts SET clauses = '{"a":1}'::jsonb WHERE id = $1`, [c.id])).rejects.toThrow(/clauses_ck/);
    await expect(t.pg.query(`UPDATE contracts SET kind = 'outro' WHERE id = $1`, [c.id])).rejects.toThrow(/kind_ck/);
    await expect(t.pg.query(`UPDATE contracts SET risk = 'altissimo' WHERE id = $1`, [c.id])).rejects.toThrow(/risk_ck/);
  });

  test('outro tenant não vê o contrato', async () => {
    const c = await draft();
    expect(await findContractRow(t.db, T2, c.id)).toBeNull();
    await expect(updateContract(t.db, T2, ACTOR, c.id, { title: 'x' } as never)).rejects.toMatchObject({ status: 404 });
  });
});

describe('edição', () => {
  test('edita partes e etiquetas; autoRenew é preservado quando ausente', async () => {
    const c = await draft({ autoRenew: true });
    const u = await updateContract(t.db, T1, ACTOR, c.id, { tags: ['a', 'b'], parties: [party('Nova Parte')] } as never);
    expect(u.tags).toEqual(['a', 'b']);
    expect(u.parties.map((p) => p.name)).toEqual(['Nova Parte']);
    expect(u.autoRenew).toBe(true);
  });

  test('contrato assinado não se edita: 409', async () => {
    const c = await draft();
    await activate(c.id);
    await expect(updateContract(t.db, T1, ACTOR, c.id, { title: 'x' } as never)).rejects.toMatchObject({ status: 409 });
  });

  test('assinado entre a leitura e a escrita: a edição NÃO vale', async () => {
    const c = await draft();
    const restore = raceAfterRead(
      'SELECT * FROM contracts',
      `UPDATE contracts SET status = 'active', effective_from = '2026-01-01' WHERE id = '${c.id}'`,
    );
    try {
      await expect(updateContract(t.db, T1, ACTOR, c.id, { title: 'Texto adulterado' } as never)).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect((await findContractRow(t.db, T1, c.id))!.title).toBe('Sustentação de infraestrutura');
  });
});

describe('aditivo: versão por CAS, histórico na mesma transação', () => {
  test('a versão anterior vai para o histórico e a nova assume', async () => {
    const c = await draft();
    const v1 = deepTree(2);
    await amendContract(t.db, T1, ACTOR, c.id, v1 as never, 'primeiro');
    await amendContract(t.db, T1, ACTOR, c.id, deepTree(3) as never, 'segundo');

    const { rows } = await t.pg.query<{ version: number; note: string; clauses: unknown[] }>(
      `SELECT version, note, clauses FROM contract_versions WHERE contract_id = $1 ORDER BY version`, [c.id],
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0]!.clauses).toEqual([]); // o rascunho original
    expect(rows[1]!.clauses).toEqual(v1); // a versão que o segundo aditivo substituiu
    expect((await findContractRow(t.db, T1, c.id))!.current_version).toBe(3);
  });

  test('aditivo que perde a corrida: 409, sem histórico órfão e sem mudar o texto', async () => {
    const c = await draft();
    const restore = raceAfterRead(
      'SELECT * FROM contracts',
      `UPDATE contracts SET current_version = current_version + 1 WHERE id = '${c.id}'`,
    );
    try {
      await expect(amendContract(t.db, T1, ACTOR, c.id, deepTree(2) as never, 'x')).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect(await count('contract_versions')).toBe(0);
    expect((await findContractRow(t.db, T1, c.id))!.clauses).toEqual([]);
  });

  test('dois aditivos simultâneos: nunca duas versões com o mesmo número', async () => {
    const c = await draft();
    const r = await Promise.allSettled([
      amendContract(t.db, T1, ACTOR, c.id, deepTree(1) as never, 'a'),
      amendContract(t.db, T1, ACTOR, c.id, deepTree(2) as never, 'b'),
    ]);
    const versions = (await t.pg.query<{ version: number }>(`SELECT version FROM contract_versions`)).rows;
    expect(new Set(versions.map((v) => v.version)).size).toBe(versions.length);
    const final = (await findContractRow(t.db, T1, c.id))!;
    expect(final.current_version).toBe(1 + r.filter((x) => x.status === 'fulfilled').length);
    for (const x of r) if (x.status === 'rejected') expect(x.reason).toMatchObject({ status: 409 });
  });
});

describe('transição de situação', () => {
  test('caminho completo até active: um evento por transição, na ordem do grafo', async () => {
    const c = await draft({ effectiveFrom: '2026-01-01', effectiveTo: '2027-01-01' });
    for (const to of ['in_review', 'awaiting_signature', 'active'] as const) {
      await transitionContract(t.db, T1, ACTOR, c.id, to, 'corr');
    }
    expect(await eventTypes()).toEqual([
      'legal.contract.active', 'legal.contract.awaiting_signature', 'legal.contract.in_review',
    ]);
  });

  test('transição fora do grafo é 409; ativar sem data de início é 400', async () => {
    const c = await draft();
    await expect(transitionContract(t.db, T1, ACTOR, c.id, 'active', 'c')).rejects.toMatchObject({ status: 409 });
    await t.pg.query(`UPDATE contracts SET status = 'awaiting_signature' WHERE id = $1`, [c.id]);
    await expect(transitionContract(t.db, T1, ACTOR, c.id, 'active', 'c')).rejects.toMatchObject({ status: 400 });
  });

  test('o banco recusa active sem início, mesmo por UPDATE manual', async () => {
    const c = await draft();
    await expect(t.pg.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [c.id])).rejects.toThrow(/active_has_start/);
  });

  test('perder a corrida: 409, situação como a outra pessoa deixou, nenhum evento', async () => {
    const c = await draft();
    const restore = raceAfterRead('SELECT * FROM contracts', `UPDATE contracts SET status = 'terminated' WHERE id = '${c.id}'`);
    try {
      await expect(transitionContract(t.db, T1, ACTOR, c.id, 'in_review', 'c')).rejects.toMatchObject({ status: 409 });
    } finally {
      restore();
    }
    expect(await eventTypes()).toEqual([]);
    expect((await findContractRow(t.db, T1, c.id))!.status).toBe('terminated');
  });

  test('se o outbox falha, a situação não muda', async () => {
    const c = await draft();
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (false)`);
    await expect(transitionContract(t.db, T1, ACTOR, c.id, 'in_review', 'c')).rejects.toThrow(/boom/);
    expect((await findContractRow(t.db, T1, c.id))!.status).toBe('draft');
  });
});

describe('aviso de vencimento', () => {
  const expiring = async (days: number, notice = 30) => {
    const c = await draft();
    await activate(c.id, '2026-01-01', inDays(days), notice);
    return c;
  };

  test('avisa uma vez, marca a data avisada, e a varredura seguinte não repete', async () => {
    const c = await expiring(10);
    expect(await noticeExpiring(t.db)).toBe(1);
    expect(await noticeExpiring(t.db)).toBe(0);
    expect(await eventTypes()).toEqual(['legal.contract.expiring']);

    const { rows } = await t.pg.query<{ payload: { daysRemaining: number; expiresOn: string; contractId: string } }>(`SELECT payload FROM outbox`);
    expect(rows[0]!.payload).toMatchObject({ contractId: c.id, expiresOn: inDays(10), daysRemaining: 10 });
    expect((await findContractRow(t.db, T1, c.id))!.expiry_notice_sent_for).toBe(inDays(10));
  });

  test('renovar (mover a data) rearma o aviso sozinho', async () => {
    const c = await expiring(10);
    await noticeExpiring(t.db);
    await t.pg.query(`UPDATE contracts SET effective_to = $2 WHERE id = $1`, [c.id, inDays(20)]);
    expect(await noticeExpiring(t.db)).toBe(1);
    expect(await count(`outbox WHERE type = 'legal.contract.expiring'`)).toBe(2);
  });

  test('só entra quem está ativo, ainda não venceu e está dentro da janela (limite inclusivo)', async () => {
    await expiring(31); // fora da janela de 30
    await expiring(30); // exatamente no limite: entra
    await expiring(0); // vence hoje: entra
    await expiring(-1); // já venceu: fora
    const d = await draft(); // rascunho com data: fora
    await t.pg.query(`UPDATE contracts SET effective_from = '2026-01-01', effective_to = $2 WHERE id = $1`, [d.id, inDays(5)]);
    expect(await noticeExpiring(t.db)).toBe(2);
  });

  test('duas varreduras simultâneas geram um só aviso por contrato', async () => {
    await expiring(10);
    const [a, b] = await Promise.all([noticeExpiring(t.db), noticeExpiring(t.db)]);
    expect(a + b).toBe(1);
    expect(await count(`outbox WHERE type = 'legal.contract.expiring'`)).toBe(1);
  });

  test('a marca e o evento valem juntos: se o outbox falha, a marca não fica', async () => {
    const c = await expiring(10);
    await t.pg.exec(`ALTER TABLE outbox ADD CONSTRAINT boom CHECK (false)`);
    await expect(noticeExpiring(t.db)).rejects.toThrow(/boom/);
    expect((await findContractRow(t.db, T1, c.id))!.expiry_notice_sent_for).toBeNull();
    await t.pg.exec(`ALTER TABLE outbox DROP CONSTRAINT boom`);
    expect(await noticeExpiring(t.db)).toBe(1); // o aviso não se perdeu
  });
});

describe('consulta', () => {
  const list = async (f: object) =>
    (await listContracts(t.db, T1, f as never, { limit: 20 } as never)).rows;

  test('etiqueta é correspondência exata: "fiscal" não casa com "fiscalizacao"', async () => {
    await draft({ title: 'A', tags: ['fiscalizacao'] });
    const b = await draft({ title: 'B', tags: ['fiscal', 'x'] });
    expect((await list({ tag: 'fiscal' })).map((r) => r.id)).toEqual([b.id]);
    expect(await list({ tag: 'fisc' })).toHaveLength(0);
  });

  test('vencendo em N dias: só ativos dentro do intervalo', async () => {
    const a = await draft();
    await activate(a.id, '2026-01-01', inDays(10));
    const b = await draft();
    await activate(b.id, '2026-01-01', inDays(90));
    expect((await list({ expiringWithinDays: 30 })).map((r) => r.id)).toEqual([a.id]);
    expect(await list({ expiringWithinDays: 120 })).toHaveLength(2);
  });

  test('busca por título, referência e nome da parte — com prefixo e sem acento', async () => {
    await draft({ title: 'Sustentação mensal', parties: [party('Prefeitura de Aracaju')] });
    await draft({ title: 'Licença', kind: 'license', parties: [party('Grupo Sergipe Varejo')] });
    expect(await list({ q: 'sustentacao' })).toHaveLength(1);
    expect(await list({ q: 'aracaju' })).toHaveLength(1); // nome da parte, que não é coluna
    expect(await list({ q: 'sergipe vare' })).toHaveLength(1);
    expect(await list({ q: 'LIC' })).toHaveLength(1);
    expect(await list({ q: 'inexistente' })).toHaveLength(0);
    expect(searchQuery("a' | b")).toBe('a:* & b:*');
  });

  test('a busca acompanha a edição das partes (o gatilho do D1 virou coluna gerada)', async () => {
    const c = await draft({ parties: [party('Antiga Ltda')] });
    expect(await list({ q: 'antiga' })).toHaveLength(1);
    await updateContract(t.db, T1, ACTOR, c.id, { parties: [party('Moderna SA')] } as never);
    expect(await list({ q: 'antiga' })).toHaveLength(0);
    expect(await list({ q: 'moderna' })).toHaveLength(1);
  });

  test('paginação por cursor com carimbos iguais devolve cada contrato uma vez', async () => {
    for (let i = 0; i < 5; i++) await draft({ title: `C${i}` });
    await t.pg.exec(`UPDATE contracts SET created_at = '2026-03-01T10:00:00.123Z'`);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let g = 0; g < 10; g++) {
      const p = await listContracts(t.db, T1, {} as never, { limit: 2, cursor } as never);
      seen.push(...p.rows.map((r) => r.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });
});

describe('documento (R2 não muda)', () => {
  test('chave de outro contrato é recusada; chave sem arquivo no R2 também', async () => {
    const c = await draft();
    await expect(attachDocument(env, t.db, T1, ACTOR, c.id, 'contracts/outro/arquivo.pdf')).rejects.toMatchObject({ status: 400 });

    const semArquivo = { ...(env as object), R2: { head: async () => null } } as never;
    const key = `${documentPrefix('contracts', T1, c.id)}a.pdf`;
    await expect(attachDocument(semArquivo, t.db, T1, ACTOR, c.id, key)).rejects.toMatchObject({ status: 400 });

    const out = await attachDocument(env, t.db, T1, ACTOR, c.id, key);
    expect(out.documentKey).toBe(key);
  });
});

describe('consumo idempotente de eventos', () => {
  const offboarded = (id = 'ev-1', tenantId = T1): QueueEvent => ({
    id, type: 'hr.employee.offboarded', data: { employeeId: EMP }, tenantId, correlationId: 'c',
  });
  const risk = async (id: string) => (await findContractRow(t.db, T1, id))!.risk;

  test('marca como alto risco só o contrato ATIVO do tenant que nomeia a pessoa', async () => {
    const alvo = await draft({ parties: [party('Colaborador', EMP)] });
    const semRef = await draft({ title: 'Sem vínculo', parties: [party('Outra Pessoa', null)] });
    const rascunho = await draft({ title: 'Rascunho', parties: [party('Colaborador', EMP)] });
    for (const id of [alvo.id, semRef.id]) await activate(id);
    const outroTenant = await createContract(env, t.db, T2, ACTOR, {
      title: 'Outro cliente', kind: 'service_agreement', parties: [party('Colaborador', EMP)], tags: [],
      renewalNoticeDays: 30, autoRenew: false,
    } as never);
    await t.pg.query(`UPDATE contracts SET status='active', effective_from='2026-01-01' WHERE id=$1`, [outroTenant.id]);

    expect(await handleEvent(t.db, offboarded())).toBe('processed');

    expect(await risk(alvo.id)).toBe('high');
    expect(await risk(semRef.id)).toBeNull();
    expect(await risk(rascunho.id)).toBeNull(); // rascunho não é ativo
    expect((await findContractRow(t.db, T2, outroTenant.id))!.risk).toBeNull(); // outro tenant intacto
  });

  test('a reentrega não repete o efeito', async () => {
    const effect = vi.fn().mockResolvedValue(undefined);
    expect(await handleEvent(t.db, offboarded(), effect)).toBe('processed');
    expect(await handleEvent(t.db, offboarded(), effect)).toBe('duplicate');
    expect(await handleEvent(t.db, offboarded(), effect)).toBe('duplicate');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await count('processed_events')).toBe(1);
  });

  test('entregas simultâneas do mesmo evento aplicam o efeito uma vez', async () => {
    const effect = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 10)));
    const r = await Promise.all([handleEvent(t.db, offboarded(), effect), handleEvent(t.db, offboarded(), effect)]);
    expect(r.filter((x) => x === 'processed')).toHaveLength(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test('falha no meio: a marca é desfeita e a reentrega aplica o efeito de fato', async () => {
    const alvo = await draft({ parties: [party('Colaborador', EMP)] });
    await activate(alvo.id);

    const writeThenFail = async (tx: Database) => {
      await tx.prepare(`UPDATE contracts SET risk = 'high' WHERE id = ?`).bind(alvo.id).run();
      throw new Error('quebrou depois de escrever');
    };
    await expect(handleEvent(t.db, offboarded(), writeThenFail)).rejects.toThrow();
    expect(await count('processed_events')).toBe(0); // não está "já processado"
    expect(await risk(alvo.id)).toBeNull(); // e a escrita parcial também sumiu

    expect(await handleEvent(t.db, offboarded())).toBe('processed'); // a reentrega vale
    expect(await risk(alvo.id)).toBe('high');
    expect(await handleEvent(t.db, offboarded())).toBe('duplicate');
  });

  test('evento de outro tipo é marcado como processado e não faz nada', async () => {
    const e: QueueEvent = { id: 'x', type: 'financial.invoice.issued', data: {}, tenantId: T1, correlationId: 'c' };
    expect(await handleEvent(t.db, e)).toBe('processed');
    expect(await handleEvent(t.db, e)).toBe('duplicate');
  });
});

describe('relay do outbox', () => {
  test('publica para o financeiro e marca; falha conta a tentativa', async () => {
    const c = await draft();
    await transitionContract(t.db, T1, ACTOR, c.id, 'in_review', 'c');
    const ok = { send: vi.fn().mockResolvedValue(undefined) };
    await drainOutbox({ QUEUE_FINANCIAL: ok } as never, t.db);
    expect(ok.send.mock.calls[0]![0]).toMatchObject({ type: 'legal.contract.in_review', tenantId: T1 });
    expect(await count('outbox WHERE published_at IS NULL')).toBe(0);

    await t.pg.exec(`UPDATE outbox SET published_at = NULL`);
    await drainOutbox({ QUEUE_FINANCIAL: { send: vi.fn().mockRejectedValue(new Error('fila fora')) } } as never, t.db);
    expect((await t.pg.query<{ attempts: number }>(`SELECT attempts FROM outbox`)).rows[0]!.attempts).toBe(1);
  });
});
