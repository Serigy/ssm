-- financial · D1 (SQLite)
--
-- Traduzido de apps/financial-svc/src/database/migrations/1747000000000-InitFinancial.
-- O que muda em relação ao Postgres, e o que não muda:
--
--   MANTÉM  CHECK e chave estrangeira. SQLite tem os dois, e são justamente as
--           garantias que protegem o dinheiro contra um UPDATE manual.
--   MANTÉM  inteiros para dinheiro. SQLite INTEGER é de 64 bits, então
--           bigint continua exato.
--   PERDE   tipos uuid, date e timestamptz. Viram TEXT com CHECK de formato —
--           SQLite não tem tipo de data, e fingir que tem é como se acaba com
--           '2026-8-1' e '2026-08-01' na mesma coluna.
--   PERDE   pg_trgm. A busca passa a usar FTS5, declarada ao final.
--   PERDE   índice parcial com WHERE em coluna nullable? Não — SQLite suporta.

PRAGMA foreign_keys = ON;

CREATE TABLE invoices (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  number             TEXT,
  status             TEXT NOT NULL DEFAULT 'draft',
  counterparty_id    TEXT NOT NULL,
  counterparty_name  TEXT NOT NULL,
  issue_date         TEXT,
  due_date           TEXT NOT NULL,
  currency           TEXT NOT NULL,
  subtotal_minor     INTEGER NOT NULL DEFAULT 0,
  tax_total_minor    INTEGER NOT NULL DEFAULT 0,
  total_minor        INTEGER NOT NULL DEFAULT 0,
  amount_paid_minor  INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  document_key       TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by         TEXT,

  CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  CHECK (length(currency) = 3),
  -- Um valor pago acima do total é bug em algum lugar; recusar guardá-lo.
  CHECK (amount_paid_minor BETWEEN 0 AND total_minor),
  -- Uma fatura emitida carrega número e data de emissão, sempre.
  CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL)),
  -- SQLite não tem tipo de data: a forma é imposta aqui ou não é imposta.
  CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (issue_date IS NULL OR issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE TABLE invoice_lines (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  description       TEXT NOT NULL,
  quantity_milli    INTEGER NOT NULL,
  unit_price_minor  INTEGER NOT NULL,
  tax_rate_bps      INTEGER NOT NULL DEFAULT 0,
  line_total_minor  INTEGER NOT NULL,

  CHECK (quantity_milli > 0),
  CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  UNIQUE (invoice_id, position)
);

-- Tenant à frente, como no Postgres: o predicado que está em toda consulta.
CREATE INDEX invoices_tenant_status_idx ON invoices (tenant_id, status, due_date);
CREATE UNIQUE INDEX invoices_tenant_number_uq
  ON invoices (tenant_id, number) WHERE number IS NOT NULL;
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);
-- Paginação por cursor: (created_at, id) descendente.
CREATE INDEX invoices_tenant_cursor_idx ON invoices (tenant_id, created_at DESC, id DESC);

CREATE TABLE outbox (
  id              TEXT PRIMARY KEY,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  type            TEXT NOT NULL,
  payload         TEXT NOT NULL,           -- JSON, lido com json_extract
  tenant_id       TEXT NOT NULL,
  actor_id        TEXT,
  correlation_id  TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at    TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,

  CHECK (json_valid(payload))
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

-- Busca. O pg_trgm resolvia curinga à esquerda; o FTS5 resolve por termo, que
-- é o que a caixa de busca realmente faz. Substring dentro de palavra deixa de
-- funcionar — é a perda real desta migração, e vale medir com dado de verdade
-- antes de considerá-la aceitável.
CREATE VIRTUAL TABLE invoices_fts USING fts5(
  number, counterparty_name,
  content = 'invoices', content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER invoices_fts_insert AFTER INSERT ON invoices BEGIN
  INSERT INTO invoices_fts(rowid, number, counterparty_name)
    VALUES (new.rowid, new.number, new.counterparty_name);
END;
CREATE TRIGGER invoices_fts_delete AFTER DELETE ON invoices BEGIN
  INSERT INTO invoices_fts(invoices_fts, rowid, number, counterparty_name)
    VALUES ('delete', old.rowid, old.number, old.counterparty_name);
END;
CREATE TRIGGER invoices_fts_update AFTER UPDATE ON invoices BEGIN
  INSERT INTO invoices_fts(invoices_fts, rowid, number, counterparty_name)
    VALUES ('delete', old.rowid, old.number, old.counterparty_name);
  INSERT INTO invoices_fts(rowid, number, counterparty_name)
    VALUES (new.rowid, new.number, new.counterparty_name);
END;
