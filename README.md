# advent.lupix.hu – kiküldött adventi kalendárium-demók

Egy statikus nginx-oldal a Lupix CRM Coolify-szerverén. Minden kiküldött demó
saját, nehezen kitalálható címet kap: `https://advent.lupix.hu/<demó>-<6 jel>/?bemutato=1`.
A gyökér egy semleges oldal, nincs lista, nincs könyvtárindex; minden noindex,
a robots.txt mindent tilt. Így a konkurens boltok nem látják egymás demóját.

## Napi használat
```sh
cd /Users/danieltimar/Documents/Vibecode/advent-lupix-site
python3 kiad.py --uj fonalam        # demó kitétele (új titkos cím a kiadas.json-ba)
python3 kiad.py --le fonalam        # demó levétele (elutasítás / lejárat után)
python3 kiad.py                     # újrakiadás, pl. egy javítás után
node scripts/smoke.mjs https://advent.lupix.hu   # élő füstteszt
git add -A && git commit -m "kiadás: …" && git push
```
Utána Coolify → advent app → **Redeploy**.

- A szkript a demó buildjét másolja (`webshop-kalendarium-demok/<demó>/dist`, statikus
  demónál a futtatható fájlokat). Ha a build régebbi a forrásnál, előbb `npm run build`.
- A gyökérhivatkozásokat (`/assets`, `/products`, …) `/<slug>/…` alakra írja át; a
  relatív (`base: './'`) buildeket nem bántja. A demók forrása nem változik.
- Átdolgozott demó (új bolt) = új demómappa → `--uj <új-mappa>`; a régi címet `--le`-vel vedd le.

## Coolify-beállítás (egyszer)
| Mező | Érték |
|---|---|
| Repó | `git@github.com:timardani/advent-lupix-site.git`, ág: `main` (deploy key, csak olvasás) |
| Build pack | Dockerfile, base directory `/`, Dockerfile `/Dockerfile` |
| Port | `80` (exposed és domain-port is) |
| Domain | `https://advent.lupix.hu` |
| DNS (Cloudflare) | `A advent → 167.233.207.218`, DNS only |

## Jogi korlát
A demókban a boltok nyilvános termékfotói és neve szerepel engedély nélkül. Ezért
a címeket csak az adott bolt tulajdonosa kapja meg, és elutasítás után a demót le kell venni.
Éles kampány (fizető ügyfél) nem ide kerül: ahhoz valódi kupon, szerveroldali napi zár
és jóváhagyott képek kellenek.
