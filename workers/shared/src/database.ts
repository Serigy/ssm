import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './app.js';

/**
 * Camada de banco sobre Postgres (Neon, via Hyperdrive).
 *
 * ADR 0014: o D1 sai e o Neon entra, módulo por módulo. Esta interface tem o
 * mesmo subconjunto do D1 que o código dos Workers usa — `prepare().bind()` com
 * `first()`, `all()` e `run()`, e `batch()` — para que a troca de um módulo seja
 * de SQL e de uma linha de acesso, e não uma reescrita da lógica.
 *
 * O que NÃO é igual, e por quê:
 *
 *   `?` vira `$n`        o Postgres não tem `?`; ver `toPositional`.
 *   `batch()`            o D1 o executa de forma atômica. Aqui é BEGIN/COMMIT na
 *                        mesma conexão, com ROLLBACK no primeiro erro.
 *   datas                `timestamptz` volta como string ISO-8601 em UTC, a
 *                        mesma forma que o código já comparava como texto.
 *   inteiros de 64 bits  `bigint` volta como número, como o INTEGER do D1.
 *                        Acima de 2^53 lança, em vez de arredondar sem aviso.
 *   `?` como operador    os operadores jsonb `?`, `?|` e `?&` não podem ser
 *                        usados; escreva `jsonb_exists(col, 'chave')`.
 *   arrays               não são aceitos como parâmetro. O driver os trataria
 *                        como array do Postgres, e quem quer JSON deve passar
 *                        `JSON.stringify(x)` com `?::jsonb`.
 */

export interface DbMeta {
  /** Linhas afetadas por INSERT, UPDATE ou DELETE. Em SELECT, as linhas lidas. */
  changes: number;
}

export interface DbResult<T = unknown> {
  results: T[];
  success: true;
  meta: DbMeta;
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DbResult<T>>;
}

export interface Database {
  prepare(sql: string): DbStatement;
  /** Atômico: ou todas as instruções valem, ou nenhuma. */
  batch(statements: DbStatement[]): Promise<DbResult[]>;
  /**
   * Transação interativa: ler, decidir e escrever na mesma conexão, com
   * COMMIT se `fn` retornar e ROLLBACK se lançar. O `tx` recebido é o banco a
   * usar lá dentro (`SELECT … FOR UPDATE` funciona nele); um `batch()` de `tx`
   * entra na mesma transação em vez de abrir outra.
   *
   * Transações e `batch()` do mesmo banco rodam uma de cada vez: a conexão é
   * uma só, e duas transações nela se misturariam.
   */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
}

/** Banco aberto para uma requisição. Precisa ser fechado ao fim dela. */
export interface ManagedDatabase extends Database {
  close(): Promise<void>;
}

/** O que a camada exige do driver: o `pg.Client` e o PGlite (com adaptador) servem. */
export interface PgConnection {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

// --- `?` -> `$n` ------------------------------------------------------------

/**
 * Troca cada `?` por `$1`, `$2`, … na ordem em que aparecem.
 *
 * Um `replace(/\?/g, …)` ingênuo quebraria um literal como `'quem?'` ou um
 * comentário, então a varredura pula tudo o que não é código: literais `'…'`,
 * identificadores `"…"`, comentários de linha (`--`) e de bloco (que no Postgres
 * aninham) e texto entre cifrões `$tag$…$tag$`.
 */
export function toPositional(sql: string): { text: string; count: number } {
  let out = '';
  let count = 0;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === "'" || ch === '"') {
      // Aspa dobrada ('' ou "") é a forma de escapar dentro do literal.
      let j = i + 1;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      out += sql.slice(i, j);
      i = j;
    } else if (ch === '$') {
      // `$1` já é posicional e passa como está; `$tag$` abre texto literal.
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const stop = close === -1 ? n : close + tag[0].length;
        out += sql.slice(i, stop);
        i = stop;
      } else {
        out += ch;
        i++;
      }
    } else if (ch === '?') {
      count++;
      out += `$${count}`;
      i++;
    } else {
      out += ch;
      i++;
    }
  }

  return { text: out, count };
}

