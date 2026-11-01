import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  databaseOver,
  parseInt8,
  parseTimestamptz,
  toPositional,
  type Database,
  type PgConnection,
} from './database.js';

describe('toPositional · ? vira $n', () => {
  test('numera na ordem em que os ? aparecem', () => {
    expect(toPositional('SELECT * FROM t WHERE a = ? AND b = ?')).toEqual({
      text: 'SELECT * FROM t WHERE a = $1 AND b = $2',
      count: 2,
    });
  });

  test('? dentro de literal não é parâmetro', () => {
    const r = toPositional("SELECT 'quem?' AS q, 'it''s ?' AS r WHERE id = ?");
    expect(r.text).toBe("SELECT 'quem?' AS q, 'it''s ?' AS r WHERE id = $1");
    expect(r.count).toBe(1);
  });

  test('? dentro de identificador entre aspas duplas não é parâmetro', () => {
    expect(toPositional('SELECT "a?b" FROM t WHERE x = ?').count).toBe(1);
  });

  test('? em comentário de linha e de bloco (aninhado) não é parâmetro', () => {
    const sql = 'SELECT 1 -- e agora?\n/* a? /* b? */ c? */ WHERE x = ?';
    const r = toPositional(sql);
    expect(r.count).toBe(1);
    expect(r.text.endsWith('WHERE x = $1')).toBe(true);
  });

  test('texto entre cifrões é preservado', () => {
    const r = toPositional("DO $f$ BEGIN RAISE NOTICE 'x?'; END $f$; SELECT ?");
    expect(r.count).toBe(1);
    expect(r.text).toContain("RAISE NOTICE 'x?'");
  });

  test('$1 já posicional passa como está e não conta', () => {
    expect(toPositional('SELECT $1').count).toBe(0);
  });

  test('sem parâmetros devolve o mesmo SQL', () => {
    const sql = 'SELECT 1';
    expect(toPositional(sql)).toEqual({ text: sql, count: 0 });
  });

  test('literal não fechado não derruba a varredura', () => {
    expect(toPositional("SELECT 'aberto ?").count).toBe(0);
  });
});

describe('tipos do driver', () => {
  test('timestamptz vira ISO-8601 em UTC, com o mesmo formato do D1', () => {
    expect(parseTimestamptz('2026-11-01 13:00:00.123+00')).toBe('2026-11-01T13:00:00.123Z');
    // Fuso diferente de UTC é normalizado: a comparação por texto depende disso.
    expect(parseTimestamptz('2026-11-01 10:00:00-03')).toBe('2026-11-01T13:00:00.000Z');
  });

  test('infinity não vira data', () => {
    expect(parseTimestamptz('infinity')).toBe('infinity');
  });

  test('bigint cabe em número; acima de 2^53 lança em vez de arredondar', () => {
    expect(parseInt8('9007199254740991')).toBe(9007199254740991);
    expect(() => parseInt8('9007199254740993')).toThrow(/não cabe/);
  });
});

describe('Database sobre Postgres', () => {
  let pg: PGlite;
  let db: Database;
  let log: string[];

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE t (
      id text PRIMARY KEY,
      n integer NOT NULL CHECK (n >= 0),
      at timestamptz
    )`);
  });
  afterAll(() => pg.close());

  beforeEach(async () => {
    await pg.exec('DELETE FROM t');
    log = [];
    // O adaptador registra o que chega ao servidor, para os testes verem o
    // BEGIN/COMMIT/ROLLBACK do batch e o SQL já convertido.
    const conn: PgConnection = {
      query: async (text, values) => {
        log.push(text);
        const r = await pg.query(text, values as unknown[]);
        return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
      },
    };
    db = databaseOver(conn);
  });

  test('run() informa meta.changes, que o código usa para saber se ganhou a corrida', async () => {
    await db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('a', 1).run();
    const lost = await db.prepare('UPDATE t SET n = 9 WHERE id = ? AND n = ?').bind('a', 0).run();
    expect(lost.meta.changes).toBe(0);
    const won = await db.prepare('UPDATE t SET n = 9 WHERE id = ? AND n = ?').bind('a', 1).run();
    expect(won.meta.changes).toBe(1);
  });

  test('first() devolve a linha, ou null quando não há', async () => {
    await db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('a', 5).run();
    expect(await db.prepare('SELECT * FROM t WHERE id = ?').bind('a').first()).toMatchObject({
      id: 'a',
      n: 5,
    });
    expect(await db.prepare('SELECT * FROM t WHERE id = ?').bind('zzz').first()).toBeNull();
    expect(await db.prepare('SELECT n FROM t WHERE id = ?').bind('a').first<number>('n')).toBe(5);
  });

  test('all() devolve results e a contagem de linhas', async () => {
    await db.prepare('INSERT INTO t (id, n) VALUES (?, ?), (?, ?)').bind('a', 1, 'b', 2).run();
    const r = await db.prepare('SELECT id FROM t ORDER BY id').all<{ id: string }>();
    expect(r.results.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.success).toBe(true);
  });

  test('o SQL chega ao servidor já com $n', async () => {
    await db.prepare('SELECT ? AS a, ? AS b').bind(1, 2).first();
    expect(log[0]).toBe('SELECT $1 AS a, $2 AS b');
  });

  test('batch() é atômico: o erro da segunda instrução desfaz a primeira', async () => {
    await expect(
      db.batch([
        db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('a', 1),
        // viola o CHECK (n >= 0): o banco recusa, não o código
        db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('b', -1),
      ]),
    ).rejects.toThrow(/check/i);

    const rows = await db.prepare('SELECT * FROM t').all();
    expect(rows.results).toHaveLength(0);
    expect(log).toContain('BEGIN');
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('COMMIT');
  });

  test('batch() que dá certo grava tudo e devolve um resultado por instrução', async () => {
    const out = await db.batch([
      db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('a', 1),
      db.prepare('UPDATE t SET n = n + 1 WHERE id = ?').bind('a'),
    ]);
    expect(out.map((r) => r.meta.changes)).toEqual([1, 1]);
    expect((await db.prepare('SELECT n FROM t').first<{ n: number }>())?.n).toBe(2);
    expect(log).toContain('COMMIT');
  });

  test('o banco continua utilizável depois de um batch revertido', async () => {
    await db
      .batch([db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('a', -1)])
      .catch(() => undefined);
    await db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').bind('ok', 1).run();
    expect((await db.prepare('SELECT * FROM t').all()).results).toHaveLength(1);
  });

  test('número de parâmetros diferente do de ? é erro antes de ir ao servidor', async () => {
    await expect(db.prepare('SELECT ?, ?').bind(1).first()).rejects.toThrow(/espera 2/);
    expect(log).toHaveLength(0);
  });

  test('undefined não vira NULL em silêncio', () => {
    expect(() => db.prepare('SELECT ?').bind(undefined)).toThrow(/undefined/);
  });

  test('array como parâmetro é recusado', () => {
    expect(() => db.prepare('SELECT ?').bind(['a'])).toThrow(/array/);
  });

  test('instrução de outro banco não entra no batch', async () => {
    const other = databaseOver({ query: async () => ({ rows: [], rowCount: 0 }) });
    await expect(db.batch([other.prepare('SELECT 1')])).rejects.toThrow(/outro banco/);
  });
});
