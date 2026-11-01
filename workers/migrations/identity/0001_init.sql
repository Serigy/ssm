-- identity · D1
--
-- A decisão em aberto está aqui: o Argon2id atual pede 64 MiB e o Worker tem
-- 128 MiB no total. Ver workers/README.md — ou baixamos o custo de memória, ou
-- trocamos a função, ou a autenticação interna passa a ser o Cloudflare Access.
-- O esquema não muda em nenhum dos três casos.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'invited',
  roles            TEXT NOT NULL DEFAULT '[]',   -- JSON; SQLite não tem array
  last_login_at    TEXT,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       TEXT,

  CHECK (status IN ('active','invited','suspended','disabled')),
  CHECK (json_valid(roles)),
  CHECK (failed_attempts >= 0)
);

-- Índice sobre lower(email): "Ana@x.com" e "ana@x.com" são a mesma pessoa.
CREATE UNIQUE INDEX users_tenant_email_uq ON users (tenant_id, lower(email));

CREATE TABLE refresh_tokens (
  token_hash   TEXT PRIMARY KEY,            -- SHA-256; o token nunca é guardado
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  family_id    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  revoked_at   TEXT,
  user_agent   TEXT,
  ip_address   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CHECK (length(token_hash) = 64)
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
-- Revogar por família é uma escrita só; o índice é o que a torna barata.
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);
