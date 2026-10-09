#!/usr/bin/env bash
#
# One command to bring the whole stack up for device testing.
#
#   ./scripts/dev.sh              server + Metro
#   ./scripts/dev.sh --no-metro   backend only
#   ./scripts/dev.sh --ip 1.2.3.4 override detection
#
# The phone reaches the API over the LAN, so the address has to be the
# machine's real network IP — not localhost, and not one of Docker's bridge
# interfaces. That address changes whenever the network does, which is why
# this rewrites mobile/.env on every run instead of leaving it to memory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$(cd "$ROOT/../server" && pwd)"
ENV_FILE="$ROOT/.env"
LOG_FILE="$ROOT/.server.log"
PORT="${PORT:-8080}"

FORCE_IP=""
START_METRO=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-metro) START_METRO=0 ;;
    --ip) shift; FORCE_IP="${1:-}" ;;
    --ip=*) FORCE_IP="${1#--ip=}" ;;
  esac
  shift
done

c()    { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# ── 1. The LAN address ──────────────────────────────────────────────────────
#
# Ask the routing table which source address reaches the internet. That is
# the interface the phone shares a network with. The previous approach —
# `hostname -I | awk '{print $1}'` — returns whichever inet comes first,
# which on a machine running Docker is happily a 172.x bridge address no
# phone can ever reach.
detect_ip() {
  local ip=""

  if command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 8.8.8.8 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1)
  fi

  # macOS
  if [[ -z "$ip" ]] && command -v ipconfig >/dev/null 2>&1; then
    local i
    for i in en0 en1 en2; do
      ip=$(ipconfig getifaddr "$i" 2>/dev/null || true)
      [[ -n "$ip" ]] && break
    done
  fi

  # Last resort: any inet that is not loopback or a container/vpn interface.
  if [[ -z "$ip" ]] && command -v ip >/dev/null 2>&1; then
    ip=$(ip -o -4 addr show 2>/dev/null \
      | grep -vE ' (lo|docker[0-9]*|br-[0-9a-f]+|veth[0-9a-z]*|virbr[0-9]*|tailscale[0-9]*) ' \
      | awk '{print $4}' | cut -d/ -f1 | head -1)
  fi

  echo "${ip:-127.0.0.1}"
}

IP="${FORCE_IP:-$(detect_ip)}"
API="http://$IP:$PORT"

c "━━━ ZwoSocial dev ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf '  API    %s\n' "$API"
printf '  Logs   %s\n' "$LOG_FILE"
c "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$IP" == "127.0.0.1" ]]; then
  warn "No LAN address found — a physical device will not reach the API."
fi

# ── 2. Point the app at it ──────────────────────────────────────────────────
# EXPO_PUBLIC_* is inlined at bundle time, so a stale value survives until
# Metro restarts with a cleared cache. That is why step 7 passes -c.
PREV=""
if [[ -f "$ENV_FILE" ]]; then
  PREV=$(grep -m1 '^EXPO_PUBLIC_API_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
fi
printf 'EXPO_PUBLIC_API_URL=%s\n' "$API" > "$ENV_FILE"
if [[ -n "$PREV" && "$PREV" != "$API" ]]; then
  ok "API URL updated ($PREV → $API)"
else
  ok "API URL set"
fi

# ── 3. Dependencies ─────────────────────────────────────────────────────────
port_open() {
  if command -v nc >/dev/null 2>&1; then
    nc -z -w2 127.0.0.1 "$1" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && exec 3<&-
  fi
}

if port_open 5432; then ok "Postgres :5432"; else
  no "Postgres :5432 unreachable — run 'make docker-up-local' in server/"
  exit 1
fi
if port_open 6379; then ok "Redis :6379"; else
  no "Redis :6379 unreachable — run 'make docker-up' in server/"
  exit 1
fi

# ── 4. Free the API port ────────────────────────────────────────────────────
# A run that outlived its terminal keeps the port; the new server then fails
# to bind while the old binary quietly keeps serving — which looks exactly
# like "my code change did nothing".
if port_open "$PORT"; then
  warn "Port $PORT busy — stopping the previous server"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "$PORT/tcp" >/dev/null 2>&1 || true
  else
    pkill -f 'cmd/api' >/dev/null 2>&1 || true
  fi
  sleep 2
  if port_open "$PORT"; then
    no "Port $PORT still busy — stop it by hand"
    exit 1
  fi
  ok "Port freed"
fi

# ── 5. Migrations ───────────────────────────────────────────────────────────
if command -v migrate >/dev/null 2>&1; then
  if (cd "$SERVER_DIR" && make migrate-up >/dev/null 2>&1); then
    ok "Migrations up to date"
  else
    warn "Migrations failed — check 'make migrate-up' in server/"
  fi
else
  warn "golang-migrate not installed; skipping migrations"
fi

# ── 6. Server ───────────────────────────────────────────────────────────────
SERVER_PID=""
cleanup() {
  printf '\n'
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

(cd "$SERVER_DIR" && exec go run ./cmd/api) > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

ready() { curl -fsS -m 1 "http://127.0.0.1:$PORT/api/readyz" >/dev/null 2>&1; }

printf '  … building and starting the API'
for _ in $(seq 1 60); do
  if ready; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    printf '\r'; no "API exited — last lines:"
    tail -n 15 "$LOG_FILE" | sed 's/^/      /'
    exit 1
  fi
  printf '.'
  sleep 0.5
done
printf '\r\033[K'

if ! ready; then
  no "API did not become ready — last lines:"
  tail -n 15 "$LOG_FILE" | sed 's/^/      /'
  exit 1
fi
ok "API ready (pid $SERVER_PID)"

# ── 7. Metro ────────────────────────────────────────────────────────────────
if [[ "$START_METRO" -eq 0 ]]; then
  c "Backend only. Ctrl-C to stop."
  wait "$SERVER_PID"
  exit 0
fi

c "Starting Metro (cache cleared so the new API URL is picked up)…"
cd "$ROOT"
# --dev-client because the app now uses native modules Expo Go does not ship.
exec bunx expo start -c --dev-client