// --- implementação ----------------------------------------------------------

function normalize(value: unknown, index: number): unknown {
  if (value === undefined) {
    // O D1 também recusa. Gravar NULL sem ninguém ter pedido esconde bug.
    throw new Error(`Parâmetro ${index + 1} é undefined; use null para NULL.`);
  }
  if (Array.isArray(value)) {
    throw new Error(
      `Parâmetro ${index + 1} é um array; passe JSON.stringify(...) com ?::jsonb.`,
    );
  }
  return value;
}

class PgStatement implements DbStatement {
  constructor(
    readonly owner: PgDatabase,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new PgStatement(this.owner, this.sql, values.map(normalize));
  }

  async first<T>(column?: string): Promise<T | null> {
    const { results } = await this.owner.exec(this);
    const row = results[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column === undefined ? row : (row[column] ?? null)) as T;
  }

  async all<T>(): Promise<DbResult<T>> {
    return this.owner.exec(this) as Promise<DbResult<T>>;
  }

  async run<T>(): Promise<DbResult<T>> {
    return this.owner.exec(this) as Promise<DbResult<T>>;
  }
}

class PgDatabase implements Database {
  /** Fila das transações e batches deste banco (uma conexão = uma de cada vez). */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * `inTransaction`: este objeto é o `tx` de uma transação em curso. Nele o
   * `batch` e o `transaction` entram na transação existente, sem BEGIN próprio —
   * um BEGIN dentro de outro só emite aviso e o COMMIT interno confirmaria o de
   * fora.
   */
  constructor(
    private readonly connect: () => Promise<PgConnection>,
    private readonly inTransaction = false,
  ) {}

  prepare(sql: string): DbStatement {
    return new PgStatement(this, sql);
  }

  async exec(stmt: PgStatement): Promise<DbResult> {
    const { text, count } = toPositional(stmt.sql);
    if (count !== stmt.params.length) {
      // Falhar aqui é melhor que o Postgres responder "bind message supplies N
      // parameters", que não diz qual SQL foi.
      throw new Error(
        `SQL espera ${count} parâmetro(s) e recebeu ${stmt.params.length}: ${stmt.sql.slice(0, 80)}`,
      );
    }
    const c = await this.connect();
    const res = await c.query(text, stmt.params);
    return { results: res.rows, success: true, meta: { changes: res.rowCount ?? 0 } };
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async batch(statements: DbStatement[]): Promise<DbResult[]> {
    for (const s of statements) {
      if (!(s instanceof PgStatement) || s.owner !== this) {
        throw new Error('batch() recebeu uma instrução de outro banco.');
      }
    }
    if (statements.length === 0) return [];
    if (this.inTransaction) {
      const results: DbResult[] = [];
      for (const s of statements) results.push(await this.exec(s as PgStatement));
      return results;
    }
    return this.transaction(async (tx) => {
      const results: DbResult[] = [];
      for (const s of statements as PgStatement[]) {
        results.push(await (tx as PgDatabase).exec(new PgStatement(tx as PgDatabase, s.sql, s.params)));
      }
      return results;
    });
  }

  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    return this.serialize(async () => {
      const conn = await this.connect();
      const tx = new PgDatabase(async () => conn, true);
      await conn.query('BEGIN');
      try {
        const result = await fn(tx);
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        // Se o ROLLBACK também falhar, a causa que importa é a primeira.
        await conn.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    });
  }
}

/** Banco sobre uma conexão já aberta. Usado pelos testes, com PGlite. */
export function databaseOver(connection: PgConnection): Database {
  return new PgDatabase(async () => connection);
}

// --- tipos do driver --------------------------------------------------------

/** OIDs do Postgres que o driver precisa converter. */
const OID_INT8 = 20;
const OID_TIMESTAMPTZ = 1184;
const OID_DATE = 1082;

/** `timestamptz` como ISO-8601 em UTC — a forma que o código já comparava. */
export function parseTimestamptz(value: string): string {
  const d = new Date(value);
  // 'infinity' e afins não viram data; devolve o texto para não mentir.
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** `bigint` como número. Lança acima de 2^53 em vez de perder dígitos. */
export function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`bigint ${value} não cabe em um número JavaScript sem perda.`);
  }
  return n;
}

