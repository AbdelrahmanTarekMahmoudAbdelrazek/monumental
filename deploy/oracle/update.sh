#!/usr/bin/env bash
# Pull new commits and rebuild the server if anything changed (run by cron every 5 min).
set -euo pipefail
cd "$HOME/monumental"
git fetch --quiet origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse '@{u}')" ]; then
  echo "$(date) updating to $(git rev-parse --short '@{u}')"
  git reset --hard --quiet '@{u}'
  cd deploy/oracle && sudo docker compose up -d --build server
  sudo docker image prune -f >/dev/null
fi
