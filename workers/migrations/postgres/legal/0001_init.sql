-- legal · Postgres (Neon)
--
-- Tradução de workers/migrations/legal/0001_init.sql (D1). A árvore de cláusulas
-- (ADR 0004) agora é jsonb de verdade: indexável, validada pelo tipo e sem o
-- json_valid de texto. Diferenças:
--
--   árvore e listas  TEXT com json_valid -> jsonb, com o formato (array)
--                    imposto pelo banco: parties, tags, clauses, obligations.
--   boolean          auto_renew INTEGER 0/1 -> boolean.
--   datas civis      TEXT -> date (vigência, aviso de vencimento enviado).
--   carimbos         TEXT ISO -> timestamptz(3); o cursor de paginação é um
--                    carimbo em milissegundos.
--   valor            INTEGER -> bigint (menor unidade) + char(3) ISO-4217.
--   busca            FTS5 sem conteúdo e três gatilhos -> uma coluna tsvector
--                    gerada + GIN, sem extensão. Os nomes das partes saem do
--                    jsonb por jsonb_path_query_array (imutável, ao contrário
--                    de uma subconsulta, que coluna gerada não aceita).
--   etiquetas        o EXISTS com json_each vira `tags @> '["x"]'` (GIN).
--
-- Mantém todos os CHECKs, e aperta dois que o D1 deixava soltos: kind e risk
-- agora só aceitam os valores do contrato (@ssm/contracts).

CREATE SCHEMA IF NOT EXISTS legal;

CREATE TABLE legal.contracts (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL,
  reference              text NOT NULL,
  title                  text NOT NULL,
  kind                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'draft',
  parties                jsonb NOT NULL DEFAULT '[]'::jsonb,
  governing_law          text,
  jurisdiction           text,
  effective_from         date,
  effective_to           date,
  renewal_notice_days    integer NOT NULL DEFAULT 30,
  auto_renew             boolean NOT NULL DEFAULT false,
  value_minor            bigint,
  value_currency         char(3),
  risk                   text,
  tags                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_version        integer NOT NULL DEFAULT 1,
  clauses                jsonb NOT NULL DEFAULT '[]'::jsonb,   -- a árvore, recursiva
  obligations            jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_key           text,
  -- Guarda a data de fim para a qual o aviso já saiu, para que uma renovação
  -- que mova a data rearme o alerta sozinha.
  expiry_notice_sent_for date,
  created_at             timestamptz(3) NOT NULL DEFAULT now(),
  created_by             text,
  updated_at             timestamptz(3) NOT NULL DEFAULT now(),
  updated_by             text,

  -- Busca por referência, título e nome das partes: minúsculas, sem acento e
  -- sem pontuação ("sustentacao" acha "Sustentação"). translate() é imutável,
  -- o que a coluna gerada exige.
  search                 tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', lower(translate(
      reference || ' ' || title || ' ' ||
        coalesce(jsonb_path_query_array(parties, '$[*].name'::jsonpath)::text, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ@._-',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn    '
    )))
  ) STORED,

  CONSTRAINT contracts_status_ck CHECK (status IN ('draft','in_review','awaiting_signature','active','expired','terminated')),
  CONSTRAINT contracts_kind_ck CHECK (kind IN ('nda','service_agreement','employment','lease','supplier','license','other')),
  CONSTRAINT contracts_risk_ck CHECK (risk IS NULL OR risk IN ('low','medium','high','critical')),
  CONSTRAINT contracts_renewal_days_ck CHECK (renewal_notice_days BETWEEN 0 AND 365),
  CONSTRAINT contracts_value_pair_ck CHECK ((value_minor IS NULL) = (value_currency IS NULL)),
  CONSTRAINT contracts_currency_ck CHECK (value_currency IS NULL OR value_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT contracts_parties_ck CHECK (jsonb_typeof(parties) = 'array'),
  CONSTRAINT contracts_tags_ck CHECK (jsonb_typeof(tags) = 'array'),
  CONSTRAINT contracts_clauses_ck CHECK (jsonb_typeof(clauses) = 'array'),
  CONSTRAINT contracts_obligations_ck CHECK (jsonb_typeof(obligations) = 'array'),
  CONSTRAINT contracts_dates_ck CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CONSTRAINT contracts_version_ck CHECK (current_version >= 1),
  -- Ativar exige data de início: o ADR 0004 impunha isso na aplicação; aqui o
  -- banco também impõe, o que é ganho e não perda.
  CONSTRAINT contracts_active_has_start_ck CHECK (status <> 'active' OR effective_from IS NOT NULL)
);

-- Histórico. No Mongo eram snapshots embutidos no documento; aqui viram linhas,
-- o que evita carregar dez versões de uma árvore só para ler a vigente.
CREATE TABLE legal.contract_versions (
  contract_id   text NOT NULL REFERENCES legal.contracts(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  created_at    timestamptz(3) NOT NULL,
  created_by    text,
  note          text,
  document_key  text,
  clauses       jsonb NOT NULL,
  PRIMARY KEY (contract_id, version),
  CONSTRAINT contract_versions_clauses_ck CHECK (jsonb_typeof(clauses) = 'array'),
  CONSTRAINT contract_versions_version_ck CHECK (version >= 1)
);

CREATE UNIQUE INDEX contracts_tenant_reference_uq ON legal.contracts (tenant_id, reference);
CREATE INDEX contracts_tenant_status_idx ON legal.contracts (tenant_id, status, effective_to);
-- Alimenta a varredura de vencimentos.
CREATE INDEX contracts_expiring_idx
  ON legal.contracts (tenant_id, effective_to) WHERE effective_to IS NOT NULL;
CREATE INDEX contracts_tenant_cursor_idx ON legal.contracts (tenant_id, created_at DESC, id DESC);
CREATE INDEX contracts_search_idx ON legal.contracts USING gin (search);
CREATE INDEX contracts_tags_idx ON legal.contracts USING gin (tags jsonb_path_ops);

CREATE TABLE legal.outbox (
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
CREATE INDEX outbox_unpublished_idx ON legal.outbox (created_at) WHERE published_at IS NULL;

-- Acesso do papel do módulo, tabela a tabela (nunca schema_migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssm_legal') THEN
    GRANT USAGE ON SCHEMA legal TO ssm_legal;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON legal.contracts, legal.contract_versions, legal.outbox TO ssm_legal;
    ALTER DEFAULT PRIVILEGES IN SCHEMA legal
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ssm_legal;
  END IF;
END
$$;
