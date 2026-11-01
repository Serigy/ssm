import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * As migrações do D1 rodadas contra SQLite de verdade.
 *
 * Não é o mesmo motor do D1, mas é a mesma linguagem: um CHECK que este
 * arquivo aceita é um CHECK que o D1 aceita, e — o que importa mais — um CHECK
 * que este arquivo *recusa* é um invariante que continua sendo defendido pelo
 * banco depois da migração do Postgres, e não apenas pelo código.
 */
const here = dirname(fileURLToPath(import.meta.url));
// Carrega todas as migrações do módulo, em ordem — é assim que o D1 as aplica,
// e testar só a 0001 deixaria de fora tudo que veio depois.
const load = (m) =>
  readdirSync(join(here, '..', m))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(here, '..', m, f), 'utf8'))
    .join('\n');

function db(module) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(load(module));
  return d;
}

const throws = (fn, what) => assert.throws(fn, undefined, `o banco deveria recusar: ${what}`);

describe('legal · busca de contratos', () => {
  const insert = (d, id, ref, title, parties) =>
    d.exec(
      `INSERT INTO contracts (id, tenant_id, reference, title, kind, parties)
       VALUES ('${id}', 't1', '${ref}', '${title}', 'servico', '${parties}')`,
    );

  test('o gatilho indexa referência, título e o nome das partes', () => {
    const d = db('legal');
    insert(d, 'c1', 'CT-2026-001', 'Sustentação de infraestrutura',
      '[{"name":"Prefeitura de Aracaju","role":"contratante"}]');

    const byTitle = d.prepare(
      `SELECT c.reference FROM contracts c
        WHERE c.rowid IN (SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH 'infraestrutura')`,
    ).all();
    assert.equal(byTitle.length, 1, 'busca por palavra do título');

    // A parte é o que alguém realmente digita ao procurar um contrato, e ela
    // não é coluna — vem de dentro do JSON. É o caso que o esquema original
    // deixava passar em silêncio.
    const byParty = d.prepare(
      `SELECT c.reference FROM contracts c
        WHERE c.rowid IN (SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH 'Aracaju')`,
    ).all();
    assert.equal(byParty.length, 1, 'busca pelo nome da parte');
  });

  test('acento não separa: "Sustentacao" acha "Sustentação"', () => {
    const d = db('legal');
    insert(d, 'c1', 'CT-2026-001', 'Sustentação mensal', '[]');
    const r = d.prepare(
      `SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH 'Sustentacao'`,
    ).all();
    assert.equal(r.length, 1);
  });

  test('apagar limpa o índice, para a busca não devolver contrato morto', () => {
    const d = db('legal');
    insert(d, 'c1', 'CT-2026-001', 'Sustentação de infraestrutura',
      '[{"name":"Prefeitura de Aracaju"}]');
    d.exec("DELETE FROM contracts WHERE id = 'c1'");

    const r = d.prepare(
      `SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH 'Aracaju'`,
    ).all();
    assert.equal(r.length, 0, 'o índice ficou com lixo após o DELETE');
  });

  test('renomear a parte reindexa: o nome antigo some, o novo acha', () => {
    const d = db('legal');
    insert(d, 'c1', 'CT-2026-001', 'Contrato', '[{"name":"Prefeitura de Aracaju"}]');
    d.exec(`UPDATE contracts SET parties = '[{"name":"Governo de Sergipe"}]' WHERE id = 'c1'`);

    const antigo = d.prepare(`SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH 'Aracaju'`).all();
    const novo = d.prepare(`SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH 'Sergipe'`).all();
    assert.equal(antigo.length, 0, 'o nome antigo continuou no índice');
    assert.equal(novo.length, 1, 'o nome novo não entrou no índice');
  });
});

describe('legal · invariantes de contrato', () => {
  const base = (extra = '', cols = '', vals = '') =>
    `INSERT INTO contracts (id, tenant_id, reference, title, kind${cols})
     VALUES ('c1', 't1', 'CT-1', 'Título', 'servico'${vals}) ${extra}`;

  test('ativar sem data de início é recusado', () => {
    const d = db('legal');
    throws(() => d.exec(base('', ', status', ", 'active'")), 'status active sem effective_from');
  });

  test('fim antes do início é recusado', () => {
    const d = db('legal');
    throws(
      () => d.exec(base('', ', effective_from, effective_to', ", '2026-06-01', '2026-01-01'")),
      'effective_to anterior a effective_from',
    );
  });

  test('valor sem moeda é recusado, e moeda sem valor também', () => {
    const d = db('legal');
    throws(() => d.exec(base('', ', value_minor', ', 100000')), 'valor sem moeda');
    throws(() => d.exec(base('', ', value_currency', ", 'BRL'")), 'moeda sem valor');
  });

  test('JSON inválido em clauses é recusado', () => {
    const d = db('legal');
    throws(() => d.exec(base('', ', clauses', ", 'nao-e-json'")), 'clauses com texto solto');
  });

  test('referência repetida no mesmo cliente é recusada, mas permitida entre clientes', () => {
    const d = db('legal');
    d.exec(base());
    throws(
      () => d.exec(`INSERT INTO contracts (id, tenant_id, reference, title, kind)
                    VALUES ('c2', 't1', 'CT-1', 'Outro', 'servico')`),
      'mesma referência no mesmo cliente',
    );
    d.exec(`INSERT INTO contracts (id, tenant_id, reference, title, kind)
            VALUES ('c3', 't2', 'CT-1', 'De outro cliente', 'servico')`);
  });
});

describe('consumo idempotente de eventos', () => {
  for (const module of ['financial', 'hr', 'legal', 'operations']) {
    test(`${module} · o segundo INSERT do mesmo evento não altera nada`, () => {
      const d = db(module);
      const stmt = (id) =>
        `INSERT OR IGNORE INTO processed_events (event_id, type, processed_at)
         VALUES ('${id}', 'x.y', '2026-08-18T12:00:00.000Z')`;

      const first = d.prepare(stmt('e1')).run();
      const second = d.prepare(stmt('e1')).run();

      // `changes === 0` é o sinal que o consumidor usa para decidir que o evento
      // já foi tratado. Se o INSERT OR IGNORE deixasse de ser trava — por
      // exemplo se alguém removesse a chave primária — este número viraria 1 e
      // todo efeito seria reaplicado a cada reentrega.
      assert.equal(first.changes, 1);
      assert.equal(second.changes, 0);
      assert.equal(d.prepare('SELECT COUNT(*) c FROM processed_events').get().c, 1);
    });
  }
});
