-- operations · Postgres (Neon)
--
-- Tradução de workers/migrations/operations/0001_init.sql (D1). Diferenças:
--
--   booleanos        INTEGER 0/1 com CHECK (x IN (0,1)) -> boolean. O CHECK some
--                    porque o tipo já é o invariante.
--   carimbos         TEXT ISO -> timestamptz(3). Três casas, como o ISO do D1:
--                    o cursor de paginação é um carimbo em milissegundos.
--   mês da apuração  TEXT 'AAAA-MM-01' com GLOB -> date com CHECK de dia 1.
--   crédito de SLA   INTEGER -> bigint (menor unidade) + char(3) ISO-4217.
--   tags, timeline,  TEXT com json_valid -> jsonb, com o formato (array ou
--   next_window      objeto) imposto pelo banco.
--   busca            FTS5 e gatilhos -> coluna tsvector gerada + GIN.

CREATE SCHEMA IF NOT EXISTS operations;

CREATE TABLE operations.environments (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL,
  code                     text NOT NULL,
  name                     text NOT NULL,
  kind                     text NOT NULL,
  status                   text NOT NULL DEFAULT 'operational',
  region                   text,
  provider                 text,
  contract_ref             text,
  availability_target_bps  integer NOT NULL DEFAULT 9950,
  response_sev1_minutes    integer NOT NULL DEFAULT 15,
  response_sev2_minutes    integer NOT NULL DEFAULT 60,
  response_sev3_minutes    integer NOT NULL DEFAULT 480,
  tags                     jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_window              jsonb,
  notes                    text,
  created_at               timestamptz(3) NOT NULL DEFAULT now(),
  created_by               text,
  updated_at               timestamptz(3) NOT NULL DEFAULT now(),
  updated_by               text,

  CONSTRAINT environments_kind_ck CHECK (kind IN ('production','staging','development','data','legacy')),
  CONSTRAINT environments_status_ck CHECK (status IN ('operational','incident','scheduled_window','decommissioned')),
  -- Meta fora de 0..100% é erro de digitação que corromperia toda apuração futura.
  CONSTRAINT environments_target_ck CHECK (availability_target_bps BETWEEN 0 AND 10000),
  CONSTRAINT environments_response_ck CHECK (
    response_sev1_minutes > 0 AND response_sev2_minutes > 0 AND response_sev3_minutes > 0),
  CONSTRAINT environments_tags_ck CHECK (jsonb_typeof(tags) = 'array'),
  CONSTRAINT environments_window_ck CHECK (next_window IS NULL OR jsonb_typeof(next_window) = 'object')
);

CREATE TABLE operations.tickets (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL,
  number             integer NOT NULL,
  subject            text NOT NULL,
  description        text NOT NULL DEFAULT '',
  kind               text NOT NULL DEFAULT 'incident',
  severity           text NOT NULL,
  status             text NOT NULL DEFAULT 'open',
  environment_id     text REFERENCES operations.environments(id) ON DELETE SET NULL,
  environment_code   text,
  assignee_id        text,
  opened_at          timestamptz(3) NOT NULL,
  first_response_at  timestamptz(3),
  resolved_at        timestamptz(3),
  closed_at          timestamptz(3),
  response_due_at    timestamptz(3) NOT NULL,
  response_breached  boolean NOT NULL DEFAULT false,
  paused_minutes     integer NOT NULL DEFAULT 0,
  waiting_since      timestamptz(3),
  timeline           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  created_by         text,
  updated_at         timestamptz(3) NOT NULL DEFAULT now(),
  updated_by         text,

  -- Busca: minúsculas, sem acento e sem pontuação ("alvaro" acha "Álvaro",
  -- "prd" acha "PRD-01"). translate() é imutável, o que a coluna gerada exige.
  search             tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', lower(translate(
      subject || ' ' || coalesce(environment_code, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ@._-',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn    '
    )))
  ) STORED,

  CONSTRAINT tickets_severity_ck CHECK (severity IN ('sev1','sev2','sev3')),
  CONSTRAINT tickets_status_ck CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed','cancelled')),
  -- Um chamado resolvido diz quando: sem isso a apuração tem uma
  -- indisponibilidade que não sabe fechar.
  CONSTRAINT tickets_resolved_at_ck CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  CONSTRAINT tickets_resolved_after_open_ck CHECK (resolved_at IS NULL OR resolved_at >= opened_at),
  CONSTRAINT tickets_paused_ck CHECK (paused_minutes >= 0),
  CONSTRAINT tickets_timeline_ck CHECK (jsonb_typeof(timeline) = 'array')
);

