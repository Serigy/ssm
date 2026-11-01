#!/usr/bin/env bash
# Cria os recursos Cloudflare de um ambiente e grava os ids nos wrangler.jsonc.
#
# Idempotente: um recurso que já existe é reaproveitado. Rode uma vez por
# ambiente; depois disso, só se um recurso novo entrar no desenho.
#
#   ./scripts/cf-provision.sh hmg
set -euo pipefail

ENV_NAME="${1:?informe o ambiente: hmg ou prd}"
[[ "$ENV_NAME" == "hmg" || "$ENV_NAME" == "prd" ]] || { echo "ambiente inválido"; exit 1; }
SUFFIX=""; [[ "$ENV_NAME" == "hmg" ]] && SUFFIX="-hmg"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODULES=(identity financial hr legal operations)
WORKERS=(identity financial hr legal operations gateway)

# A credencial é arquivo, como todo segredo aqui, e entra só no ambiente do
# wrangler. Ver secrets/README.md.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  TOKEN_FILE="${CF_TOKEN_FILE:-$ROOT/secrets/local/cloudflare_api_token}"
  KEY_FILE="$ROOT/secrets/local/cloudflare_api_key"
  if [ -r "$TOKEN_FILE" ]; then
    CLOUDFLARE_API_TOKEN="$(< "$TOKEN_FILE")"; export CLOUDFLARE_API_TOKEN
  elif [ -r "$KEY_FILE" ]; then
    # Chave global: o wrangler a aceita junto do e-mail da conta. Ela alcança
    # tudo, então serve para o provisionamento inicial e deve ser trocada por
    # token com escopo assim que houver um.
    CLOUDFLARE_API_KEY="$(< "$KEY_FILE")"; export CLOUDFLARE_API_KEY
    EMAIL_FILE="$ROOT/secrets/local/cloudflare_email"
    if [ -z "${CLOUDFLARE_EMAIL:-}" ] && [ -r "$EMAIL_FILE" ]; then
      CLOUDFLARE_EMAIL="$(< "$EMAIL_FILE")"
    fi
    : "${CLOUDFLARE_EMAIL:?grave o e-mail da conta em secrets/local/cloudflare_email}"
    export CLOUDFLARE_EMAIL
  else
    echo "Sem credencial. Grave em secrets/local/cloudflare_api_token (preferido)" >&2
    echo "ou secrets/local/cloudflare_api_key, e veja secrets/README.md." >&2
    exit 1
  fi
fi
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-86dd3c836ae52e572ce13a51e3d63390}"

echo "Provisionando ${ENV_NAME}"
echo

echo "== D1 =="
for m in "${MODULES[@]}"; do
  name="ssm-${m}${SUFFIX}"
  printf '  %-24s ' "$name"
  if npx wrangler d1 info "$name" >/dev/null 2>&1; then
    echo "já existe"
  else
    npx wrangler d1 create "$name" >/dev/null 2>&1 && echo "criado" || echo "FALHOU"
  fi
done

echo
echo "== KV =="
printf '  %-24s ' "ssm-coordination${SUFFIX}"
npx wrangler kv namespace create "ssm-coordination${SUFFIX}" >/dev/null 2>&1 \
  && echo "criado" || echo "já existe ou falhou"

echo
echo "== Queues =="
for m in "${MODULES[@]}" dlq; do
  name="ssm-${m}${SUFFIX}"
  printf '  %-24s ' "$name"
  npx wrangler queues create "$name" >/dev/null 2>&1 && echo "criada" || echo "já existe ou falhou"
done

echo
echo "== R2 =="
printf '  %-24s ' "ssm-documents${SUFFIX}"
npx wrangler r2 bucket create "ssm-documents${SUFFIX}" >/dev/null 2>&1 \
  && echo "criado" || echo "já existe ou falhou"

echo
echo "== ids nos wrangler.jsonc =="

# Escrever os ids à mão é 12 substituições em 6 arquivos por ambiente, e um id
# no bloco errado só aparece quando o Worker lê o banco de outro ambiente — que
# é a categoria de erro mais cara possível aqui.
D1_JSON="$(npx wrangler d1 list --json 2>/dev/null)"
KV_JSON="$(npx wrangler kv namespace list 2>/dev/null)"

kv_id() {
  echo "$KV_JSON" | python3 -c '
import json,sys
alvo=sys.argv[1]
try: ns=json.load(sys.stdin)
except Exception: sys.exit(1)
for n in ns:
    if n.get("title","").endswith(alvo): print(n["id"]); break
' "$1"
}
d1_id() {
  echo "$D1_JSON" | python3 -c '
import json,sys
alvo=sys.argv[1]
try: bancos=json.load(sys.stdin)
except Exception: sys.exit(1)
for b in bancos:
    if b.get("name")==alvo: print(b.get("uuid") or b.get("id")); break
' "$1"
}

KV="$(kv_id "ssm-coordination${SUFFIX}")"
[ -z "$KV" ] && echo "  aviso: não achei o namespace KV ssm-coordination${SUFFIX}"

for w in "${WORKERS[@]}"; do
  # O gateway não tem banco; os demais têm o do próprio módulo.
  if [ "$w" = "gateway" ]; then
    [ -n "$KV" ] && python3 "$ROOT/scripts/cf-ids.py" "$ENV_NAME" "$w" --kv "$KV"
    continue
  fi
  D1="$(d1_id "ssm-${w}${SUFFIX}")"
  args=()
  [ -n "$D1" ] && args+=(--d1 "$D1")
  [ -n "$KV" ] && args+=(--kv "$KV")
  if [ ${#args[@]} -gt 0 ]; then
    python3 "$ROOT/scripts/cf-ids.py" "$ENV_NAME" "$w" "${args[@]}"
  else
    echo "  $w: nenhum id encontrado"
  fi
done

echo
echo "Confira o diff antes de seguir:  git diff workers/*/wrangler.jsonc"
echo "Depois: ./scripts/cf-secrets.sh ${ENV_NAME} && ./scripts/cf-migrate.sh ${ENV_NAME}"
