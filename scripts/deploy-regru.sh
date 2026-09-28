#!/usr/bin/env bash
# Деплой на хостинг рег.ру (Passenger + свой Node 22). Собирает закоммиченный HEAD, а не рабочую папку.
#   scripts/deploy-regru.sh          # HEAD
#   scripts/deploy-regru.sh <ref>    # любой коммит/ветка
# Нужен ssh-хост arena-regru в ~/.ssh/config (ключ ~/.ssh/arena_regru).
# На сервере: ~/node (Node 22), ~/arena-app (сервер + dist + .env), ~/arena-data (CACHE_DIR), ~/www/app.js (вход Passenger).
# .env живёт только на сервере (~/arena-app/.env, права 600), скрипт его не трогает.
set -euo pipefail

HOST=${DEPLOY_HOST:-arena-regru}
REF=${1:-HEAD}
DOMAIN=arena-peregovorov.ru
MIRROR=arena-peregovorov.online   # 301 на основной домен
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHA=$(git -C "$ROOT" rev-parse --short "$REF")

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "== сборка $SHA в $TMP"
git -C "$ROOT" archive "$REF" | tar -x -C "$TMP"
if cmp -s "$ROOT/package-lock.json" "$TMP/package-lock.json" && [ -d "$ROOT/node_modules" ]; then
  ln -s "$ROOT/node_modules" "$TMP/node_modules"
else
  (cd "$TMP" && npm ci --no-audit --no-fund)
fi
(cd "$TMP" && npm run build && npm run build:server)

OUT=$TMP/out
mkdir -p "$OUT"
cp -R "$TMP/dist" "$OUT/dist"
cp "$TMP/dist-server/server.mjs" "$TMP/deploy/regru/start.cjs" "$OUT/"
echo "$SHA" > "$OUT/VERSION"

echo "== выкладка на $HOST"
ssh "$HOST" 'mkdir -p ~/arena-app ~/arena-data ~/www/tmp && test -x ~/node/bin/node && test -f ~/arena-app/.env' ||
  { echo "на сервере нет ~/node или ~/arena-app/.env — см. README, раздел «Прод»"; exit 1; }
rsync -az --delete --exclude .env "$OUT/" "$HOST:arena-app/"
rsync -az "$TMP/deploy/regru/app.js" "$HOST:www/app.js"
# статика прямо в корне сайта: её отдают nginx/Apache, в Node идут только /api и прочее
rsync -az --delete --exclude .htaccess --exclude .well-known "$OUT/dist/" "$HOST:www/$DOMAIN/"
rsync -az "$TMP/deploy/regru/htaccess" "$HOST:www/$DOMAIN/.htaccess"
rsync -az "$TMP/deploy/regru/htaccess-mirror" "$HOST:www/$MIRROR/.htaccess"
ssh "$HOST" "find ~/www/$MIRROR -mindepth 1 -maxdepth 1 ! -name .htaccess ! -name .well-known -exec rm -rf {} +"
ssh "$HOST" 'chmod 600 ~/arena-app/.env && touch ~/www/tmp/restart.txt'

echo "== проверка (Passenger замечает restart.txt не сразу)"
sleep 12
for i in 1 2 3 4 5 6; do
  if curl -fsS -m 30 "https://$DOMAIN/api/health"; then echo; echo "готово: $SHA"; exit 0; fi
  sleep 5
done
echo "health не ответил — логи: ssh $HOST 'tail -50 ~/logs/$DOMAIN.error.log'"
exit 1
