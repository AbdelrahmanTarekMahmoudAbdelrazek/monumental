#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu VM (Oracle Cloud Always Free).
# Usage:  bash setup.sh            (asks for the values)
#   or:   DOMAIN=… SOCKET_JWT_SECRET=… DATABASE_URL=… bash setup.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/AbdelrahmanTarekMahmoudAbdelrazek/monumental.git}"
APP_DIR="$HOME/monumental"
CORS_DEFAULT="https://monumental-ebon.vercel.app"

ask() { local var=$1 prompt=$2 def=${3:-}; if [ -z "${!var:-}" ]; then read -r -p "$prompt${def:+ [$def]}: " val; printf -v "$var" '%s' "${val:-$def}"; fi; }
ask DOMAIN "Your DuckDNS domain (e.g. howbig.duckdns.org)"
ask SOCKET_JWT_SECRET "SOCKET_JWT_SECRET (same value as on Vercel)"
ask DATABASE_URL "DATABASE_URL (your Neon URL, or leave empty)" ""
ask CORS_ORIGINS "Website address" "$CORS_DEFAULT"

echo "==> Swap (helps small VMs build)"
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3000 ] && ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Packages + Docker"
sudo apt-get update -y >/dev/null
sudo apt-get install -y git curl iptables-persistent >/dev/null || sudo apt-get install -y git curl >/dev/null
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh >/dev/null; fi
sudo usermod -aG docker "$USER" || true

echo "==> Opening ports 80 and 443 in the VM firewall"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save >/dev/null 2>&1 || true

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone --depth 1 "$REPO_URL" "$APP_DIR"; fi

echo "==> Settings"
ENV_FILE="$APP_DIR/deploy/oracle/.env"
umask 077
cat > "$ENV_FILE" <<ENV
DOMAIN=$DOMAIN
CORS_ORIGINS=$CORS_ORIGINS
SOCKET_JWT_SECRET=$SOCKET_JWT_SECRET
DATABASE_URL=$DATABASE_URL
TOURNAMENTS_ENABLED=true
ENV

echo "==> Building and starting (first build takes a few minutes)"
cd "$APP_DIR/deploy/oracle"
sudo docker compose up -d --build

echo "==> Auto-update every 5 minutes after you git push"
chmod +x "$APP_DIR/deploy/oracle/update.sh"
( crontab -l 2>/dev/null | grep -v monumental/deploy/oracle/update.sh; echo "*/5 * * * * $APP_DIR/deploy/oracle/update.sh >> $HOME/update.log 2>&1" ) | crontab -

echo
echo "Done. Checking https://$DOMAIN/health (the certificate can take ~30 s the first time)…"
for i in $(seq 1 20); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then echo "✅ Live: https://$DOMAIN/health"; exit 0; fi
  sleep 6
done
echo "⚠️  Not reachable yet. Check that ports 80/443 are open in the Oracle security list and that DuckDNS points to this VM's IP."
