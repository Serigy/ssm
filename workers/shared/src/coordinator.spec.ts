import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Coordinator } from './coordinator.js';

/**
 * O Coordinator é testado contra um armazenamento falso, e não contra o
 * Miniflare, por um motivo prático: o que precisa de prova aqui é a decisão —
 * reaproveitar um número devolvido, não devolver duas vezes, recuperar
 * concessão vencida, aceitar o formato antigo. Nada disso depende do runtime.
 *
 * A corrida de verdade já foi medida contra o Worker rodando, e mostrou que os
 * perdedores quase sempre param na verificação de estado antes de pedir número.
 * "Quase sempre" não é garantia, e é justamente o caminho raro que precisa
 * funcionar quando acontecer — daí este teste ir direto na lógica.
 */
function fakeState(seed: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(seed));
  let alarm: number | null = null;
  return {
    storage: {
      get: async <T>(k: string) => map.get(k) as T | undefined,
      put: async (k: string, v: unknown) => void map.set(k, structuredClone(v)),
      delete: async (k: string) => void map.delete(k),
      list: async <T>() => new Map(map) as Map<string, T>,
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => void (alarm = at),
    },
    _map: map,
    _alarm: () => alarm,
  };
}

function makeCoordinator(seed: Record<string, unknown> = {}) {
  const state = fakeState(seed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { c: new Coordinator(state as any, {}), state };
}

const seq = (name: string, start = 0) =>
  new Request(`https://do/sequence?name=${name}&start=${start}`);
const settle = (op: 'confirm' | 'return', name: string, value: number) =>
  new Request(`https://do/sequence/${op}`, {
    method: 'POST',
    body: JSON.stringify({ name, value }),
  });

async function value(res: Response): Promise<number> {
  return ((await res.json()) as { value: number }).value;
}

describe('sequência de numeração', () => {
  beforeEach(() => vi.useRealTimers());

  it('conta a partir da semente na primeira concessão e ignora a semente depois', async () => {
    const { c } = makeCoordinator();
    // A semente vem do maior número já gravado no D1: um cliente migrado com
    // faturas até 417 não pode receber 1 de volta.
    expect(await value(await c.fetch(seq('invoices:2026', 417)))).toBe(418);
    // Semente diferente na chamada seguinte não pode reescrever o contador.
    expect(await value(await c.fetch(seq('invoices:2026', 0)))).toBe(419);
  });

  it('devolve o número e o reaproveita antes de incrementar', async () => {
    const { c } = makeCoordinator();
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(2);

    await c.fetch(settle('return', 'invoices:2026', 1));

    // Sem isto, o 1 vira lacuna permanente na numeração fiscal.
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(3);
  });

  it('entrega o menor devolvido primeiro, para a ordem não embaralhar', async () => {
    const { c } = makeCoordinator();
    for (let i = 0; i < 5; i++) await c.fetch(seq('invoices:2026'));
    await c.fetch(settle('return', 'invoices:2026', 4));
    await c.fetch(settle('return', 'invoices:2026', 2));

    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(2);
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(4);
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(6);
  });

  it('não devolve o mesmo número duas vezes', async () => {
    const { c } = makeCoordinator();
    await c.fetch(seq('invoices:2026'));
    await c.fetch(settle('return', 'invoices:2026', 1));
    // Uma repetição do cliente não pode colocar o 1 na fila de novo: ele sairia
    // para duas faturas e a segunda morreria no índice único.
    await c.fetch(settle('return', 'invoices:2026', 1));

    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(2);
  });

  it('não devolve número já confirmado', async () => {
    const { c } = makeCoordinator();
    await c.fetch(seq('invoices:2026'));
    await c.fetch(settle('confirm', 'invoices:2026', 1));
    await c.fetch(settle('return', 'invoices:2026', 1));

    // O 1 está gravado numa fatura; reemiti-lo seria número duplicado.
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(2);
  });

  it('recupera concessão vencida, para um Worker morto não abrir lacuna', async () => {
    const { c } = makeCoordinator();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'));
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);

    // Ninguém confirmou nem devolveu: a requisição morreu no meio.
    vi.setSystemTime(new Date('2026-08-18T12:05:00Z'));
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);
    vi.useRealTimers();
  });

  it('mantém concessão dentro do prazo', async () => {
    const { c } = makeCoordinator();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'));
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);

    vi.setSystemTime(new Date('2026-08-18T12:00:30Z'));
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(2);
    vi.useRealTimers();
  });

  it('aceita o estado gravado pela versão anterior, que era um número puro', async () => {
    // Estado de Durable Object sobrevive ao deploy. Se isto quebrar, a primeira
    // emissão depois de uma atualização falha para quem já usava o sistema.
    const { c } = makeCoordinator({ 'seq:invoices:2026': 6 });
    expect(await value(await c.fetch(seq('invoices:2026', 0)))).toBe(7);
  });

  it('separa sequências pelo nome dentro do mesmo cliente', async () => {
    const { c } = makeCoordinator();
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(1);
    expect(await value(await c.fetch(seq('invoices:2027')))).toBe(1);
    expect(await value(await c.fetch(seq('invoices:2026')))).toBe(2);
  });
});

