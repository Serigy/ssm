#!/usr/bin/env bash
# Runs the shell and the three remotes as Vite dev servers.
#
# Stops by PORT, not by recorded PID. `npm exec vite` forks a child that is the
# process actually holding the socket, so killing the recorded parent leaves the
# port bound — the next start then fails with "Port already in use" and you keep
# testing the old build without noticing.
#
#   ./scripts/dev-web.sh start | stop | restart | status
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.data/run"
mkdir -p "$RUN"

APPS=( "shell:4200" "mfe-financial:4201" "mfe-hr:4202" "mfe-legal:4203" "mfe-operations:4204" )

pid_on_port() {
  ss -lptn "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

stop() {
  for entry in "${APPS[@]}"; do
    IFS=: read -r app port <<< "$entry"
    local pid; pid="$(pid_on_port "$port")"
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null
      for _ in $(seq 1 20); do [[ -z "$(pid_on_port "$port")" ]] && break; sleep 0.25; done
      [[ -n "$(pid_on_port "$port")" ]] && kill -9 "$pid" 2>/dev/null
      echo "  parado: $app (:$port)"
    fi
    rm -f "$RUN/$app.pid"
  done
}

start() {
  for entry in "${APPS[@]}"; do
    IFS=: read -r app port <<< "$entry"
    if [[ -n "$(pid_on_port "$port")" ]]; then
      echo "  $app: porta $port ocupada — rode '$0 stop' primeiro."
      continue
    fi
    ( cd "$ROOT/apps/$app" && nohup npx vite > "$RUN/$app.log" 2>&1 & )
  done

  echo "Aguardando os dev servers..."
  for entry in "${APPS[@]}"; do
    IFS=: read -r app port <<< "$entry"
    for _ in $(seq 1 60); do
      curl -fsS -m 2 "http://localhost:$port/" >/dev/null 2>&1 && break
      sleep 1
    done
    if curl -fsS -m 2 "http://localhost:$port/" >/dev/null 2>&1; then
      printf '  \033[32m✓\033[0m %-16s http://localhost:%s\n' "$app" "$port"
    else
      printf '  \033[31m✗\033[0m %-16s não subiu — veja %s\n' "$app" "$RUN/$app.log"
    fi
  done
}

status() {
  for entry in "${APPS[@]}"; do
    IFS=: read -r app port <<< "$entry"
    local pid; pid="$(pid_on_port "$port")"
    if [[ -n "$pid" ]]; then
      printf '  \033[32m✓\033[0m %-16s :%s  pid %s  desde %s\n' "$app" "$port" "$pid" \
        "$(ps -o lstart= -p "$pid" 2>/dev/null | xargs)"
    else
      printf '  \033[31m✗\033[0m %-16s :%s  fora do ar\n' "$app" "$port"
    fi
  done
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *) echo "uso: $0 start|stop|restart|status"; exit 1 ;;
esac
