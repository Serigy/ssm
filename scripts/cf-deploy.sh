#!/usr/bin/env bash
# Implanta um ambiente inteiro: migrações, Workers e front-ends, nesta ordem.
#
#   ./scripts/cf-deploy.sh hmg
#   ./scripts/cf-deploy.sh prd
#
# A migração vem antes porque o Worker novo precisa do esquema novo, e nunca o
# contrário: o Worker antigo convive com uma coluna a mais. O gateway é o primeiro
# Worker porque é dono do Durable Object que os outros cinco acessam.
set -euo pipefail

ENV_NAME="${1:?informe o ambiente: hmg ou prd}"
[[ "$ENV_NAME" == "hmg" || "$ENV_NAME" == "prd" ]] || { echo "ambiente inválido"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/cf-migrate.sh "$ENV_NAME"

for worker in gateway identity financial hr legal operations; do
  echo "== $worker =="
  pnpm --filter "@ssm/worker-$worker" "deploy:$ENV_NAME"
done

./scripts/cf-pages-build.sh "$ENV_NAME"
pnpm --filter @ssm/worker-gateway exec wrangler pages deploy "$ROOT/dist/pages-$ENV_NAME" \
  --project-name "ssm-$ENV_NAME" --branch main