describe('idempotência', () => {
  const claim = (key: string, fingerprint: string) =>
    new Request('https://do/idempotency/claim', {
      method: 'POST',
      body: JSON.stringify({ key, fingerprint }),
    });

  it('a primeira chamada é nova e a segunda fica em andamento', async () => {
    const { c } = makeCoordinator();
    expect(await (await c.fetch(claim('k', 'f'))).json()).toEqual({ state: 'fresh' });
    expect(await (await c.fetch(claim('k', 'f'))).json()).toEqual({ state: 'in-flight' });
  });

  it('mesma chave com corpo diferente é conflito, não repetição', async () => {
    const { c } = makeCoordinator();
    await c.fetch(claim('k', 'f1'));
    expect(await (await c.fetch(claim('k', 'f2'))).json()).toEqual({ state: 'conflict' });
  });

  it('depois de concluída, repete a resposta gravada', async () => {
    const { c } = makeCoordinator();
    await c.fetch(claim('k', 'f'));
    await c.fetch(
      new Request('https://do/idempotency/complete', {
        method: 'POST',
        body: JSON.stringify({ key: 'k', fingerprint: 'f', status: 200, body: { ok: 1 } }),
      }),
    );
    expect(await (await c.fetch(claim('k', 'f'))).json()).toEqual({
      state: 'replay',
      result: { status: 200, body: { ok: 1 } },
    });
  });

  it('liberada depois de falha, para o cliente poder repetir na hora', async () => {
    const { c } = makeCoordinator();
    await c.fetch(claim('k', 'f'));
    await c.fetch(
      new Request('https://do/idempotency/release', {
        method: 'POST',
        body: JSON.stringify({ key: 'k' }),
      }),
    );
    expect(await (await c.fetch(claim('k', 'f'))).json()).toEqual({ state: 'fresh' });
  });
});

describe('limite de requisições', () => {
  const hit = (window = 60, limit = 3) =>
    new Request(`https://do/ratelimit?window=${window}&limit=${limit}`);

  it('permite até o limite e recusa depois', async () => {
    const { c } = makeCoordinator();
    const allowed: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      allowed.push(((await (await c.fetch(hit())).json()) as { allowed: boolean }).allowed);
    }
    expect(allowed).toEqual([true, true, true, false, false]);
  });

  it('zera na janela seguinte', async () => {
    const { c } = makeCoordinator();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'));
    for (let i = 0; i < 4; i++) await c.fetch(hit());

    vi.setSystemTime(new Date('2026-08-18T12:01:30Z'));
    expect(((await (await c.fetch(hit())).json()) as { allowed: boolean }).allowed).toBe(true);
    vi.useRealTimers();
  });

  it('peek lê sem contar', async () => {
    const { c } = makeCoordinator();
    const peek = () => c.fetch(new Request('https://do/ratelimit?window=60&limit=2&peek=1'));

    // Cem consultas não podem gastar o orçamento de ninguém: é assim que o
    // login confere o contador de falhas a cada tentativa sem que uma tentativa
    // bem-sucedida conte como falha.
    for (let i = 0; i < 100; i++) await peek();
    expect(((await (await peek()).json()) as { hits: number }).hits).toBe(0);

    await c.fetch(hit(60, 2));
    expect(((await (await peek()).json()) as { hits: number }).hits).toBe(1);
  });

  it('peek reprova quando o contador já estourou', async () => {
    const { c } = makeCoordinator();
    for (let i = 0; i < 3; i++) await c.fetch(hit(60, 2));
    const r = (await (await c.fetch(new Request('https://do/ratelimit?window=60&limit=2&peek=1'))).json()) as {
      allowed: boolean;
    };
    expect(r.allowed).toBe(false);
  });

  it('mantém o alarme mais próximo, para a recuperação não ser adiada', async () => {
    const { c, state } = makeCoordinator();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'));
    await c.fetch(seq('invoices:2026'));
    const afterSequence = state._alarm();

    // O limite agendaria bem mais para frente; o alarme não pode recuar.
    await c.fetch(hit(3600, 100));
    expect(state._alarm()).toBe(afterSequence);
    vi.useRealTimers();
  });
});
