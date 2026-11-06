# advent.lupix.hu – kiküldött adventi kalendárium-demók

Egy statikus nginx-oldal a Lupix CRM Coolify-szerverén. Minden kiküldött demó
saját, nehezen kitalálható címet kap: `https://advent.lupix.hu/<demó>-<6 jel>/?bemutato=1`.
A gyökér egy semleges oldal, nincs lista, nincs könyvtárindex; minden noindex,
a robots.txt mindent tilt. Így a konkurens boltok nem látják egymás demóját.

## Napi használat
```sh
cd /Users/danieltimar/Documents/Vibecode/advent-lupix-site
python3 kiad.py --uj fonalam        # demó kitétele (új titkos cím a kiadas.json-ba)
python3 kiad.py --le fonalam        # csak külön kért, végleges levétel (nem a Lezárt státuszhoz)
python3 kiad.py                     # újrakiadás, pl. egy javítás után
node scripts/smoke.mjs https://advent.lupix.hu   # élő füstteszt
git add -A && git commit -m "kiadás: …" && git push
```
Utána Coolify → advent app → **Redeploy**.

- A szkript a demó buildjét másolja (`webshop-kalendarium-demok/<demó>/dist`, statikus
  demónál a futtatható fájlokat). Ha a build régebbi a forrásnál, előbb `npm run build`.
- A gyökérhivatkozásokat (`/assets`, `/products`, …) `/<slug>/…` alakra írja át; a
  relatív (`base: './'`) buildeket nem bántja. A demók forrása nem változik.
- Átdolgozott demó (új bolt) = új demómappa → `--uj <új-mappa>`; a régi, Lezárt bemutató a tulajdonos számára olvasható archívum marad.

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
a címeket csak az adott bolt tulajdonosa kapja meg, és elutasítás után a nyilvános hozzáférést a Lezárt státusz automatikusan megszünteti.
Éles kampány (fizető ügyfél) nem ide kerül: ahhoz valódi kupon, szerveroldali napi zár
és jóváhagyott képek kellenek.

## Vezérlő: `/vezerlo` (jelszavas)
A `vezerlo/adat.json` az ügyfél-, kategória- és kontaktadatok központi forrása. Deploykor a belső API ebből hozzáadja az új kategóriákat és boltokat, illetve frissíti a statikus kontaktadatokat, de a `/data/adat.json` fájlban már vezetett státuszokat, kiküldési és határidő-dátumokat, teendőket és előzményeket megőrzi.

A vezérlő **Lezárt** állapotú bemutatója (`lezart`, illetve a régi `nem`, `lejart`, `kizart` státuszok) a nyilvános linken azonnal 404-et ad, a demó assetjeivel együtt. A vezérlőbe bejelentkezve ugyanaz a link továbbra is megnyitható átnézésre. Visszaállított státusznál újra megnyílik; a fájlok nem törlődnek. A `kiad.py --le` továbbra is külön, kézi levétel. A korábban már betöltött vagy lementett másolatokat ez nem vonja vissza.

A Lista kompakt ügyfélkártyákat, keresést, kategória- és státuszszűrést, valamint négy gyors összesítőt mutat. A részletek kinyitása után szerkeszthető a kiküldés dátuma, a határidő, a státusz és a következő teendő. A kiküldési dátum módosításakor a háromnapos, hétvégét kerülő határidő automatikusan újraszámolódik. A Kanban kizárólag áttekintő nézet: az öt oszlopban csak az ügyfélnevek jelennek meg, ott nincs szerkesztés vagy áthúzás.

A részletek között az **E-mail másolása** gomb az adott bolt nevével, élő demólinkjével és határidejével kitöltött teljes megkeresést teszi a vágólapra. A három kiemelt sor félkövér marad a formázott beillesztést támogató levelezőkben; a vágólap sima szöveges változatot is kap. Ha a boltnál még nincs határidő, a vezérlő a másolás napjától számított három napot használja, hétvége esetén a következő hétfőt.

Minden sikeres mentésről böngészőbeli biztonsági másolat is készül; ha a szerver egy redeploy után régebbi adatokkal indul, a felület felajánlja ennek visszaállítását. A változásokat a konténer belső API-ja a `/data/adat.json` fájlba menti. Az első induláskor a `vezerlo/adat.json` az alapadat.

**Kötelező Coolify-beállítás az adatok tartós megőrzéséhez:** Persistent Storage, célútvonal: `/data`. A Dockerfile `VOLUME /data` deklarációja helyben jelzi az írható adatkönyvtárat, de a redeploy utáni megőrzést a Coolify névvel kezelt tárhelye biztosítja.

A vezérlő mutatja a demó forrásának utolsó módosítását is. Ezt a `scripts/demo-audit.py` készíti a `vezerlo/demo-audit.json` fájlba; a `kiad.py` minden kiadás előtt automatikusan frissíti.

Parancssorból továbbra is használható:
```sh
python3 vezerlo.py                          # összesítő
python3 vezerlo.py fonalam kikuldve         # ma kiküldve, határidő = +3 munkanap-igazítva
python3 vezerlo.py fonalam valaszolt "érdekli, hívjam"
python3 vezerlo.py fonalam nem              # a nyilvános link automatikusan 404, belépve elérhető
```
Jelszó: Coolify → Environment Variables → `VEZERLO_JELSZO`. Ha nincs beállítva, a vezérlő zárva marad.
