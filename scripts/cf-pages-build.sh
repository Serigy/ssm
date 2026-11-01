#!/usr/bin/env bash
# Monta o pacote do Cloudflare Pages: shell na raiz, remotes sob /mfe/.
#
#   ./scripts/cf-pages-build.sh hmg
#   ./scripts/cf-pages-build.sh prd
#
# Um projeto de Pages só, e não cinco.
#
# Cada remote poderia ter hostname próprio, como tinha porta própria em
# desenvolvimento. Mesma origem é melhor por três motivos: o `remoteEntry.js` não
# vira requisição entre origens, e portanto não precisa de CORS; o cookie de
# refresh continua sendo do mesmo site, sem `SameSite` afrouxado; e há um
# certificado, um domínio e um deploy a acompanhar em vez de cinco.
#
# É a mesma forma que o Ingress do Kubernetes servia — cada módulo sob um
# prefixo — então o build do shell não muda de ideia ao trocar de plataforma.
set -euo pipefail

ENV_NAME="${1:?informe o ambiente: hmg ou prd}"
[[ "$ENV_NAME" == "hmg" || "$ENV_NAME" == "prd" ]] || { echo "ambiente inválido"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/dist/pages-$ENV_NAME"
# O DSN vai para o navegador de qualquer forma: só escreve eventos, não lê nada.
SENTRY_DSN="https://71cfb0837a680268f47ce443dc3cd21a@o4504600654118912.ingest.us.sentry.io/4512357145444352"
RELEASE="$(git rev-parse --short=12 HEAD)"
REMOTES=(financial hr legal operations)

rm -rf "$OUT"
mkdir -p "$OUT/mfe"

echo "Montando o pacote de $ENV_NAME"
echo

for m in "${REMOTES[@]}"; do
  printf '  remote %-11s ' "$m"
  # `base` precisa casar com onde o arquivo vai ficar: o remoteEntry resolve os
  # irmãos dele relativo a isto, e errar aqui carrega em desenvolvimento e dá
  # 404 em produção.
  # O build roda de dentro do app: a raiz do Vite é o diretório de trabalho, e
  # da raiz do monorepo ele procura index.html no lugar errado.
  ( cd "apps/mfe-$m" && VITE_PUBLIC_PATH="/mfe/$m/" \
      npx vite build --outDir "$OUT/mfe/$m" --emptyOutDir ) > "/tmp/ssm-build-$m.log" 2>&1 \
    && echo "ok" || { echo "FALHOU — ver /tmp/ssm-build-$m.log"; exit 1; }
done

printf '  shell              '
# Caminho relativo à própria origem: o shell não precisa saber o hostname, e o
# mesmo artefato serve homologação e produção se um dia isso for desejável.
( cd apps/shell \
  && VITE_REMOTE_FINANCIAL="/mfe/financial/remoteEntry.js" \
     VITE_REMOTE_HR="/mfe/hr/remoteEntry.js" \
     VITE_REMOTE_LEGAL="/mfe/legal/remoteEntry.js" \
     VITE_REMOTE_OPERATIONS="/mfe/operations/remoteEntry.js" \
     VITE_SENTRY_DSN="$SENTRY_DSN" \
     VITE_SENTRY_ENVIRONMENT="$ENV_NAME" \
     VITE_SENTRY_RELEASE="$RELEASE" \
     npx vite build --outDir "$OUT" --emptyOutDir=false ) > /tmp/ssm-build-shell.log 2>&1 \
  && echo "ok" || { echo "FALHOU — ver /tmp/ssm-build-shell.log"; exit 1; }

# O roteamento é do lado do cliente: /financeiro e /operacoes/sla não existem
# como arquivo, e sem isto o Pages devolveria 404 em qualquer recarga de página
# que não fosse a raiz.
# Uma regra só. A anterior tinha um /mfe/* reescrevendo para ele mesmo, que não
# fazia nada e consumia a correspondência: caminhos de dois níveis como
# /financeiro/nova caíam no 404 do Pages em vez do index.html.
cat > "$OUT/_redirects" <<'REDIR'
/*  /index.html  200
REDIR

# O Pages não deve responder por /api: quem responde são os Workers, e a rota
# deles tem precedência. Declarar a exclusão evita que uma requisição de API
# chegue a servir o index.html quando um Worker estiver fora do ar — o que
# transformaria uma falha de API num 200 com HTML, e o cliente tentaria fazer
# JSON.parse de uma página.
cat > "$OUT/_routes.json" <<'ROUTES'
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/api/*"]
}
ROUTES

echo
echo "  pacote em ${OUT#$ROOT/}"
du -sh "$OUT" | awk '{print "  tamanho: "$1}'
echo
# Os mapas vão ao Sentry e saem do pacote: publicados, entregariam o código-fonte
# a qualquer visitante.
if command -v sentry-cli >/dev/null; then
  sentry-cli sourcemaps inject "$OUT"
  sentry-cli sourcemaps upload --org serigy-tecnologia --project ssm-web \
    --release "$RELEASE" "$OUT"
else
  echo "aviso: sentry-cli ausente; os source maps de $RELEASE não foram enviados" >&2
fi
find "$OUT" -name '*.map' -delete

echo "Publicar:"
echo "  npx wrangler pages deploy $OUT --project-name ssm-$ENV_NAME"
