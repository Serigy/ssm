-- legal · D1
--
-- Aqui a mudança é de modelo, não só de dialeto. O ADR 0004 escolheu MongoDB
-- porque um contrato é uma árvore de cláusulas de profundidade arbitrária e cada
-- aditivo produz uma versão completa dela. Com D1 não há escolha de motor, então
-- a pergunta do ADR se dissolve — e a resposta prática é a que ele já
-- considerava: guardar a árvore como JSON.
--
-- O SQLite tem JSON1, então a árvore continua consultável (json_extract,
-- json_tree) sem virar texto opaco. O que se perde de verdade é o índice de
-- texto ponderado do Mongo, substituído aqui por FTS5.

PRAGMA foreign_keys = ON;

CREATE TABLE contracts (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  reference            TEXT NOT NULL,
  title                TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft',
  parties              TEXT NOT NULL DEFAULT '[]',
  governing_law        TEXT,
  jurisdiction         TEXT,
  effective_from       TEXT,
  effective_to         TEXT,
  renewal_notice_days  INTEGER NOT NULL DEFAULT 30,
  auto_renew           INTEGER NOT NULL DEFAULT 0,   -- SQLite não tem boolean
  value_minor          INTEGER,
  value_currency       TEXT,
  risk                 TEXT,
  tags                 TEXT NOT NULL DEFAULT '[]',
  current_version      INTEGER NOT NULL DEFAULT 1,
  clauses              TEXT NOT NULL DEFAULT '[]',   -- a árvore, recursiva
  obligations          TEXT NOT NULL DEFAULT '[]',
  document_key         TEXT,
  -- Guarda a data de fim para a qual o aviso já saiu, para que uma renovação
  -- que mova a data rearme o alerta sozinha.
  expiry_notice_sent_for TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by           TEXT,

  CHECK (status IN ('draft','in_review','awaiting_signature','active','expired','terminated')),
  CHECK (auto_renew IN (0,1)),
  CHECK (renewal_notice_days BETWEEN 0 AND 365),
  CHECK ((value_minor IS NULL) = (value_currency IS NULL)),
  CHECK (json_valid(parties) AND json_valid(tags)),
  CHECK (json_valid(clauses) AND json_valid(obligations)),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  -- Ativar exige data de início: o ADR 0004 impunha isso na aplicação; aqui o
  -- banco também impõe, o que é ganho e não perda.
  CHECK (status <> 'active' OR effective_from IS NOT NULL)
);

-- Histórico. No Mongo eram snapshots embutidos no documento; aqui viram linhas,
-- o que evita carregar dez versões de uma árvore só para ler a vigente.
CREATE TABLE contract_versions (
  contract_id   TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  note          TEXT,
  document_key  TEXT,
  clauses       TEXT NOT NULL,
  PRIMARY KEY (contract_id, version),
  CHECK (json_valid(clauses))
);

CREATE UNIQUE INDEX contracts_tenant_reference_uq ON contracts (tenant_id, reference);
CREATE INDEX contracts_tenant_status_idx ON contracts (tenant_id, status, effective_to);
-- Alimenta a varredura de vencimentos.
CREATE INDEX contracts_expiring_idx
  ON contracts (tenant_id, effective_to) WHERE effective_to IS NOT NULL;
CREATE INDEX contracts_tenant_cursor_idx ON contracts (tenant_id, created_at DESC, id DESC);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, tenant_id TEXT NOT NULL, actor_id TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  CHECK (json_valid(payload))
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

-- O Mongo dava pesos (referência 10, título 5, parte 1). O FTS5 dá pesos na
-- consulta, com bm25(), e não no esquema — a ponderação some daqui e reaparece
-- em quem consulta.
-- Busca. Diferente dos outros módulos, esta tabela é sem conteúdo em vez de
-- apontar para `contracts`: uma FTS5 de conteúdo externo lê as colunas da
-- tabela de origem, e `parties_text` não é coluna — as partes são um array
-- JSON. O texto é extraído pelo gatilho.
CREATE VIRTUAL TABLE contracts_fts USING fts5(
  reference, title, parties_text,
  content = '', tokenize = "unicode61 remove_diacritics 2"
);

-- Sem estes gatilhos a tabela acima nunca recebe uma linha, e a busca devolve
-- vazio para todo termo — sem erro nenhum, que é o modo mais caro de falhar.
CREATE TRIGGER contracts_fts_insert AFTER INSERT ON contracts BEGIN
  INSERT INTO contracts_fts(rowid, reference, title, parties_text)
  VALUES (
    new.rowid, new.reference, new.title,
    (SELECT group_concat(json_extract(value, '$.name'), ' ') FROM json_each(new.parties))
  );
END;

-- Numa tabela sem conteúdo o índice não guarda o texto, então apagar exige
-- reapresentar exatamente os valores indexados. Errar aqui não dá erro: deixa
-- lixo no índice e a busca passa a devolver contrato que já não existe.
CREATE TRIGGER contracts_fts_delete AFTER DELETE ON contracts BEGIN
  INSERT INTO contracts_fts(contracts_fts, rowid, reference, title, parties_text)
  VALUES (
    'delete', old.rowid, old.reference, old.title,
    (SELECT group_concat(json_extract(value, '$.name'), ' ') FROM json_each(old.parties))
  );
END;

CREATE TRIGGER contracts_fts_update AFTER UPDATE ON contracts BEGIN
  INSERT INTO contracts_fts(contracts_fts, rowid, reference, title, parties_text)
  VALUES (
    'delete', old.rowid, old.reference, old.title,
    (SELECT group_concat(json_extract(value, '$.name'), ' ') FROM json_each(old.parties))
  );
  INSERT INTO contracts_fts(rowid, reference, title, parties_text)
  VALUES (
    new.rowid, new.reference, new.title,
    (SELECT group_concat(json_extract(value, '$.name'), ' ') FROM json_each(new.parties))
  );
END;
