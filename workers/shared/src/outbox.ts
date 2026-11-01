import type { Database, DbStatement } from './database.js';

/**
 * Evento do outbox (ADR 0006), gravado junto com a mudança de domínio.
 *
 * O outbox existe porque publicar na fila direto obrigaria a escolher entre
 * publicar antes de gravar (evento de algo que pode não ter acontecido) ou
 * depois (estado alterado sem ninguém saber). A linha entra na MESMA transação
 * da mudança, e o relay do `scheduled` publica depois.
 */
export interface OutboxEvent {
  aggregateType: string;
  aggregateId: string;
  type: string;
  tenantId: string;
  actorId: string | null;
  correlationId: string;
  payload: Record<string, unknown>;
}

/**
 * Grava o evento no outbox A PARTIR de CTEs de escrita, num único comando.
 *
 * `ctes` é o texto de um ou mais CTEs (`moved AS (UPDATE … RETURNING id)`); o
 * INSERT do outbox lê de `source` (por padrão `moved`) e, portanto, só insere se
 * a escrita condicional moveu alguma linha. É o que impede o evento fantasma:
 * quem perde a corrida (`WHERE version = …` não casa) não deixa evento de algo
 * que não aconteceu. Um comando é uma transação, então a mudança e o evento
 * valem juntos ou não valem. `meta.changes` do resultado é o número de eventos
 * gravados — 0 significa que ninguém foi movido.
 *
 * Num `batch()` do D1 os dois comandos eram independentes: o INSERT do outbox
 * não dependia do UPDATE, e quem perdia a corrida deixava o evento mesmo assim.
 */
export function eventStatement(
  db: Database,
  ctes: string,
  params: unknown[],
  event: OutboxEvent,
  source = 'moved',
): DbStatement {
  return db
    .prepare(
      `WITH ${ctes}
       INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload,
                           tenant_id, actor_id, correlation_id)
       SELECT ?, ?, ?, ?, ?::jsonb, ?, ?, ? FROM ${source}`,
    )
    .bind(
      ...params,
      crypto.randomUUID(),
      event.aggregateType,
      event.aggregateId,
      event.type,
      JSON.stringify(event.payload),
      event.tenantId,
      event.actorId,
      event.correlationId,
    );
}

/** Atalho: um UPDATE condicional (`… RETURNING id`) seguido do seu evento. */
export function eventAfter(
  db: Database,
  updateSql: string,
  params: unknown[],
  event: OutboxEvent,
): DbStatement {
  return eventStatement(db, `moved AS (${updateSql})`, params, event);
}
