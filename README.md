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

## Vezérlő: `/vezerlo` (jelszavas)
A felületen közvetlenül jelölhető a kiküldés, módosítható a határidő és a státusz. A Lista mellett Kanban nézet is választható a Kész demo, Elküldve, Második keresés, Érdekli és OFF oszlopokkal. A Kanban-kártyák áthúzhatók, kategóriára szűrhetők, és közvetlenül szerkeszthető rajtuk a következő teendő, a határidő és a részletes státusz. A rendszer kiemeli a sürgős/lejárt kártyákat, mutatja az oszlopban töltött napokat, és a mostantól végzett státuszváltások előzményeit is naplózza. Minden sikeres mentésről böngészőbeli biztonsági másolat is készül; ha a szerver egy redeploy után régebbi adatokkal indul, a felület felajánlja ennek visszaállítását. A változásokat a konténer belső API-ja a `/data/adat.json` fájlba menti. Az első induláskor a `vezerlo/adat.json` az alapadat.

**Kötelező Coolify-beállítás az adatok tartós megőrzéséhez:** Persistent Storage, célútvonal: `/data`. A Dockerfile `VOLUME /data` deklarációja helyben jelzi az írható adatkönyvtárat, de a redeploy utáni megőrzést a Coolify névvel kezelt tárhelye biztosítja.

A vezérlő mutatja a demó forrásának utolsó módosítását és a második körös auditot is. Ezt a `scripts/demo-audit.py` készíti a `vezerlo/demo-audit.json` fájlba; a `kiad.py` minden kiadás előtt automatikusan frissíti.

Parancssorból továbbra is használható:
```sh
python3 vezerlo.py                          # összesítő
python3 vezerlo.py fonalam kikuldve         # ma kiküldve, határidő = +3 munkanap-igazítva
python3 vezerlo.py fonalam valaszolt "érdekli, hívjam"
python3 vezerlo.py fonalam nem              # utána: kiad.py --le fonalam
```
Jelszó: Coolify → Environment Variables → `VEZERLO_JELSZO`. Ha nincs beállítva, a vezérlő zárva marad.