/**
 * Escolhe o conversor de cada tipo. Os que não são daqui seguem com o padrão do
 * driver.
 *
 * `date` volta como o texto 'AAAA-MM-DD', e não como Date: o driver o
 * transformaria em meia-noite no fuso da máquina, e a data de admissão de
 * alguém mudaria de dia conforme onde o Worker rodasse. O D1 guardava o mesmo
 * texto, e o código compara datas como texto.
 */
export function pgTypeParser(
  oid: number,
  format: string | undefined,
  fallback: (oid: number, format: string) => (value: string) => unknown,
): (value: string) => unknown {
  const text = format !== 'binary';
  if (text && oid === OID_TIMESTAMPTZ) return parseTimestamptz;
  if (text && oid === OID_INT8) return parseInt8;
  if (text && oid === OID_DATE) return (v: string) => v;
  return fallback(oid, format ?? 'text');
}

// --- conexão por requisição -------------------------------------------------

/**
 * Abre o banco de uma requisição. A conexão só é feita no primeiro uso, então
 * rota que não consulta nada (limite de taxa estourado, 404) não paga a ida ao
 * banco.
 *
 * O Hyperdrive mantém o pool; criar um cliente por requisição é o padrão
 * recomendado pela Cloudflare. `pg` (>= 8.16.3) é o driver que a documentação
 * recomenda para Hyperdrive, por ter a melhor compatibilidade com o cache.
 *
 * Quem chama deve chamar `close()` ao fim — ver `databaseMiddleware`.
 */
export function openDatabase(connectionString: string): ManagedDatabase {
  type PgClient = {
    connect(): Promise<void>;
    end(): Promise<void>;
  } & PgConnection;
  let client: Promise<PgClient> | undefined;

  const connect = (): Promise<PgConnection> => {
    client ??= (async () => {
      // Import dinâmico: o `pg` só entra no bundle de quem chama esta função.
      // Os Workers que seguem no D1 importam este pacote sem pagar por ele.
      const { default: pg } = await import('pg');
      const c = new pg.Client({
        connectionString,
        types: {
          getTypeParser: ((oid: number, format?: string) =>
            pgTypeParser(oid, format, (o, f) =>
              pg.types.getTypeParser(o, f as 'text'),
            )) as never,
        },
      }) as unknown as PgClient;
      await c.connect();
      return c;
    })();
    // Se a conexão falhou, a próxima consulta tenta de novo em vez de herdar o erro.
    client.catch(() => {
      client = undefined;
    });
    return client;
  };

  const db = new PgDatabase(connect) as PgDatabase & { close?: () => Promise<void> };
  db.close = async () => {
    const pending = client;
    client = undefined;
    if (!pending) return;
    const c = await pending.catch(() => undefined);
    await c?.end().catch(() => undefined);
  };
  return db as ManagedDatabase;
}

/** Quem tem o Hyperdrive tem `connectionString`; sem o binding, o erro diz qual. */
export function openFromBinding(hyperdrive: { connectionString: string } | undefined): ManagedDatabase {
  if (!hyperdrive) {
    throw new Error(
      'Binding HYPERDRIVE ausente. Em dev, defina CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE (scripts/cf-devvars.sh).',
    );
  }
  return openDatabase(hyperdrive.connectionString);
}

/**
 * Abre o banco da requisição em `c.get('db')` e o fecha ao fim dela.
 *
 * O fechamento vai em `waitUntil`: a resposta não espera o `end()`, mas o
 * isolate também não é encerrado antes dele.
 */
export function databaseMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const db = openFromBinding(c.env.HYPERDRIVE);
    c.set('db', db);
    try {
      await next();
    } finally {
      c.executionCtx.waitUntil(db.close());
    }
  };
}