CREATE TABLE operations.sla_periods (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL,
  environment_id    text NOT NULL REFERENCES operations.environments(id) ON DELETE CASCADE,
  environment_code  text NOT NULL,
  month             date NOT NULL,
  measured_minutes  integer NOT NULL,
  downtime_minutes  integer NOT NULL,
  achieved_bps      integer NOT NULL,
  target_bps        integer NOT NULL,
  breached          boolean NOT NULL DEFAULT false,
  credit_minor      bigint,
  credit_currency   char(3),
  reckoned_at       timestamptz(3) NOT NULL DEFAULT now(),

  CONSTRAINT sla_month_first_ck CHECK (extract(day FROM month) = 1),
  CONSTRAINT sla_bps_ck CHECK (achieved_bps BETWEEN 0 AND 10000 AND target_bps BETWEEN 0 AND 10000),
  CONSTRAINT sla_minutes_ck CHECK (measured_minutes >= 0 AND downtime_minutes >= 0
         AND downtime_minutes <= measured_minutes),
  CONSTRAINT sla_credit_pair_ck CHECK ((credit_minor IS NULL) = (credit_currency IS NULL)),
  -- Sem descumprimento não há crédito. Este número vai para uma fatura.
  CONSTRAINT sla_credit_needs_breach_ck CHECK (breached OR credit_minor IS NULL),
  CONSTRAINT sla_credit_positive_ck CHECK (credit_minor IS NULL OR credit_minor > 0)
);

CREATE UNIQUE INDEX environments_tenant_code_uq ON operations.environments (tenant_id, code);
CREATE INDEX environments_tenant_status_idx ON operations.environments (tenant_id, status);
CREATE UNIQUE INDEX tickets_tenant_number_uq ON operations.tickets (tenant_id, number);
CREATE INDEX tickets_tenant_status_idx ON operations.tickets (tenant_id, status, severity);
CREATE INDEX tickets_environment_idx ON operations.tickets (environment_id);
CREATE INDEX tickets_tenant_cursor_idx ON operations.tickets (tenant_id, created_at DESC, id DESC);
CREATE INDEX tickets_search_idx ON operations.tickets USING gin (search);
-- Alimenta a varredura de prazos, que roda a cada minuto.
CREATE INDEX tickets_pending_response_idx ON operations.tickets (response_due_at)
  WHERE first_response_at IS NULL AND NOT response_breached;
-- Uma apuração por ambiente por mês, imposta pelo banco.
CREATE UNIQUE INDEX sla_periods_unique ON operations.sla_periods (tenant_id, environment_id, month);

CREATE TABLE operations.outbox (
  id              text PRIMARY KEY,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  tenant_id       text NOT NULL,
  actor_id        text,
  correlation_id  text NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  published_at    timestamptz(3),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,

  CONSTRAINT outbox_attempts_ck CHECK (attempts >= 0)
);
CREATE INDEX outbox_unpublished_idx ON operations.outbox (created_at) WHERE published_at IS NULL;

-- Acesso do papel do módulo, tabela a tabela (nunca schema_migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssm_operations') THEN
    GRANT USAGE ON SCHEMA operations TO ssm_operations;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON operations.environments, operations.tickets, operations.sla_periods, operations.outbox
      TO ssm_operations;
    ALTER DEFAULT PRIVILEGES IN SCHEMA operations
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ssm_operations;
  END IF;
END
$$;
