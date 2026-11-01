#!/usr/bin/env bash
# Aplica as migrações D1 dos módulos que ainda estão no D1 em um ambiente.
#
#   ./scripts/cf-migrate.sh dev    # local, no Miniflare
#   ./scripts/cf-migrate.sh hmg
set -euo pipefail

ENV_NAME="${1:-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# identity, hr e outros já estão no Neon (ADR 0014): suas migrações são as de
# workers/migrations/postgres/, aplicadas por apply.mjs, não pelo D1.
MODULES=(legal)

# Credencial em arquivo, como no cf-provision.sh.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -z "${CLOUDFLARE_API_KEY:-}" ] && [ "$ENV_NAME" != "dev" ]; then
  [ -r "$ROOT/secrets/local/cloudflare_api_key" ] && {
    CLOUDFLARE_API_KEY="$(< "$ROOT/secrets/local/cloudflare_api_key")"; export CLOUDFLARE_API_KEY
    CLOUDFLARE_EMAIL="$(< "$ROOT/secrets/local/cloudflare_email")"; export CLOUDFLARE_EMAIL
  }
fi
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-86dd3c836ae52e572ce13a51e3d63390}"

# O estado local é compartilhado pelos seis Workers; sem isto a migração de dev
# criaria um banco paralelo dentro do diretório de cada módulo.
FLAGS=()
if [[ "$ENV_NAME" == "dev" ]]; then
  # O estado local é compartilhado pelos seis; sem isto cada módulo criaria um
  # banco paralelo dentro do próprio diretório.
  FLAGS=(--local --persist-to "$ROOT/workers/.wrangler-state")
else
  FLAGS=(--remote --env "$ENV_NAME")
fi

for m in "${MODULES[@]}"; do
  echo "== $m =="
  npx wrangler d1 migrations apply "ssm-${m}$([[ "$ENV_NAME" == "hmg" ]] && echo -hmg)" \
    --config "workers/${m}/wrangler.jsonc" "${FLAGS[@]}"
done
