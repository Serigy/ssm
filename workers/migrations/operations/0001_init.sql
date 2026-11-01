-- operations · D1

PRAGMA foreign_keys = ON;

CREATE TABLE environments (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'operational',
  region                   TEXT,
  provider                 TEXT,
  contract_ref             TEXT,
  availability_target_bps  INTEGER NOT NULL DEFAULT 9950,
  response_sev1_minutes    INTEGER NOT NULL DEFAULT 15,
  response_sev2_minutes    INTEGER NOT NULL DEFAULT 60,
  response_sev3_minutes    INTEGER NOT NULL DEFAULT 480,
  tags                     TEXT NOT NULL DEFAULT '[]',
  next_window              TEXT,
  notes                    TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by               TEXT,
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by               TEXT,

  CHECK (kind IN ('production','staging','development','data','legacy')),
  CHECK (status IN ('operational','incident','scheduled_window','decommissioned')),
  -- Meta fora de 0..100% é erro de digitação que corromperia toda apuração futura.
  CHECK (availability_target_bps BETWEEN 0 AND 10000),
  CHECK (response_sev1_minutes > 0 AND response_sev2_minutes > 0 AND response_sev3_minutes > 0),
  CHECK (json_valid(tags)),
  CHECK (next_window IS NULL OR json_valid(next_window))
);

CREATE TABLE tickets (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  number             INTEGER NOT NULL,
  subject            TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  kind               TEXT NOT NULL DEFAULT 'incident',
  severity           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open',
  environment_id     TEXT REFERENCES environments(id) ON DELETE SET NULL,
  environment_code   TEXT,
  assignee_id        TEXT,
  opened_at          TEXT NOT NULL,
  first_response_at  TEXT,
  resolved_at        TEXT,
  closed_at          TEXT,
  response_due_at    TEXT NOT NULL,
  response_breached  INTEGER NOT NULL DEFAULT 0,
  paused_minutes     INTEGER NOT NULL DEFAULT 0,
  waiting_since      TEXT,
  timeline           TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by         TEXT,

  CHECK (severity IN ('sev1','sev2','sev3')),
  CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed','cancelled')),
  CHECK (response_breached IN (0,1)),
  -- Um chamado resolvido diz quando: sem isso a apuração tem uma
  -- indisponibilidade que não sabe fechar.
  CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  CHECK (resolved_at IS NULL OR resolved_at >= opened_at),
  CHECK (paused_minutes >= 0),
  CHECK (json_valid(timeline))
);

CREATE TABLE sla_periods (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  environment_id    TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  environment_code  TEXT NOT NULL,
  month             TEXT NOT NULL,
  measured_minutes  INTEGER NOT NULL,
  downtime_minutes  INTEGER NOT NULL,
  achieved_bps      INTEGER NOT NULL,
  target_bps        INTEGER NOT NULL,
  breached          INTEGER NOT NULL DEFAULT 0,
  credit_minor      INTEGER,
  credit_currency   TEXT,
  reckoned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-01'),
  CHECK (achieved_bps BETWEEN 0 AND 10000 AND target_bps BETWEEN 0 AND 10000),
  CHECK (measured_minutes >= 0 AND downtime_minutes >= 0
         AND downtime_minutes <= measured_minutes),
  CHECK ((credit_minor IS NULL) = (credit_currency IS NULL)),
  -- Sem descumprimento não há crédito. Este número vai para uma fatura.
  CHECK (breached = 1 OR credit_minor IS NULL),
  CHECK (breached IN (0,1))
);

CREATE UNIQUE INDEX environments_tenant_code_uq ON environments (tenant_id, code);
CREATE INDEX environments_tenant_status_idx ON environments (tenant_id, status);
CREATE UNIQUE INDEX tickets_tenant_number_uq ON tickets (tenant_id, number);
CREATE INDEX tickets_tenant_status_idx ON tickets (tenant_id, status, severity);
CREATE INDEX tickets_environment_idx ON tickets (environment_id);
-- Alimenta a varredura de prazos, que roda a cada minuto.
CREATE INDEX tickets_pending_response_idx ON tickets (response_due_at)
  WHERE first_response_at IS NULL AND response_breached = 0;
-- Uma apuração por ambiente por mês, imposta pelo banco.
CREATE UNIQUE INDEX sla_periods_unique ON sla_periods (tenant_id, environment_id, month);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, tenant_id TEXT NOT NULL, actor_id TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  CHECK (json_valid(payload))
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

CREATE VIRTUAL TABLE tickets_fts USING fts5(
  subject, environment_code,
  content = 'tickets', content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);
CREATE TRIGGER tickets_fts_insert AFTER INSERT ON tickets BEGIN
  INSERT INTO tickets_fts(rowid, subject, environment_code)
    VALUES (new.rowid, new.subject, new.environment_code);
END;
CREATE TRIGGER tickets_fts_delete AFTER DELETE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, subject, environment_code)
    VALUES ('delete', old.rowid, old.subject, old.environment_code);
END;
CREATE TRIGGER tickets_fts_update AFTER UPDATE ON tickets BEGIN
  INSERT INTO tickets_fts(tickets_fts, rowid, subject, environment_code)
    VALUES ('delete', old.rowid, old.subject, old.environment_code);
  INSERT INTO tickets_fts(rowid, subject, environment_code)
    VALUES (new.rowid, new.subject, new.environment_code);
END;
