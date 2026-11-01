#!/usr/bin/env bash
# Empurra os segredos do 1Password para o Cloudflare, sem que nenhum deles
# encoste no disco.
#
# Substitui secrets/ para a plataforma Cloudflare. O motivo de secrets/ existir
# — não ter credencial em variável de ambiente nem em arquivo do repositório —
# continua valendo; muda só quem guarda: `wrangler secret` cifra na conta e o
# valor só é legível pelo Worker em execução.
#
#   ./scripts/cf-secrets.sh hmg
#   ./scripts/cf-secrets.sh prd
set -euo pipefail

ENV_NAME="${1:?informe o ambiente: hmg ou prd}"
[[ "$ENV_NAME" == "hmg" || "$ENV_NAME" == "prd" ]] || { echo "ambiente inválido: $ENV_NAME"; exit 1; }

VAULT="${OP_VAULT:-Serigy-Plataforma}"
ITEM="${OP_ITEM:-ssm/$ENV_NAME}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v op >/dev/null || { echo "op CLI não encontrado."; exit 1; }

# O token da conta de serviço é um arquivo, como todo segredo neste projeto.
#
# A alternativa óbvia — exportar no ~/.bashrc — falha por dois motivos. O
# prático: a guarda de shell não interativo no topo do .bashrc padrão do Debian
# retorna antes de chegar na linha, então processo automatizado nenhum enxerga a
# variável. O de fundo: uma credencial exportada no perfil fica no ambiente de
# todo processo da máquina, que é exatamente o que secrets/ existe para evitar.
#
# Aqui ela só entra no ambiente do `op`, e só pela duração da chamada.
TOKEN_FILE="${OP_TOKEN_FILE:-$ROOT/secrets/local/op_service_account_token}"
if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  [ -r "$TOKEN_FILE" ] || {
    cat >&2 <<MSG
Token da conta de serviço do 1Password não encontrado.

Grave-o em ${TOKEN_FILE#"$ROOT/"} — o diretório já é ignorado pelo git e o CI
recusa o commit se ele aparecer rastreado:

  install -m 600 /dev/null secrets/local/op_service_account_token
  printf '%s' 'ops_...' > secrets/local/op_service_account_token

Use um token novo: qualquer um que já tenha passado por chat, log ou histórico
de shell deve ser considerado exposto e rotacionado.
MSG
    exit 1
  }
  # Permissão frouxa num arquivo de credencial é achado de auditoria.
  perms=$(stat -c '%a' "$TOKEN_FILE")
  [ "$perms" = "600" ] || [ "$perms" = "400" ] || {
    echo "Recusado: $TOKEN_FILE está com permissão $perms. Use 600." >&2
    exit 1
  }
  OP_SERVICE_ACCOUNT_TOKEN=$(< "$TOKEN_FILE")
  export OP_SERVICE_ACCOUNT_TOKEN
fi

op whoami >/dev/null 2>&1 || {
  echo "O token foi lido mas o 1Password recusou a sessão. Ele expirou ou foi revogado?" >&2
  exit 1
}

# Resolve o item para o seu id.
#
# `op read op://cofre/item/campo` quebra quando o título do item tem barra — e
# os itens da Serigy têm, como `cloudflare/account-api-token`. A barra é
# separador de caminho e não há escape que o `op` aceite. Resolver para o id
# uma vez, e usar `op item get`, contorna isso e ainda torna o script imune a
# renomeação do item.
item_id() {
  local titulo="$1"
  op item get "$titulo" --vault "$VAULT" --format=json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null
}

# De onde sai o valor: cofre, ou arquivo local como alternativa.
#
# O cofre é a fonte pretendida. O arquivo existe porque a conta de serviço do
# 1Password tem leitura e não escrita, então uma chave recém-gerada ainda não
# está lá — e sem esta alternativa o primeiro deploy de um ambiente ficaria
# preso esperando alguém importar à mão. O aviso é ruidoso de propósito: um
# ambiente cujas chaves só existem em disco não tem fonte de verdade.
#
# valor <item-no-1password> <campo> <arquivo-local>
valor() {
  local titulo="$1" field="$2" arquivo="$3"
  local id; id="$(item_id "$titulo")"
  if [ -n "$id" ] && op item get "$id" --vault "$VAULT" --fields "$field" --reveal 2>/dev/null; then
    return 0
  fi
  if [ -n "$arquivo" ] && [ -s "$ROOT/$arquivo" ]; then
    cat "$ROOT/$arquivo"
    return 0
  fi
  return 1
}

# put <worker> <nome-do-segredo> <item> <campo> [arquivo-local]
put() {
  local worker="$1" secret="$2" titulo="$3" field="$4" arquivo="${5:-}"
  printf '  %-12s %-22s ' "$worker" "$secret"

  local origem="cofre"
  if [ -z "$(item_id "$titulo")" ] && [ -n "$arquivo" ] && [ -s "$ROOT/$arquivo" ]; then
    origem="ARQUIVO"
  fi

  # O valor vai por stdin: um argumento de linha de comando apareceria em `ps`
  # e no histórico do shell.
  if valor "$titulo" "$field" "$arquivo" \
      | npx wrangler secret put "$secret" \
          --config "$ROOT/workers/${worker}/wrangler.jsonc" \
          --env "$ENV_NAME" >/dev/null 2>&1; then
    echo "ok ($origem)"
  else
    echo "FALHOU — nem \"$titulo/$field\" no cofre, nem $arquivo"
  fi
}

echo "Enviando segredos para ${ENV_NAME} (cofre ${VAULT}, item \"${ITEM}\")"
echo

# A chave pública vai para todos: todo Worker verifica token localmente.
for w in identity financial hr legal operations gateway; do
  put "$w" JWT_PUBLIC_KEY "$ITEM" jwt-public-key "secrets/$ENV_NAME/jwt_public_key.pem"
done

# A privada vai só para identity. Um Worker comprometido em outro módulo não
# consegue forjar token — a mesma regra do chart Helm, mesma razão.
put identity JWT_PRIVATE_KEY "$ITEM" jwt-private-key "secrets/$ENV_NAME/jwt_private_key.pem"

# A chave de PII vai só para hr. Substitui o pgcrypto: agora a cifragem é
# AES-GCM no Worker, e a chave nunca existe do lado do banco.
put hr PII_ENCRYPTION_KEY "$ITEM" pii-encryption-key "secrets/$ENV_NAME/pii_encryption_key"

# Só o jurídico assina URL do R2, e para isso precisa de credencial S3 própria.
#
# Não reaproveita `cloudflare/r2-s3-credentials`: aquele token é do snapshot de
# etcd do k3s e alcança outro balde. Um token que serve a dois propósitos
# alcança a união dos dois, e some do escopo de quem revisa qual é qual.
#
# R2_ACCOUNT_ID não entra aqui porque não é segredo — ele aparece em toda URL
# do R2 e vive nas `vars` do wrangler.jsonc.
put legal R2_ACCESS_KEY_ID     "ssm/r2-documents" access-key-id
put legal R2_SECRET_ACCESS_KEY "ssm/r2-documents" secret-access-key

if grep -q ARQUIVO /dev/null 2>&1; then :; fi
echo
echo "Se algum valor saiu de ARQUIVO, ele ainda não está no cofre. Importe:"
echo "  op item create --vault $VAULT --category 'Secure Note' --title '$ITEM' \\"
echo "    \"jwt-private-key[password]=\$(cat secrets/$ENV_NAME/jwt_private_key.pem)\" \\"
echo "    \"jwt-public-key[text]=\$(cat secrets/$ENV_NAME/jwt_public_key.pem)\" \\"
echo "    \"pii-encryption-key[password]=\$(cat secrets/$ENV_NAME/pii_encryption_key)\""
echo
echo "Conferir o que está gravado (nomes, nunca valores):"
echo "  npx wrangler secret list --config workers/identity/wrangler.jsonc --env $ENV_NAME"
