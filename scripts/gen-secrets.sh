#!/usr/bin/env bash
# Generate the local development secret files under secrets/local/.
# Idempotent: existing files are left alone unless --force is passed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${SSM_SECRETS_DIR:-$ROOT/secrets/local}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

mkdir -p "$DEST"
chmod 700 "$DEST"

log()  { printf '  \033[32m%-28s\033[0m %s\n' "$1" "$2"; }
skip() { printf '  \033[90m%-28s kept\033[0m\n' "$1"; }

# write <name> <value>
write() {
  local name="$1" value="$2" path="$DEST/$1"
  if [[ -s "$path" && $FORCE -eq 0 ]]; then skip "$name"; return; fi
  printf '%s' "$value" > "$path"
  # 0644, not 0600: Docker and Kubernetes mount these into containers that run
  # as a different uid (postgres 999, mongo 999, our services 10001), and a
  # 0600 file owned by the host user is unreadable there. The 0700 directory
  # is what protects them on the host; inside a container the file lives in a
  # per-container tmpfs that nothing else can see.
  chmod 644 "$path"
  log "$name" "generated"
}

# placeholder <name> <hint> — empty file the developer must fill in
placeholder() {
  local name="$1" path="$DEST/$1"
  if [[ -e "$path" && $FORCE -eq 0 ]]; then skip "$name"; return; fi
  : > "$path"
  chmod 644 "$path"
  printf '  \033[33m%-28s EMPTY — fill in: %s\033[0m\n' "$name" "$2"
}

rand() { openssl rand -base64 "${1:-32}" | tr -d '\n=+/' | cut -c1-"${2:-32}"; }

echo "Generating development secrets in $DEST"
echo

write postgres_password  "$(rand 32 32)"
write mongo_password     "$(rand 32 32)"
write rabbitmq_password  "$(rand 32 32)"
write session_secret     "$(rand 48 44)"
# Used by pgcrypto to encrypt the national id column in hr-svc. Rotating it
# requires re-encrypting that column — see docs/runbooks/rotate-secrets.md.
write pii_encryption_key "$(rand 48 44)"
# MinIO stands in for R2 locally, so the same S3 code path is exercised.
write minio_password     "$(rand 32 32)"

# --- JWT signing keypair (RS256) -------------------------------------------
if [[ ! -s "$DEST/jwt_private_key.pem" || $FORCE -eq 1 ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$DEST/jwt_private_key.pem" 2>/dev/null
  openssl pkey -in "$DEST/jwt_private_key.pem" -pubout \
    -out "$DEST/jwt_public_key.pem" 2>/dev/null
  chmod 644 "$DEST/jwt_private_key.pem" "$DEST/jwt_public_key.pem"
  log jwt_private_key.pem "RS256 2048-bit"
  log jwt_public_key.pem  "derived"
else
  skip jwt_private_key.pem
  skip jwt_public_key.pem
fi

# --- Values that cannot be invented ----------------------------------------
placeholder r2_account_id        "Cloudflare dashboard -> R2 -> Account ID"
placeholder r2_access_key_id     "Cloudflare dashboard -> R2 -> Manage API tokens"
placeholder r2_secret_access_key "Cloudflare dashboard -> R2 -> Manage API tokens"
placeholder aikido_token         "app.aikido.dev -> Settings -> CI token"

# --- RabbitMQ definitions ---------------------------------------------------
# RabbitMQ 4 removed RABBITMQ_DEFAULT_PASS_FILE and refuses to start when it is
# set. The supported path is a definitions file — which is better anyway,
# because it carries a salted *hash* rather than the password itself.
#
# The hash format is base64(salt || sha256(salt || utf8(password))) with a
# 4-byte salt, per RabbitMQ's rabbit_password_hashing_sha256.
GEN_DIR="$ROOT/deploy/local/generated"
mkdir -p "$GEN_DIR"
DEFS="$GEN_DIR/rabbitmq-definitions.json"

if [[ ! -s "$DEFS" || $FORCE -eq 1 ]]; then
  RABBIT_HASH="$(python3 - "$DEST/rabbitmq_password" <<'PYEOF'
import base64, hashlib, os, sys
password = open(sys.argv[1], 'rb').read().rstrip(b'\n')
salt = os.urandom(4)
print(base64.b64encode(salt + hashlib.sha256(salt + password).digest()).decode())
PYEOF
)"

  cat > "$DEFS" <<JSON
{
  "rabbit_version": "4.0.0",
  "rabbitmq_version": "4.0.0",
  "users": [
    {
      "name": "ssm",
      "password_hash": "${RABBIT_HASH}",
      "hashing_algorithm": "rabbit_password_hashing_sha256",
      "tags": ["administrator"]
    }
  ],
  "vhosts": [{ "name": "/" }],
  "permissions": [
    { "user": "ssm", "vhost": "/", "configure": ".*", "write": ".*", "read": ".*" }
  ],
  "topic_permissions": [],
  "parameters": [],
  "global_parameters": [],
  "policies": [],
  "queues": [],
  "exchanges": [],
  "bindings": []
}
JSON
  # Readable by the rabbitmq user inside the container. It holds a hash, not
  # the password, and the directory itself is not published anywhere.
  chmod 644 "$DEFS"
  log rabbitmq-definitions.json "hash gerado"
else
  skip rabbitmq-definitions.json
fi

echo
echo "Done. These files are ignored by git — see secrets/README.md."
echo "Local object storage falls back to MinIO when the R2 files are empty."
