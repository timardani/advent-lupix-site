#!/bin/sh
set -eu
/docker-entrypoint.d/40-vezerlo-auth.sh
python3 /app/vezerlo-api.py &
API_PID=$!
# Adventi naptár háttérrendszer (napi tartalom + névtelen statisztika), adat: /data/kalendar
python3 /app/kalendar-api.py &
KAL_PID=$!
trap 'kill "$API_PID" "$KAL_PID" 2>/dev/null || true' TERM INT EXIT
exec nginx -g 'daemon off;'
