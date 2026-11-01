#!/usr/bin/env bash
# Gera os arquivos .dev.vars dos Workers a partir de secrets/local/.
#
# Existe porque escrever esses arquivos à mão já falhou: `.dev.vars` é formato
# dotenv, e um PEM colado entre três aspas — que é como um YAML aceitaria — vira
# uma variável truncada na primeira quebra de linha. O sintoma foi todo token
# ser recusado como inválido, sem nenhuma mensagem apontando para o arquivo.
#
# A quebra de linha é escapada como \n dentro de aspas duplas, que é o que o
# dotenv entende e o que a jose espera receber de volta.
#
#   ./scripts/cf-devvars.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SECRETS="${SSM_SECRETS_DIR:-$PWD/secrets/local}"
[ -d "$SECRETS" ] || { echo "Sem $SECRETS. Rode ./scripts/gen-secrets.sh antes." >&2; exit 1; }

# Escapa um valor multilinha para dotenv.
esc() { python3 -c 'import sys;print(open(sys.argv[1]).read().replace("\\","\\\\").replace("\n","\\n").replace("\"","\\\""))' "$1"; }

emit() {
  local worker="$1"; shift
  local file="workers/$worker/.dev.vars"
  {
    echo "# Gerado por scripts/cf-devvars.sh a partir de secrets/local/."
    echo "# Não editar à mão e não versionar — .dev.vars é ignorado pelo git."
    for pair in "$@"; do
      local name="${pair%%=*}" src="${pair#*=}"
      # Marcador vazio não vira variável vazia: o Worker distingue "ausente" de
      # "presente e em branco", e o segundo caso produz erro de assinatura
      # obscuro em vez da mensagem que diz o que preencher.
      if [ ! -s "$SECRETS/$src" ]; then
        echo "  aviso: $SECRETS/$src está vazio; $name não foi escrita" >&2
        continue
      fi
      printf '%s="%s"\n' "$name" "$(esc "$SECRETS/$src")"
    done
  } > "$file"
  chmod 600 "$file"
  printf '  %-12s %s\n' "$worker" "$(grep -c '^[A-Z]' "$file") variáveis"
}

# A chave privada vai só para identity: é o único Worker que assina. Os demais
# recebem a pública e verificam — a mesma separação da pilha em contêiner.
emit identity   JWT_PUBLIC_KEY=jwt_public_key.pem JWT_PRIVATE_KEY=jwt_private_key.pem

# A conexão local do Hyperdrive NÃO vai no .dev.vars. O wrangler a lê do
# ambiente do próprio processo (ou do .env), antes de o Worker existir: com a
# variável só no .dev.vars, `wrangler dev` recusa subir ("you should use a local
# Postgres connection string"). Medido, não suposto. .env é ignorado pelo git.
if [ -s "$SECRETS/neon_identity_url" ]; then
  umask 077
  printf 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="%s"\n' \
    "$(< "$SECRETS/neon_identity_url")" > workers/identity/.env
  chmod 600 workers/identity/.env
  printf '  %-12s %s\n' identity "conexão Neon (.env)"
else
  echo "  aviso: $SECRETS/neon_identity_url ausente; o identity não conecta no Neon" >&2
fi
emit financial  JWT_PUBLIC_KEY=jwt_public_key.pem
# O jurídico assina URL de envio e leitura do PDF do contrato, e para isso
# precisa das credenciais S3 do R2 — o binding R2 lê e escreve, mas não assina.
emit legal      JWT_PUBLIC_KEY=jwt_public_key.pem \
                R2_ACCESS_KEY_ID=r2_access_key_id \
                R2_SECRET_ACCESS_KEY=r2_secret_access_key
emit operations JWT_PUBLIC_KEY=jwt_public_key.pem
emit gateway    JWT_PUBLIC_KEY=jwt_public_key.pem
# Só o Worker de pessoas recebe a chave de cifra do CPF.
emit hr         JWT_PUBLIC_KEY=jwt_public_key.pem PII_ENCRYPTION_KEY=pii_encryption_key

echo
echo "Pronto. Nenhum destes arquivos é versionado; confira com: make secrets-check"
