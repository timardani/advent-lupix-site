#!/bin/sh
# /vezerlo belépés: a VEZERLO_JELSZO (Coolify) SHA-256 lenyomata kerül az nginx
# map-be; a /belepes/ oldal ugyanezt sütiként állítja be. Ha nincs jelszó,
# véletlen lenyomat kerül be, vagyis a vezérlő senkinek nem nyílik meg.
set -eu
PASS="${VEZERLO_JELSZO:-}"
if [ -z "$PASS" ]; then
  echo "vezerlo-auth: VEZERLO_JELSZO nincs beállítva, a /vezerlo zárva marad" >&2
  TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
else
  TOKEN="$(printf 'advent-vezerlo:%s' "$PASS" | openssl dgst -sha256 -r | cut -c1-64)"
fi
cat > /etc/nginx/conf.d/00-vezerlo-token.conf <<EOF
map_hash_bucket_size 128;
map \$cookie_vezerlo \$vezerlo_ok { "$TOKEN" 1; default 0; }
limit_req_zone \$binary_remote_addr zone=vezerlo:1m rate=60r/m;
EOF
echo "vezerlo-auth: belépés beállítva" >&2
