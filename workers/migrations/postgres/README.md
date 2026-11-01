# Migrações Postgres (Neon)

ADR 0014. Uma pasta por módulo, com o nome do schema: `identity/`, `hr/`, `operations/`, `financial/` e `legal/`. Os arquivos são escritos à mão e revisados.
`workers/migrations/<módulo>/` (sem `postgres/`) continua sendo o D1.

| Ambiente | Conexão no `usql` | Arquivo local |
|---|---|---|
| dev | `ssm_development` | `secrets/local/neon_development_url` (dono, endpoint direto) |
| dev, por módulo | — | `secrets/local/neon_<módulo>_url` (papel `ssm_<módulo>`) |

## Local

```bash
# 1. o papel do módulo (antes da migração: ela só concede a quem já existe)
node workers/migrations/postgres/roles.mjs \
  --url-file secrets/local/neon_development_url \
  --role-url-file identity=secrets/local/neon_identity_url identity
# (um módulo por chamada com --role-url-file; repita para cada módulo)

# 2. o esquema
node workers/migrations/postgres/apply.mjs --url-file secrets/local/neon_development_url

# 3. dados de demonstração (usa o papel do módulo)
pnpm --filter @ssm/worker-seed seed identity   # ou hr, operations, financial, legal

# 4. conexão do wrangler dev
./scripts/cf-devvars.sh
```

No CI, `NEON_MIGRATION_URL` (dono) e `NEON_IDENTITY_URL` (papel) no lugar dos
arquivos. Nenhum dos scripts imprime URL ou senha.

## Regras

- Migração aplicada não se edita; o checksum é conferido. Mudança é arquivo novo.
- Uma transação por arquivo, com o registro em `<schema>.schema_migrations`.
- Invariante vai em `CHECK`; o teste `test/postgres.spec.mjs` roda as migrações
  num Postgres em memória (PGlite) e confere que o banco recusa a violação.
- O papel do módulo recebe `GRANT` tabela a tabela. Nunca em `schema_migrations`.

## Hyperdrive de hmg e prd

Ainda não existem. Os `wrangler.jsonc` dos cinco módulos trazem `PENDENTE-CRIAR-HYPERDRIVE-*`
nesses dois ambientes, e o deploy deles fica impedido até os ids existirem. Cada
configuração usa o papel do módulo, não o dono.
