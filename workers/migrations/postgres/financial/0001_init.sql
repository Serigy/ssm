-- financial · Postgres (Neon)
--
-- Tradução de workers/migrations/financial/0001_init.sql (D1). Diferenças:
--
--   dinheiro      INTEGER -> bigint (menor unidade) + char(3) ISO-4217. Nunca
--                 numeric nem float. Quem calcula os valores continua sendo
--                 computeTotals (@ssm/contracts); o banco só os guarda e confere
--                 as relações entre eles.
--   datas         TEXT com GLOB -> date. O driver devolve 'AAAA-MM-DD'.
--   carimbos      TEXT ISO -> timestamptz(3); o cursor de paginação é um carimbo
--                 em milissegundos.
--   payload       TEXT com json_valid -> jsonb.
--   busca         FTS5 e gatilhos -> coluna tsvector gerada + GIN.
--
-- Os CHECKs que protegem o dinheiro contra um UPDATE manual seguem todos.

CREATE SCHEMA IF NOT EXISTS financial;

CREATE TABLE financial.invoices (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL,
  number             text,
  status             text NOT NULL DEFAULT 'draft',
  counterparty_id    text NOT NULL,
  counterparty_name  text NOT NULL,
  issue_date         date,
  due_date           date NOT NULL,
  currency           char(3) NOT NULL,
  subtotal_minor     bigint NOT NULL DEFAULT 0,
  tax_total_minor    bigint NOT NULL DEFAULT 0,
  total_minor        bigint NOT NULL DEFAULT 0,
  amount_paid_minor  bigint NOT NULL DEFAULT 0,
  notes              text,
  document_key       text,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  created_by         text,
  updated_at         timestamptz(3) NOT NULL DEFAULT now(),
  updated_by         text,

  -- Busca por número e contraparte: minúsculas, sem acento e sem pontuação
  -- ("fat" acha "FAT-2026-00001"; "sao" acha "São Paulo"). translate() é
  -- imutável, o que a coluna gerada exige. Perde a busca por trecho no meio da
  -- palavra que o pg_trgm dava — já registrada na migração do D1.
  search             tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', lower(translate(
      coalesce(number, '') || ' ' || counterparty_name,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ@._-',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn    '
    )))
  ) STORED,

  CONSTRAINT invoices_status_ck CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  CONSTRAINT invoices_currency_ck CHECK (currency ~ '^[A-Z]{3}$'),
  -- O total é a soma, sempre. O cálculo é de computeTotals; aqui só se confere.
  CONSTRAINT invoices_total_sum_ck CHECK (total_minor = subtotal_minor + tax_total_minor),
  -- Um valor pago acima do total é bug em algum lugar; recusar guardá-lo.
  CONSTRAINT invoices_paid_range_ck CHECK (amount_paid_minor BETWEEN 0 AND total_minor),
  -- Uma fatura emitida carrega número e data de emissão, sempre.
  CONSTRAINT invoices_issued_has_number_ck CHECK (
    status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL)),
  -- Paga é paga por inteiro; parcialmente paga é entre zero e o total, exclusive.
  CONSTRAINT invoices_paid_status_ck CHECK (
    (status <> 'paid' OR amount_paid_minor = total_minor)
    AND (status <> 'partially_paid' OR (amount_paid_minor > 0 AND amount_paid_minor < total_minor))),
  CONSTRAINT invoices_version_ck CHECK (version >= 1)
);

CREATE TABLE financial.invoice_lines (
  id                text PRIMARY KEY,
  invoice_id        text NOT NULL REFERENCES financial.invoices(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  description       text NOT NULL,
  quantity_milli    bigint NOT NULL,
  unit_price_minor  bigint NOT NULL,
  tax_rate_bps      integer NOT NULL DEFAULT 0,
  line_total_minor  bigint NOT NULL,

  CONSTRAINT invoice_lines_quantity_ck CHECK (quantity_milli > 0),
  CONSTRAINT invoice_lines_tax_ck CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT invoice_lines_position_uq UNIQUE (invoice_id, position)
);

-- Tenant à frente: o predicado que está em toda consulta.
CREATE INDEX invoices_tenant_status_idx ON financial.invoices (tenant_id, status, due_date);
CREATE UNIQUE INDEX invoices_tenant_number_uq
  ON financial.invoices (tenant_id, number) WHERE number IS NOT NULL;
CREATE INDEX invoice_lines_invoice_idx ON financial.invoice_lines (invoice_id);
-- Paginação por cursor: (created_at, id) descendente.
CREATE INDEX invoices_tenant_cursor_idx ON financial.invoices (tenant_id, created_at DESC, id DESC);
CREATE INDEX invoices_search_idx ON financial.invoices USING gin (search);

CREATE TABLE financial.outbox (
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
CREATE INDEX outbox_unpublished_idx ON financial.outbox (created_at) WHERE published_at IS NULL;

-- Acesso do papel do módulo, tabela a tabela (nunca schema_migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssm_financial') THEN
    GRANT USAGE ON SCHEMA financial TO ssm_financial;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON financial.invoices, financial.invoice_lines, financial.outbox TO ssm_financial;
    ALTER DEFAULT PRIVILEGES IN SCHEMA financial
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ssm_financial;
  END IF;
END
$$;
