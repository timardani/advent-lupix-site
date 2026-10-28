#!/bin/sh
# /vezerlo jelszava a VEZERLO_JELSZO környezeti változóból (Coolify). Ha hiányzik,
# véletlen jelszó kerül be, vagyis a vezérlő senkinek nem nyílik meg.
set -eu
USER_NAME="${VEZERLO_FELHASZNALO:-dani}"
PASS="${VEZERLO_JELSZO:-}"
if [ -z "$PASS" ]; then
  echo "vezerlo-auth: VEZERLO_JELSZO nincs beállítva, a /vezerlo zárva marad" >&2
  PASS="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
printf '%s:%s\n' "$USER_NAME" "$(openssl passwd -apr1 "$PASS")" > /etc/nginx/vezerlo.htpasswd
chmod 640 /etc/nginx/vezerlo.htpasswd
chown root:nginx /etc/nginx/vezerlo.htpasswd
