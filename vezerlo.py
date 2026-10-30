#!/usr/bin/env python3
"""advent.lupix.hu/vezerlo – állapotfrissítés (adat: vezerlo/adat.json).

Használat:
  python3 vezerlo.py                              # összesítő a terminálba
  python3 vezerlo.py <id> <állapot> ["megjegyzés"] # pl. fonalam kikuldve
  python3 vezerlo.py <id> megj "szöveg"           # csak megjegyzés
  python3 vezerlo.py <id> teendo "szöveg"         # következő lépés

Állapotok: elokeszites, review, kuldheto, tartalek, kikuldve, valaszolt,
foglalt, nyert, nem, nem_reagal, lejart, kizart
- kikuldve: kiküldés = ma, határidő = +3 nap (hétvégén/ünnepen a köv. munkanap)
- valaszolt / foglalt / nyert / nem: válasz dátuma = ma (ha még üres)
Utána: git add -A && git commit -m "vezérlő: …" && git push
"""
import json, sys
from datetime import date, datetime, timedelta
from pathlib import Path

F = Path(__file__).resolve().parent / "vezerlo" / "adat.json"
ALLAPOTOK = {"keszul", "lezart", "elokeszites", "review", "kuldheto", "tartalek", "kikuldve", "valaszolt",
             "foglalt", "nyert", "nem", "nem_reagal", "lejart", "kizart"}
UNNEP = {"2026-10-23", "2026-11-01", "2026-12-24", "2026-12-25", "2026-12-26"}


def munkanap(d: date) -> date:
    while d.weekday() >= 5 or d.isoformat() in UNNEP:
        d += timedelta(days=1)
    return d


def main():
    a = sys.argv[1:]
    adat = json.loads(F.read_text("utf-8"))
    ma = date.today()
    if not a:
        for b in adat["boltok"]:
            hat = f"  határidő {b['hatarido']}" if b["hatarido"] else ""
            print(f"{b['id']:<16} {b['allapot']:<12} {b['kategoria']}{hat}")
        return
    if len(a) < 2:
        sys.exit(__doc__)
    b = next((x for x in adat["boltok"] if x["id"] == a[0]), None)
    if not b:
        sys.exit(f"Nincs ilyen id: {a[0]}  (lista: python3 vezerlo.py)")
    mit, szoveg = a[1], (a[2] if len(a) > 2 else "")
    regi_allapot = b["allapot"]
    if mit == "megj":
        b["megjegyzes"] = szoveg
    elif mit == "teendo":
        b["teendo"] = szoveg
    elif mit in ALLAPOTOK:
        b["allapot"] = mit
        if mit == "kikuldve":
            b["kikuldve"] = ma.isoformat()
            b["hatarido"] = munkanap(ma + timedelta(days=3)).isoformat()
            b["teendo"] = "Válaszra várunk"
        if mit in {"valaszolt", "foglalt", "nyert", "nem"} and not b["valasz_datum"]:
            b["valasz_datum"] = ma.isoformat()
        if szoveg:
            b["megjegyzes"] = szoveg
    else:
        sys.exit(f"Ismeretlen állapot: {mit}\n{__doc__}")
    if b["allapot"] != regi_allapot:
        b["allapot_datum"] = ma.isoformat()
        b.setdefault("elozmenyek", []).append({
            "datum": datetime.now().astimezone().isoformat(timespec="seconds"),
            "innen": regi_allapot,
            "ide": b["allapot"],
        })
        b["elozmenyek"] = b["elozmenyek"][-100:]
    adat["frissitve"] = ma.isoformat()
    F.write_text(json.dumps(adat, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"✓ {b['bolt']}: {b['allapot']}" + (f", határidő {b['hatarido']}" if b["hatarido"] else ""))


if __name__ == "__main__":
    main()
