#!/usr/bin/env bash
# Runs the five services from their compiled dist, against the datastores in
# docker-compose. This is the inner loop from docs/runbooks/desenvolvimento-local.md:
# faster than rebuilding an image per change, and it exercises the same code.
#
#   ./scripts/dev-native.sh start | stop | status | logs <svc>
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.data/run"
mkdir -p "$RUN"

# Ports differ from the container defaults because Postgres and Mongo are
# published on non-standard ports to avoid colliding with anything already
# running on the developer's machine.
export SSM_SECRETS_DIR="$ROOT/secrets/local"
export POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=ssm
export MONGO_HOST=localhost   MONGO_PORT=27018   MONGO_USER=ssm
export RABBITMQ_HOST=localhost RABBITMQ_PORT=5672 RABBITMQ_USER=ssm
export REDIS_HOST=localhost REDIS_PORT=6380 REDIS_ENABLED=true
export R2_ENDPOINT=http://localhost:9000 R2_BUCKET=ssm-documents
export JWT_ISSUER=https://identity.ssm.local JWT_AUDIENCE=ssm
export NODE_ENV=development LOG_PRETTY=true LOG_LEVEL=info
export CORS_ORIGINS='http://localhost:4200,http://localhost:4201,http://localhost:4202,http://localhost:4203'

# The gateway proxies to the other four on localhost rather than by service name.
export IDENTITY_URL=http://localhost:3001
export FINANCIAL_URL=http://localhost:3002
export HR_URL=http://localhost:3003
export LEGAL_URL=http://localhost:3004
export OPERATIONS_URL=http://localhost:3005

# svc:port:database
SERVICES=(
  "identity-svc:3001:ssm_identity"
  "financial-svc:3002:ssm_financial"
  "hr-svc:3003:ssm_hr"
  "legal-svc:3004:ssm_legal"
  "ops-svc:3005:ssm_operations"
  "gateway:3000:-"
)

start() {
  echo "Subindo os serviços..."
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r svc port db <<< "$entry"
    local main="$ROOT/apps/$svc/dist/apps/$svc/src/main.js"

    if [[ ! -f "$main" ]]; then
      echo "  $svc: dist ausente. Rode 'make build' primeiro."
      continue
    fi

    ( cd "$ROOT/apps/$svc"
      PORT="$port" \
      POSTGRES_DB="${db/-/postgres}" \
      MONGO_DB="$db" \
      nohup node "$main" > "$RUN/$svc.log" 2>&1 &
      echo $! > "$RUN/$svc.pid" )

    printf '  %-16s :%s\n' "$svc" "$port"
  done

  echo
  echo "Aguardando readiness..."
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r svc port _ <<< "$entry"
    for _ in $(seq 1 40); do
      if curl -fsS -m 2 "http://localhost:$port/health/ready" >/dev/null 2>&1; then
        printf '  \033[32m✓\033[0m %-16s pronto\n' "$svc"; break
      fi
      sleep 1
    done || true
  done
}

stop() {
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r svc _ _ <<< "$entry"
    if [[ -f "$RUN/$svc.pid" ]]; then
      kill "$(cat "$RUN/$svc.pid")" 2>/dev/null || true
      rm -f "$RUN/$svc.pid"
      echo "  parado: $svc"
    fi
  done
}

status() {
  for entry in "${SERVICES[@]}"; do
    IFS=: read -r svc port _ <<< "$entry"
    body=$(curl -fsS -m 2 "http://localhost:$port/health/ready" 2>/dev/null || echo '')
    if [[ -n "$body" ]]; then printf '  \033[32m✓\033[0m %-16s %s\n' "$svc" "$body"
    else printf '  \033[31m✗\033[0m %-16s fora do ar\n' "$svc"; fi
  done
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  logs)   tail -f "$RUN/${2:?informe o serviço}.log" ;;
  *) echo "uso: $0 start|stop|restart|status|logs <svc>"; exit 1 ;;
esac
