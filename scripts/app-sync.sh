#!/bin/sh
# Élő (szerveres) bemutató-app bemásolása az advent.lupix.hu image-be.
# Használat: scripts/app-sync.sh <app-repo mappa> <név>   pl. scripts/app-sync.sh ../webkalendarium-agukrisz agukrisz
# Az app repójában előtte: npm test && npm run build. A /data alatti élő adatot nem érinti.
set -eu
SRC=$1; NEV=$2; DST="$(dirname "$0")/../apps/$NEV"
test -f "$SRC/server/index.js" && test -f "$SRC/dist/index.html" && test -f "$SRC/config/tartalom.json"
rm -rf "$DST.uj" && mkdir -p "$DST.uj"
cp -R "$SRC/server" "$SRC/config" "$SRC/dist" "$DST.uj/"
rm -rf "$DST" && mv "$DST.uj" "$DST"
echo "kész: apps/$NEV"
