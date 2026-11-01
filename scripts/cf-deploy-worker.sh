#!/usr/bin/env bash
# Implanta o Worker do diretório atual e manda os source maps ao Sentry.
#
#   pnpm --filter @ssm/worker-gateway deploy:hmg
#
# O bundle de todo Worker se chama index.js, então os mapas de dois Workers
# colidiriam numa release compartilhada e o stack de um seria lido com o mapa do
# outro. Por isso a release leva o nome do Worker.
#
# O envio dos mapas vem depois do deploy e não o impede: sem sentry-cli, o Worker
# sobe do mesmo jeito e só perde os stacks legíveis daquela versão.
set -euo pipefail

ENV_NAME="${1:?informe o ambiente: hmg ou prd}"
[[ "$ENV_NAME" == "hmg" || "$ENV_NAME" == "prd" ]] || { echo "ambiente inválido"; exit 1; }

WORKER="$(basename "$PWD")"
RELEASE="ssm-$WORKER@$(git rev-parse --short=12 HEAD)"

npx wrangler deploy --env "$ENV_NAME" --outdir dist --upload-source-maps \
  --var "SENTRY_RELEASE:$RELEASE"

command -v sentry-cli >/dev/null || {
  echo "aviso: sentry-cli ausente; os source maps de $RELEASE não foram enviados" >&2
  exit 0
}
sentry-cli sourcemaps upload --org serigy-tecnologia --project ssm-workers \
  --release "$RELEASE" --strip-prefix dist dist
