#!/usr/bin/env bash
# Aplica as migrações Postgres (Neon) de todos os módulos em um ambiente.
#
#   ./scripts/cf-migrate.sh dev    # Neon de desenvolvimento, pelo arquivo local
#   NEON_MIGRATION_URL=... ./scripts/cf-migrate.sh hmg
#
# ADR 0014: todos os módulos estão no Neon e o D1 saiu. Este script já aplicou
# `wrangler d1 migrations apply`; agora é só uma porta de entrada para
# workers/migrations/postgres/apply.mjs, que é idempotente e nunca imprime a URL.
#
# Os papéis (ssm_<módulo>) precisam existir ANTES — as migrações só concedem a
# papel que já existe. Em dev:
#   node workers/migrations/postgres/roles.mjs --url-file secrets/local/neon_development_url \
#        --role-url-file <módulo>=secrets/local/neon_<módulo>_url <módulo>
set -euo pipefail

ENV_NAME="${1:-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$ENV_NAME" == "dev" ]]; then
  [ -r secrets/local/neon_development_url ] || {
    echo "Sem secrets/local/neon_development_url." >&2
    exit 1
  }
  exec node workers/migrations/postgres/apply.mjs --url-file secrets/local/neon_development_url
fi

# hmg e prd: a URL do dono do banco vem do ambiente do pipeline, nunca de um
# arquivo do repositório. Sem ela, falhar alto é melhor que "migrar" nada e
# seguir para o deploy.
if [ -z "${NEON_MIGRATION_URL:-}" ]; then
  echo "NEON_MIGRATION_URL ausente: sem ela não há como migrar o Neon de $ENV_NAME." >&2
  exit 1
fi
exec node workers/migrations/postgres/apply.mjs
