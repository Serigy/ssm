#!/usr/bin/env bash
# Sobe os Workers do SSM no Miniflare, com estado compartilhado.
#
#   scripts/cf-dev.sh                    # sobe todos os que já têm código
#   scripts/cf-dev.sh start identity     # sobe só um
#   scripts/cf-dev.sh stop
#   scripts/cf-dev.sh status
#
# Duas decisões que custaram tempo para chegar aqui:
#
#   1. **Estado compartilhado.** Em produção o KV é um namespace só, e é nele
#      que mora a lista de revogação de sessão. Com um diretório de estado por
#      Worker, sair do sistema não encerraria a sessão nos outros módulos aqui —
#      passaria no teste local e falharia na nuvem. Por isso o `--persist-to`
#      comum, e por isso cada banco D1 de desenvolvimento tem id próprio: sem
#      isso eles colidiriam num arquivo só.
#
#   2. **Parar pelo grupo de processos.** `wrangler dev` é uma árvore: npm exec
#      -> node -> workerd. Matar quem segura a porta derruba só o workerd, e o
#      pai o levanta de novo — foi assim que se acumularam vinte e oito
#      processos órfãos numa tarde. `setsid` põe cada Worker no seu próprio
#      grupo, e o grupo inteiro morre de uma vez.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKERS_DIR="$PWD/workers"
RUN_DIR="$WORKERS_DIR/.wrangler-run"
mkdir -p "$RUN_DIR"

declare -A PORTS=(
  [gateway]=8800 [identity]=8801 [financial]=8802
  [hr]=8803 [legal]=8804 [operations]=8805
)
ALL=(identity financial hr legal operations gateway)

stop_one() {
  local m=$1 pidfile="$RUN_DIR/$m.pgid"
  [ -f "$pidfile" ] || return 0
  local pgid; pgid=$(cat "$pidfile")
  # O sinal negativo endereça o grupo inteiro, não só o líder.
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-$pgid" 2>/dev/null || true
  rm -f "$pidfile"
}

start_one() {
  local m=$1 port=${PORTS[$1]}
  # O inspetor também precisa de porta própria: o padrão é 9229 em todos, e o
  # segundo Worker a subir morre com "Address already in use" numa porta que
  # nem aparece na configuração.
  local inspector=$((port + 1000))
  if [ ! -f "$WORKERS_DIR/$m/src/index.ts" ]; then
    printf '  %-11s ainda sem src/index.ts — pulado\n' "$m"
    return 0
  fi
  stop_one "$m"
  ( cd "$WORKERS_DIR/$m"
    setsid npx wrangler dev --port "$port" --inspector-port "$inspector" \
      --local --persist-to ../.wrangler-state \
      > "/tmp/ssm-worker-$m.log" 2>&1 < /dev/null &
    echo $! > "$RUN_DIR/$m.pgid"
  )
}

wait_one() {
  local m=$1 port=${PORTS[$1]}
  [ -f "$WORKERS_DIR/$m/src/index.ts" ] || return 0
  for _ in $(seq 1 60); do
    if curl -sf -m 2 "http://localhost:$port/health/ready" >/dev/null 2>&1; then
      printf '  %-11s http://localhost:%s\n' "$m" "$port"
      return 0
    fi
    sleep 1
  done
  printf '  %-11s NÃO SUBIU — ver /tmp/ssm-worker-%s.log\n' "$m" "$m"
  return 1
}

cmd=${1:-start}
shift || true
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=("${ALL[@]}")

case "$cmd" in
  stop)
    # Honra os alvos: `cf-dev.sh stop legal` para só o jurídico. Sem isto o
    # argumento era silenciosamente ignorado e o comando derrubava tudo.
    for m in "${targets[@]}"; do stop_one "$m"; done
    echo "Parados: ${targets[*]}"
    ;;
  status)
    for m in "${ALL[@]}"; do
      if curl -sf -m 2 "http://localhost:${PORTS[$m]}/health/ready" >/dev/null 2>&1; then
        printf '  %-11s no ar   :%s\n' "$m" "${PORTS[$m]}"
      else
        printf '  %-11s parado\n' "$m"
      fi
    done
    ;;
  start|restart)
    for m in "${targets[@]}"; do start_one "$m"; done
    rc=0
    for m in "${targets[@]}"; do wait_one "$m" || rc=1; done
    exit $rc
    ;;
  *)
    echo "Uso: $0 {start|stop|restart|status} [módulo...]" >&2
    exit 64
    ;;
esac
