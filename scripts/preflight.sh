#!/usr/bin/env bash
# Verify the host has everything SSM needs. Exits non-zero on a hard failure.
set -uo pipefail

FAIL=0
ok()   { printf '  \033[32m✓\033[0m %-14s %s\n' "$1" "$2"; }
warn() { printf '  \033[33m!\033[0m %-14s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✗\033[0m %-14s %s\n' "$1" "$2"; FAIL=1; }

need() { # need <cmd> <version-flag> <install hint> [optional]
  local cmd="$1" flag="$2" hint="$3" opt="${4:-}"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd" "$($cmd $flag 2>&1 | head -1)"
  elif [[ -n "$opt" ]]; then
    warn "$cmd" "not installed (optional) — $hint"
  else
    bad "$cmd" "not installed — $hint"
  fi
}

echo "SSM preflight"
echo
need node      --version        "https://nodejs.org (>= 22)"
need pnpm      --version        "corepack enable pnpm"
need docker    --version        "https://docs.docker.com/engine/install/"
need kubectl   "version --client=true -o yaml" "https://kubernetes.io/docs/tasks/tools/"
need kind      --version        "make install-tools"
need helm      version          "make install-tools"
need openssl   version          "apt install openssl"
need terraform --version        "make install-tools" optional
need ansible   --version        "pipx install ansible" optional
need jq        --version        "apt install jq" optional

echo
if docker info >/dev/null 2>&1; then
  ok docker-daemon "reachable"
else
  bad docker-daemon "not reachable — start Docker Desktop / systemctl start docker"
fi

if [[ -s secrets/local/postgres_password ]]; then
  ok secrets "secrets/local/ populated"
else
  warn secrets "run 'make secrets'"
fi

echo
if [[ $FAIL -eq 1 ]]; then
  echo "Preflight FAILED — install the missing required tools above."
  exit 1
fi
echo "Preflight passed."
