-- identity · Postgres (Neon)
--
-- Tradução de workers/migrations/identity/0001_init.sql (D1). O que muda, e só
-- isto: `roles` deixa de ser TEXT com json_valid e vira jsonb com CHECK de
-- array; as datas deixam de ser TEXT ISO-8601 e viram timestamptz. O Worker
-- devolve datas como a mesma string ISO que o D1 guardava (ver database.ts),
-- então o contrato da API não muda. Os CHECKs e as chaves estrangeiras seguem.
--
-- Cada módulo tem um schema e um papel próprios (ADR 0014): ssm_identity só
-- enxerga o schema identity. O papel é criado por roles.mjs, que é quem conhece
-- a senha; aqui só se concede, e só se ele já existir, para a migração rodar
-- também num banco sem o papel (o teste em memória, por exemplo).

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.users (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL,
  email            text NOT NULL,
  password_hash    text NOT NULL,
  display_name     text NOT NULL,
  status           text NOT NULL DEFAULT 'invited',
  roles            jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_login_at    timestamptz,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text,

  CONSTRAINT users_status_ck CHECK (status IN ('active','invited','suspended','disabled')),
  CONSTRAINT users_roles_array_ck CHECK (jsonb_typeof(roles) = 'array'),
  CONSTRAINT users_failed_attempts_ck CHECK (failed_attempts >= 0)
);

-- Índice sobre lower(email): "Ana@x.com" e "ana@x.com" são a mesma pessoa.
CREATE UNIQUE INDEX users_tenant_email_uq ON identity.users (tenant_id, lower(email));

CREATE TABLE identity.refresh_tokens (
  token_hash   text PRIMARY KEY,            -- SHA-256; o token nunca é guardado
  user_id      text NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  tenant_id    text NOT NULL,
  family_id    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  revoked_at   timestamptz,
  user_agent   text,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refresh_tokens_hash_len_ck CHECK (length(token_hash) = 64)
);
CREATE INDEX refresh_tokens_user_idx ON identity.refresh_tokens (user_id);
-- Revogar por família é uma escrita só; o índice é o que a torna barata.
CREATE INDEX refresh_tokens_family_idx ON identity.refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expiry_idx ON identity.refresh_tokens (expires_at);

-- Acesso do papel do módulo. As tabelas são nomeadas uma a uma, e não por
-- ALL TABLES: o schema também guarda schema_migrations, que a aplicação não
-- pode alterar (apagar o registro faria a migração rodar de novo). DEFAULT
-- PRIVILEGES cobre as tabelas das próximas migrações; o papel não recebe nada
-- fora deste schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssm_identity') THEN
    GRANT USAGE ON SCHEMA identity TO ssm_identity;
    GRANT SELECT, INSERT, UPDATE, DELETE ON identity.users, identity.refresh_tokens TO ssm_identity;
    ALTER DEFAULT PRIVILEGES IN SCHEMA identity
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ssm_identity;
  END IF;
END
$$;
