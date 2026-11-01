/**
 * The single-threaded corner of the platform.
 *
 * Three guarantees that D1 and KV cannot give, and that the containerised
 * version got from Postgres and Redis:
 *
 *   1. **Gapless sequences.** `pg_advisory_xact_lock` has no equivalent in
 *      SQLite, and D1 has no interactive transaction to hold one across a
 *      read-then-write. A Durable Object handles one request at a time for a
 *      given id, which is exactly the serialisation the invoice number needs —
 *      and tax authorities in several jurisdictions treat a gap in invoice
 *      numbering as a finding, so "mostly sequential" is not good enough.
 *
 *   2. **Idempotency.** KV is eventually consistent: a client retrying two
 *      seconds later can reach an edge that has not seen the key yet, and the
 *      payment gets recorded twice — precisely the failure the header exists to
 *      prevent. A Durable Object reads its own writes, always.
 *
 *   3. **Rate limiting.** KV has no atomic increment, so counting there is a
 *      read-modify-write race that resolves in the attacker's favour.
 *
 * One class rather than three, because they share the same property — ordered
 * access to a small piece of state — and three classes would mean three
 * bindings and three sets of migrations for no gain.
 */

interface StoredIdempotency {
  state: 'in-flight' | 'done';
  fingerprint: string;
  status?: number;
  body?: unknown;
  /** Epoch ms. Records outlive their usefulness and are swept on read. */
  expiresAt: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_LOCK_MS = 60 * 1000;

/**
 * Quanto tempo um número fica reservado antes de voltar para a fila.
 *
 * Folgado de propósito: a requisição que o pediu leva menos de um segundo, e o
 * limite de tempo do Worker é muito menor que isto. O prazo só existe para o
 * caso de o Worker morrer entre pedir o número e confirmá-lo — sem ele, esse
 * número ficaria reservado para sempre e viraria lacuna.
 */
const SEQUENCE_LEASE_MS = 120 * 1000;

interface SequenceState {
  /** Maior número já emitido nesta sequência. */
  counter: number;
  /** Números concedidos e devolvidos, reaproveitados antes de incrementar. */
  free: number[];
  /** Concedidos e ainda não confirmados, com o instante da concessão. */
  leased: Array<{ value: number; at: number }>;
}

export class Coordinator implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/sequence':
        return this.nextInSequence(url);
      case '/sequence/confirm':
        return this.settleSequence(request, 'confirm');
      case '/sequence/return':
        return this.settleSequence(request, 'return');
      case '/idempotency/claim':
        return this.claimIdempotency(request);
      case '/idempotency/complete':
        return this.completeIdempotency(request);
      case '/idempotency/release':
        return this.releaseIdempotency(request);
      case '/ratelimit':
        return this.rateLimit(url);
      default:
        return new Response('not found', { status: 404 });
    }
  }

  // --- sequences ----------------------------------------------------------

  /**
   * Concede o próximo número de uma sequência nomeada.
   *
   * `?name=invoices:2026&start=0`. O id do objeto vem do cliente, então
   * clientes nunca ficam na fila uns dos outros; o nome separa as sequências
   * dentro de um cliente.
   *
   * A concessão é reservada, não gasta. Quem pediu precisa confirmar depois de
   * gravar, ou devolver se não gravou — porque o incremento aqui não participa
   * do `batch()` do D1 e não desfaz junto com ele. Sem essa devolução, uma
   * emissão que perde a corrida de versão queima o número e abre lacuna, que é
   * exatamente o achado de fiscalização que esta sequência existe para evitar.
   */
  private async nextInSequence(url: URL): Promise<Response> {
    const name = url.searchParams.get('name');
    if (!name) return new Response('name obrigatório', { status: 400 });
    const start = Number(url.searchParams.get('start') ?? '0');

    const state = await this.sequenceState(name, start);
    this.reclaimExpired(state);

    // Devolvidos primeiro, e o menor deles: a ordem dos números emitidos
    // acompanha a ordem das emissões.
    const value = state.free.length ? state.free.sort((a, b) => a - b).shift()! : ++state.counter;
    state.leased.push({ value, at: Date.now() });

    await this.state.storage.put(`seq:${name}`, state);
    await this.scheduleAlarm(Date.now() + SEQUENCE_LEASE_MS);

    return Response.json({ value });
  }

  /**
   * Encerra uma concessão: `confirm` a descarta, `return` devolve o número.
   */
  private async settleSequence(request: Request, mode: 'confirm' | 'return'): Promise<Response> {
    const { name, value } = (await request.json()) as { name: string; value: number };
    const state = await this.sequenceState(name, 0);

    const before = state.leased.length;
    state.leased = state.leased.filter((l) => l.value !== value);
    // Só devolve o que ainda estava reservado. Sem isso, uma devolução repetida
    // colocaria o mesmo número na fila duas vezes e ele sairia para duas
    // faturas — o índice único barraria a segunda, com erro para o usuário.
    if (mode === 'return' && before !== state.leased.length && !state.free.includes(value)) {
      state.free.push(value);
    }

    await this.state.storage.put(`seq:${name}`, state);
    return Response.json({ ok: true });
  }

  /**
   * Lê o estado da sequência, aceitando a forma anterior.
   *
   * A primeira versão guardava um número puro. O estado de um Durable Object
   * sobrevive ao deploy — trocar a forma sem tratar a antiga faz a primeira
   * emissão depois da atualização morrer com `state.free is undefined`, e a
   * numeração de quem já usava o sistema é justamente a que não pode falhar.
   */
  private async sequenceState(name: string, start: number): Promise<SequenceState> {
    const stored = await this.state.storage.get<SequenceState | number>(`seq:${name}`);
    if (typeof stored === 'number') return { counter: stored, free: [], leased: [] };
    if (!stored) return { counter: start, free: [], leased: [] };
    // Um objeto gravado por versão intermediária pode não ter os arranjos.
    return { counter: stored.counter ?? start, free: stored.free ?? [], leased: stored.leased ?? [] };
  }

  /** Concessão vencida volta para a fila: o dono dela não existe mais. */
  private reclaimExpired(state: SequenceState): void {
    const cutoff = Date.now() - SEQUENCE_LEASE_MS;
    const expired = state.leased.filter((l) => l.at <= cutoff);
    if (!expired.length) return;
    state.leased = state.leased.filter((l) => l.at > cutoff);
    for (const l of expired) if (!state.free.includes(l.value)) state.free.push(l.value);
  }

  // --- idempotency --------------------------------------------------------

  private async claimIdempotency(request: Request): Promise<Response> {
    const { key, fingerprint } = (await request.json()) as {
      key: string;
      fingerprint: string;
    };
    const storageKey = `idem:${key}`;
    const now = Date.now();

    const stored = await this.state.storage.get<StoredIdempotency>(storageKey);

    if (!stored || stored.expiresAt <= now) {
      await this.state.storage.put(storageKey, {
        state: 'in-flight',
        fingerprint,
        expiresAt: now + IDEMPOTENCY_LOCK_MS,
      } satisfies StoredIdempotency);
      return Response.json({ state: 'fresh' });
    }

    // Same key, different payload. Replaying the stored answer would respond to
    // a question the client did not ask, so refuse rather than guess.
    if (stored.fingerprint !== fingerprint) {
      return Response.json({ state: 'conflict' });
    }

    if (stored.state === 'in-flight') return Response.json({ state: 'in-flight' });

    return Response.json({
      state: 'replay',
      result: { status: stored.status, body: stored.body },
    });
  }

  private async completeIdempotency(request: Request): Promise<Response> {
    const { key, fingerprint, status, body } = (await request.json()) as {
      key: string;
      fingerprint: string;
      status: number;
      body: unknown;
    };
    await this.state.storage.put(`idem:${key}`, {
      state: 'done',
      fingerprint,
      status,
      body,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    } satisfies StoredIdempotency);
    return Response.json({ ok: true });
  }

  /**
   * Frees the key after a failure, so the client may retry at once.
   * Storing the error would turn a transient 500 into a permanent one.
   */
  private async releaseIdempotency(request: Request): Promise<Response> {
    const { key } = (await request.json()) as { key: string };
    await this.state.storage.delete(`idem:${key}`);
    return Response.json({ ok: true });
  }

  // --- rate limiting ------------------------------------------------------

  /**
   * Fixed-window counter. `?window=60&limit=300`.
   *
   * A fixed window lets a client send `2 × limit` across a window boundary. A
   * sliding window would cost a stored timestamp list per client and more CPU
   * per request; at SSM's traffic the extra precision buys nothing, and the
   * WAF's own rate limiting sits in front of this for volumetric abuse.
   */
  private async rateLimit(url: URL): Promise<Response> {
    const windowSeconds = Number(url.searchParams.get('window') ?? '60');
    const limit = Number(url.searchParams.get('limit') ?? '300');
    // `peek=1` consulta sem contar. Ver peekRateLimit no cliente.
    const peek = url.searchParams.get('peek') === '1';
    const now = Date.now();
    const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;

    const key = `rl:${windowSeconds}`;
    const stored = await this.state.storage.get<{ start: number; hits: number }>(key);
    const current = stored && stored.start === windowStart ? stored.hits : 0;

    const hits = peek ? current : current + 1;
    if (!peek) await this.state.storage.put(key, { start: windowStart, hits });

    // The object holds only two integers, but an idle tenant should not keep
    // storage forever; the alarm clears it a window after the last request.
    await this.scheduleAlarm(windowStart + windowSeconds * 1000 * 2);

    return Response.json({
      allowed: hits <= limit,
      hits,
      limit,
      resetAt: windowStart + windowSeconds * 1000,
    });
  }

  /**
   * Agenda o alarme mantendo o mais próximo.
   *
   * `setAlarm` sobrescreve, e dois caminhos agendam: o limite de requisições e
   * a concessão de sequência. Sem esta comparação, tráfego contínuo empurraria
   * o alarme para frente a cada requisição e a recuperação de concessão órfã
   * nunca aconteceria.
   */
  private async scheduleAlarm(at: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current === null || at < current) await this.state.storage.setAlarm(at);
  }

  /** Limpa contadores vencidos e recupera concessões órfãs de sequência. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const entries = await this.state.storage.list<unknown>();
    for (const [key, value] of entries) {
      if (key.startsWith('rl:')) {
        await this.state.storage.delete(key);
        continue;
      }
      if (key.startsWith('idem:')) {
        const record = value as StoredIdempotency;
        if (record?.expiresAt && record.expiresAt <= now) await this.state.storage.delete(key);
        continue;
      }
      // Sequência nunca é apagada — o contador é o histórico. O que o alarme faz
      // aqui é recuperar concessão de requisição que morreu sem confirmar nem
      // devolver; sem isto o número só voltaria na próxima emissão daquele
      // cliente, que pode demorar um mês.
      if (key.startsWith('seq:') && Array.isArray((value as SequenceState)?.leased)) {
        const state = value as SequenceState;
        const before = state.leased.length;
        this.reclaimExpired(state);
        if ((state.leased?.length ?? 0) !== before) await this.state.storage.put(key, state);
      }
    }
  }
}
