import type { BaseBindings } from './env.js';

/**
 * Typed access to the Coordinator from a Worker.
 *
 * The id derivation is the important part: one object per tenant for sequences
 * and rate limits, one object per key for idempotency. Getting this wrong
 * either serialises the whole platform behind one object, or spreads state
 * across objects that then cannot see each other's writes.
 */
export class CoordinatorClient {
  constructor(private readonly env: BaseBindings) {}

  private stub(name: string): DurableObjectStub {
    return this.env.COORDINATOR.get(this.env.COORDINATOR.idFromName(name));
  }

  /**
   * Toda chamada passa por aqui porque uma falha do Durable Object chega como
   * texto, não como JSON — binding ausente, classe não exportada, migração não
   * aplicada. Chamar `res.json()` direto transformava "Worker ... não tem a
   * classe Coordinator" em "Unexpected token 'W'", que não diz nada a quem lê o
   * log e manda procurar no lugar errado.
   */
  private async call<T>(name: string, path: string, init?: RequestInit): Promise<T> {
    const res = await this.stub(name).fetch(`https://do${path}`, init);
    if (!res.ok) {
      throw new Error(`Coordinator ${path} respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return res.json<T>();
  }

  /**
   * Next number in a per-tenant sequence.
   *
   * Keyed by tenant, so two tenants issuing invoices at the same instant never
   * wait on each other — and within a tenant the numbers cannot collide,
   * because a Durable Object handles one request at a time.
   */
  async nextSequence(tenantId: string, name: string, start = 0): Promise<number> {
    const { value } = await this.call<{ value: number }>(
      `seq:${tenantId}`,
      `/sequence?name=${encodeURIComponent(name)}&start=${start}`,
    );
    return value;
  }

  /** Descarta a concessão: o número foi gravado e é definitivo. */
  async confirmSequence(tenantId: string, name: string, value: number): Promise<void> {
    await this.call(`seq:${tenantId}`, '/sequence/confirm', {
      method: 'POST',
      body: JSON.stringify({ name, value }),
    });
  }

  /** Devolve o número para a fila: a gravação não aconteceu. */
  async returnSequence(tenantId: string, name: string, value: number): Promise<void> {
    await this.call(`seq:${tenantId}`, '/sequence/return', {
      method: 'POST',
      body: JSON.stringify({ name, value }),
    });
  }

  /** Keyed by the idempotency key itself: the only object that must see it. */
  async claimIdempotency(
    tenantId: string,
    key: string,
    fingerprint: string,
  ): Promise<
    | { state: 'fresh' }
    | { state: 'in-flight' }
    | { state: 'conflict' }
    | { state: 'replay'; result: { status: number; body: unknown } }
  > {
    return this.call(`idem:${tenantId}:${key}`, '/idempotency/claim', {
      method: 'POST',
      body: JSON.stringify({ key, fingerprint }),
    });
  }

  async completeIdempotency(
    tenantId: string,
    key: string,
    fingerprint: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.call(`idem:${tenantId}:${key}`, '/idempotency/complete', {
      method: 'POST',
      body: JSON.stringify({ key, fingerprint, status, body }),
    });
  }

  async releaseIdempotency(tenantId: string, key: string): Promise<void> {
    await this.call(`idem:${tenantId}:${key}`, '/idempotency/release', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
  }

  /**
   * Lê o contador sem incrementá-lo.
   *
   * Existe para o contador de falhas de login: ele precisa ser consultado a
   * cada tentativa, mas só incrementado quando a tentativa falha. Consultar com
   * `checkRateLimit` incrementaria, e o limite de falhas passaria a contar
   * acertos — que é exatamente o erro que ele foi criado para corrigir.
   */
  async peekRateLimit(
    actor: string,
    windowSeconds: number,
    limit: number,
  ): Promise<{ allowed: boolean; hits: number; limit: number; resetAt: number }> {
    return this.call(`rl:${actor}`, `/ratelimit?window=${windowSeconds}&limit=${limit}&peek=1`);
  }

  /** Keyed by the actor, so the limit follows the user rather than the edge. */
  async checkRateLimit(
    actor: string,
    windowSeconds: number,
    limit: number,
  ): Promise<{ allowed: boolean; hits: number; limit: number; resetAt: number }> {
    return this.call(`rl:${actor}`, `/ratelimit?window=${windowSeconds}&limit=${limit}`);
  }
}
