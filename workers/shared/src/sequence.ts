import { CoordinatorClient } from './coordinator-client.js';
import type { BaseBindings } from './env.js';

/**
 * Numeração sequencial sem lacuna, em qualquer módulo.
 *
 * Existe como função de ordem superior, e não como um par de chamadas soltas,
 * porque a versão solta já falhou uma vez: o número é concedido pelo
 * Coordinator *antes* da escrita no D1, e o `batch()` do D1 não desfaz essa
 * concessão quando a escrita perde a corrida de versão. Cada emissão perdida
 * queimava um número — e uma lacuna na numeração é achado de fiscalização em
 * várias jurisdições, não uma imperfeição estética.
 *
 * Aqui o corpo não tem como esquecer: se ele lança, o número volta para a fila;
 * se retorna, o número é confirmado. Três módulos numeram — faturas, matrículas
 * e chamados — e nenhum deles reescreve esta lógica.
 *
 * `seed` é o maior número já gravado no D1, e importa uma vez só: o Coordinator
 * nasce zerado e não sabe nada do que já existe. Um cliente migrado com
 * matrículas até COL-00417 receberia 00001 de volta e bateria no índice único.
 */
export async function withReservedNumber<T>(
  env: BaseBindings,
  tenantId: string,
  sequence: string,
  seed: number,
  body: (value: number) => Promise<T>,
): Promise<T> {
  const coordinator = new CoordinatorClient(env);
  const value = await coordinator.nextSequence(tenantId, sequence, seed);

  let result: T;
  try {
    result = await body(value);
  } catch (err) {
    await coordinator.returnSequence(tenantId, sequence, value);
    // Registrado porque numeração é matéria de auditoria: se um número sumir,
    // este log é o que diz para onde ele foi e que ele voltou para a fila.
    console.log(JSON.stringify({ event: 'sequence.returned', tenantId, sequence, value }));
    throw err;
  }

  await coordinator.confirmSequence(tenantId, sequence, value);
  return result;
}

/**
 * O que `highestNumber` exige do banco: o D1 e a camada Postgres servem. O SQL
 * é o mesmo nos dois dialetos (`substr`, `CAST … AS INTEGER`, `LIKE`).
 */
export interface NumberSource {
  prepare(sql: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
}

/**
 * Maior número já usado numa sequência com prefixo fixo.
 *
 * O `substr` começa depois do prefixo e o `CAST` descarta os zeros à esquerda;
 * sem o CAST a ordenação seria textual e 'COL-00009' viria depois de
 * 'COL-00010'.
 */
export async function highestNumber(
  db: NumberSource,
  table: string,
  column: string,
  tenantId: string,
  prefix: string,
): Promise<number> {
  // `table` e `column` entram no SQL por interpolação, porque um parâmetro não
  // pode nomear tabela nem coluna. Todos os pontos de chamada passam literais,
  // e esta guarda existe para que continuem passando: um identificador vindo de
  // requisição aqui seria injeção de SQL.
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) {
    throw new Error(`Identificador inválido em highestNumber: ${table}.${column}`);
  }

  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(CAST(substr(${column}, ?) AS INTEGER)), 0) AS last
         FROM ${table}
        WHERE tenant_id = ? AND ${column} LIKE ?`,
    )
    .bind(prefix.length + 1, tenantId, `${prefix}%`)
    .first<{ last: number }>();
  return row?.last ?? 0;
}
