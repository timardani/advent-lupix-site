#!/usr/bin/env python3
"""ajanlat_ellenor.py – a 24 napos akció/kupon szabályok gépi ellenőrzése (stdlib only).

Usage: python3 ajanlat_ellenor.py <demo_dir> [<demo_dir> ...] [--egeszseg] [--quiet]

Beolvassa: <demo>/data/offers.json (bármelyik eddigi alak: lista, {"offers":[]},
{"days":[]|{}}), <demo>/data/products.json, <demo>/data/companions.json.
Szabályok (adventi-kalendarium-webshopnak skill, references/04-ajanlatok-kupon.md):
  HIBA  24 nap (1..24), mindegyiknél type/title/code/conditions, approved=false
  HIBA  egyedi kódok; 5 típus mind >=3-szor (masodik helyettesítheti a szallitas-t)
  HIBA  ugyanaz a típus legfeljebb 2 egymást követő napon
  HIBA  társ/ajándék termék nem drágább a nap terméktől
  HIBA  hamis FOMO-szöveg (csak 3 db maradt, X ember nézi…)
  HIBA  --egeszseg: gyógyhatásra utaló szavak az akciószövegekben
  FIGY  12 karakternél hosszabb kód (mobilon törhet); ismeretlen típus
Kimenet: demónként 1 sor + legfeljebb 8 hibasor. Exit: 0 minden rendben,
1 van HIBA, 2 nem olvasható adat.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ALIAS = {
    "kedvezmeny": "szazalek", "percent": "szazalek", "szazalek": "szazalek",
    "1plus1": "1plusz1", "one_plus_one": "1plusz1", "1plusz1": "1plusz1",
    "ajandek": "ajandek", "gift": "ajandek",
    "szallitas": "szallitas", "shipping": "szallitas",
    "csomag": "csomag", "bundle": "csomag",
    "masodik": "masodik",
}
FOT = ["szazalek", "1plusz1", "ajandek", "szallitas", "csomag"]
FAKE_FOMO = re.compile(
    r"(csak|már csak|utolsó)\s+\d+\s*(db|darab)|\d+\s*(ember|vásárló)\s+(nézi|vette|nézte)"
    r"|készlet(ünk)?\s+fogy", re.I)
HEALTH = re.compile(r"gyógyít|gyógyhat|fájdalom|szorong|álmatlan|gyulladás|betegség", re.I)


def load(p):
    return json.loads(p.read_text("utf-8"))


def offers_of(d):
    if isinstance(d, list):
        return d
    for k in ("offers", "days"):
        if k in d:
            v = d[k]
            if isinstance(v, dict):
                return [dict(o, day=o.get("day", int(n))) for n, o in v.items()]
            return v
    raise ValueError("ismeretlen offers.json alak")


def price_map(demo):
    prod, comp = {}, {}
    pp = demo / "data" / "products.json"
    if pp.exists():
        d = load(pp)
        for p in (d.get("products", d) if isinstance(d, dict) else d):
            if isinstance(p, dict) and "day" in p:
                prod[int(p["day"])] = p.get("priceHuf") or p.get("price")
    cp = demo / "data" / "companions.json"
    if cp.exists():
        d = load(cp)
        items = d.values() if isinstance(d, dict) else d
        for c in items:
            if isinstance(c, dict):
                key = c.get("sku") or c.get("id") or c.get("slug")
                comp[str(key)] = c.get("priceHuf") or c.get("price")
    return prod, comp


def companion_prices(o, prod, comp):
    out = []
    for c in o.get("companions") or []:
        if isinstance(c, dict):
            if "day" in c:
                out.append(prod.get(int(c["day"])))
            elif "sku" in c:
                out.append(comp.get(str(c["sku"])))
            elif "priceHuf" in c:
                out.append(c["priceHuf"])
        else:
            out.append(comp.get(str(c)))
    for k in ("companionId", "giftSlug"):
        if o.get(k):
            out.append(comp.get(str(o[k])))
    return [x for x in out if isinstance(x, (int, float))]


def load_clients(cdir):
    """Szobanövény-család (tropicalhome → novenybirodalom → …): clients/<bolt>/ajanlatjavaslatok.json
    {"napok":[{nap,tipus,cim,kod,feltetel,with}]}, termekek.json [{nap,ar}], kiegeszitok.json {handle:{ar}}."""
    raw = [dict(o, day=o.get("nap"), type=o.get("tipus"), title=o.get("cim"), detail=o.get("szoveg"),
                code=o.get("kod"), conditions=o.get("feltetel"), companions=o.get("with") or [])
           for o in load(cdir / "ajanlatjavaslatok.json")["napok"]]
    prod = {int(p["nap"]): p.get("ar") for p in load(cdir / "termekek.json")}
    kp = cdir / "kiegeszitok.json"
    comp = {str(h): c.get("ar") for h, c in (load(kp).items() if kp.exists() else [])}
    return raw, prod, comp


def check(demo, egeszseg):
    errs, warns = [], []
    f = demo / "data" / "offers.json"
    cl = [] if f.exists() else sorted((demo / "clients").glob("*/ajanlatjavaslatok.json"))
    if not f.exists() and not cl:
        return None, [f"nincs {f.relative_to(demo.parent)} (és clients/*/ajanlatjavaslatok.json sem)"], []
    if cl:
        raw, cprod, ccomp = load_clients(cl[0].parent)
    else:
        raw = load(f)
    marker = demo / "data" / "_REGI_BOLT"
    if marker.exists():
        errs.append(f"offers/companions még a régi bolté ({marker.read_text('utf-8').strip()}): "
                    "írd át, majd tedd Kukába a data/_REGI_BOLT fájlt")
    offers = sorted(offers_of(raw), key=lambda o: int(o.get("day", 0)))
    prod, comp = (cprod, ccomp) if cl else price_map(demo)
    days = [int(o.get("day", 0)) for o in offers]
    if days != list(range(1, 25)):
        errs.append(f"napok nem 1..24 ({len(days)} db)")
    types = []
    for o in offers:
        n = o.get("day")
        miss = [k for k in ("type", "title", "code", "conditions") if not o.get(k)]
        if miss:
            errs.append(f"{n}. nap hiányzik: {','.join(miss)}")
        if o.get("approved", False) is not False:
            errs.append(f"{n}. nap approved nem false")
        t = ALIAS.get(str(o.get("type", "")).lower())
        if not t:
            warns.append(f"{n}. nap ismeretlen típus: {o.get('type')}")
        types.append(t or str(o.get("type")))
        code = str(o.get("code", ""))
        if len(code) > 12:
            warns.append(f"{n}. nap hosszú kód: {code}")
        txt = " ".join(str(o.get(k, "")) for k in ("title", "detail", "conditions"))
        if FAKE_FOMO.search(txt):
            errs.append(f"{n}. nap hamis FOMO: {FAKE_FOMO.search(txt).group(0)}")
        if egeszseg and HEALTH.search(txt):
            errs.append(f"{n}. nap egészségállítás: {HEALTH.search(txt).group(0)}")
        main = prod.get(int(n or 0))
        cps = companion_prices(o, prod, comp)
        if main and cps and max(cps) > main:
            errs.append(f"{n}. nap társ drágább ({max(cps)} > {main} Ft)")
    dup = [c for c, k in Counter(str(o.get("code", "")).upper() for o in offers).items() if k > 1 and c]
    if dup:
        errs.append(f"ismétlődő kód: {','.join(dup)}")
    cnt = Counter(types)
    if "masodik" in cnt:
        cnt["szallitas"] += cnt.pop("masodik")
    low = [f"{t}={cnt.get(t, 0)}" for t in FOT if cnt.get(t, 0) < 3]
    if low:
        errs.append("típus <3-szor: " + " ".join(low))
    run = 1
    for i in range(1, len(types)):
        run = run + 1 if types[i] == types[i - 1] else 1
        if run == 3:
            errs.append(f"{days[i]}. nap: 3 egymást követő '{types[i]}'")
    summary = " ".join(f"{t}:{cnt.get(t, 0)}" for t in FOT)
    return summary, errs, warns


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    egeszseg = "--egeszseg" in sys.argv
    quiet = "--quiet" in sys.argv
    if not args:
        print(__doc__.strip().splitlines()[2])
        return 2
    worst = 0
    for a in args:
        demo = Path(a).resolve()
        try:
            summary, errs, warns = check(demo, egeszseg)
        except Exception as e:  # noqa: BLE001
            print(f"HIBA   {demo.name}: nem olvasható ({e})")
            worst = max(worst, 2)
            continue
        if summary is None:
            print(f"HIBA   {demo.name}: {errs[0]}")
            worst = max(worst, 2)
            continue
        status = "HIBA  " if errs else "RENDBEN"
        print(f"{status} {demo.name}: {summary} | hiba {len(errs)}, figy {len(warns)}")
        if not quiet:
            for line in (errs + [f"(figy) {w}" for w in warns])[:8]:
                print(f"   - {line}")
        if errs:
            worst = max(worst, 1)
    return worst


if __name__ == "__main__":
    sys.exit(main())
