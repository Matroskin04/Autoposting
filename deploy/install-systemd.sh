#!/usr/bin/env bash
# Установка autoposting как systemd-сервиса на Oracle Cloud VM (Ubuntu / Oracle Linux).
# Запуск: sudo bash deploy/install-systemd.sh [/path/to/autoposting]
set -euo pipefail

APP_DIR="${1:-/opt/autoposting}"
SERVICE_NAME="autoposting"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Запусти скрипт от root: sudo bash $0"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установи Node.js 20+ (например, через NodeSource или nvm)."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Нужен Node.js 18+, сейчас: $(node -v)"
  exit 1
fi

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  echo "Не найден package.json в $REPO_ROOT"
  exit 1
fi

echo "==> Создаю пользователя $SERVICE_NAME (если нет)"
if ! id "$SERVICE_NAME" &>/dev/null; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_NAME"
fi

echo "==> Копирую приложение в $APP_DIR"
mkdir -p "$APP_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude node_modules \
    --exclude data \
    --exclude .env \
    --exclude .git \
    "$REPO_ROOT/" "$APP_DIR/"
else
  for item in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do
    [[ -e "$item" ]] || continue
    base="$(basename "$item")"
    case "$base" in
      node_modules | .git | data | .env) continue ;;
    esac
    cp -a "$item" "$APP_DIR/"
  done
fi

echo "==> npm install (production)"
cd "$APP_DIR"
sudo -u "$SERVICE_NAME" npm install --omit=dev

mkdir -p "$APP_DIR/data/media"
chown -R "$SERVICE_NAME:$SERVICE_NAME" "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo ""
  echo "ВНИМАНИЕ: $APP_DIR/.env не найден."
  echo "Скопируй и заполни: cp $APP_DIR/env.example $APP_DIR/.env"
  echo "Затем один раз авторизуйся (от пользователя $SERVICE_NAME):"
  echo "  sudo -u $SERVICE_NAME npm run login:qr"
  echo ""
fi

echo "==> Устанавливаю unit $SERVICE_NAME.service"
install -m 644 "$SCRIPT_DIR/autoposting.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

if [[ -f "$APP_DIR/.env" ]] && grep -q '^BOT_TOKEN=.\+' "$APP_DIR/.env" 2>/dev/null; then
  systemctl restart "$SERVICE_NAME"
  sleep 2
  systemctl --no-pager status "$SERVICE_NAME" || true
else
  echo "Сервис включён, но не запущен — сначала заполни .env и выполни login."
  echo "После настройки: sudo systemctl start $SERVICE_NAME"
fi

echo ""
echo "Готово. Команды:"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo "  sudo bash $SCRIPT_DIR/verify-restart.sh systemd"
