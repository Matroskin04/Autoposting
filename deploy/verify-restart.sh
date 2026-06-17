#!/usr/bin/env bash
# Проверка перезапуска: systemd или Docker Compose.
# Использование:
#   bash deploy/verify-restart.sh systemd
#   bash deploy/verify-restart.sh docker
set -euo pipefail

MODE="${1:-}"
SERVICE_NAME="autoposting"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '[verify-restart] %s\n' "$*"; }
fail() { printf '[verify-restart] ОШИБКА: %s\n' "$*" >&2; exit 1; }

wait_for() {
  local check_fn="$1"
  local attempts="${2:-15}"
  local delay="${3:-2}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if "$check_fn"; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

systemd_check() {
  systemctl is-active --quiet "$SERVICE_NAME"
}

docker_check() {
  cd "$ROOT_DIR"
  local cid
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE_NAME" 2>/dev/null || true)"
  [[ -n "$cid" ]] || return 1
  docker inspect -f '{{.State.Running}}' "$cid" | grep -q true
}

case "$MODE" in
  systemd)
    command -v systemctl >/dev/null || fail "systemctl не найден"
    log "Проверяю, что $SERVICE_NAME активен..."
    systemd_check || fail "Сервис не запущен. Запусти: sudo systemctl start $SERVICE_NAME"
    log "Перезапускаю $SERVICE_NAME..."
    sudo systemctl restart "$SERVICE_NAME"
    log "Жду подъёма после restart..."
    wait_for systemd_check 15 2 || fail "Сервис не поднялся после restart"
    log "Статус после перезапуска:"
    systemctl --no-pager status "$SERVICE_NAME" | head -n 12
    log "Последние строки лога:"
    journalctl -u "$SERVICE_NAME" -n 8 --no-pager || true
    ;;
  docker)
    command -v docker >/dev/null || fail "docker не найден"
    cd "$ROOT_DIR"
    log "Проверяю контейнер $SERVICE_NAME..."
    docker_check || fail "Контейнер не запущен. Запусти: docker compose up -d"
    log "Перезапускаю контейнер..."
    docker compose -f "$COMPOSE_FILE" restart "$SERVICE_NAME"
    log "Жду подъёма после restart..."
    wait_for docker_check 20 3 || fail "Контейнер не поднялся после restart"
    log "Статус после перезапуска:"
    docker compose -f "$COMPOSE_FILE" ps
    cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE_NAME")"
    if [[ -n "$cid" ]]; then
      log "Health (если настроен):"
      docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true
    fi
    log "Последние строки лога:"
    docker compose -f "$COMPOSE_FILE" logs --tail=12 "$SERVICE_NAME"
    ;;
  *)
    echo "Использование: $0 systemd|docker"
    exit 1
    ;;
esac

log "Перезапуск прошёл успешно."
