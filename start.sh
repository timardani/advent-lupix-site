#!/bin/sh
set -eu
/docker-entrypoint.d/40-vezerlo-auth.sh
python3 /app/vezerlo-api.py &
API_PID=$!
# Adventi naptár háttérrendszer (napi tartalom + névtelen statisztika), adat: /data/kalendar
python3 /app/kalendar-api.py &
KAL_PID=$!
# Agu Krisz élő bemutató-app (admin: /agukrisz-e9faeb/admin/), adat: /data/app-agukrisz
mkdir -p /data/app-agukrisz
env NODE_ENV=production PORT=8083 HOST=127.0.0.1 DATA_DIR=/data/app-agukrisz \
  CONFIG_DIR=/app/apps/agukrisz/config DIST_DIR=/app/apps/agukrisz/dist \
  BASE_PATH=/agukrisz-e9faeb BEMUTATO=1 BEMUTATO_NAP=7 \
  ADMIN_PASSWORD_SCRYPT=46b703205c76de3cf8d0cab063b4f5cb:10e960d4df55a4724d091d7a0f9823d7c1eb53a49e7195472d5c2b5976632d56 \
  node /app/apps/agukrisz/server/index.js &
AGU_PID=$!
trap 'kill "$API_PID" "$KAL_PID" "$AGU_PID" 2>/dev/null || true' TERM INT EXIT
exec nginx -g 'daemon off;'
