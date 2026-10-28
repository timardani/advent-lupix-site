#!/bin/sh
set -eu
/docker-entrypoint.d/40-vezerlo-auth.sh
python3 /app/vezerlo-api.py &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' TERM INT EXIT
exec nginx -g 'daemon off;'
