#!/usr/bin/env python3
"""Vezérlő-szinkron: minden kiadás előtt lefut (kiad.py hívja).

1. Minden demómappa (dist/ vagy index.html) szerepeljen a vezerlo/adat.json-ban.
   Ami hiányzik, az "Besorolandó" kategóriával, "review" állapotban bekerül,
   így egy elkészült kalendárium sosem tűnik el a vezérlőből.
2. A kutatási jelöltek (scripts/kutatas-import.json + opcionális
   vezerlo/kutatas-kezi.json) a vezerlo/kutatas.json fájlba kerülnek a
   kategóriaoldalnak.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMOS = ROOT.parent / "webshop-kalendarium-demok"
ADAT = ROOT / "vezerlo" / "adat.json"
IMPORT = ROOT / "scripts" / "kutatas-import.json"
KEZI = ROOT / "vezerlo" / "kutatas-kezi.json"
OUT = ROOT / "vezerlo" / "kutatas.json"
NINCS_DEMO = {"stuhmer"}  # kizárt célbolt: nem kerül ki, de az adatban szerepel


def main():
    adat = json.loads(ADAT.read_text("utf-8"))
    van = {b.get("demo") for b in adat["boltok"]} | {b["id"] for b in adat["boltok"]}
    uj = []
    for d in sorted(DEMOS.iterdir()):
        if d.name.startswith(("_", ".")) or not d.is_dir():
            continue
        if not ((d / "dist").exists() or (d / "index.html").exists()):
            continue
        if d.name not in van:
            adat["boltok"].append({
                "id": d.name, "bolt": d.name, "kategoria": "Besorolandó", "demo": d.name,
                "allapot": "review", "kinek": "", "email": "", "telefon": "",
                "kapcsolat_minoseg": "", "kikuldve": "", "hatarido": "", "valasz_datum": "",
                "teendo": "Kategória és kapcsolat pótlása", "megjegyzes": "Automatikusan felvéve"})
            uj.append(d.name)
    if uj and not any(k["nev"] == "Besorolandó" for k in adat["kategoriak"]):
        adat["kategoriak"].append({"nev": "Besorolandó", "sor": "Automatikusan felvett demók"})
    if uj:
        ADAT.write_text(json.dumps(adat, ensure_ascii=False, indent=1) + "\n", "utf-8")
        print("  vezérlő: új demó felvéve:", ", ".join(uj))

    kat = []
    if IMPORT.exists():
        kat = json.loads(IMPORT.read_text("utf-8")).get("categories", [])
    if KEZI.exists():
        kat += json.loads(KEZI.read_text("utf-8")).get("categories", [])
    slim = [{"nev": c["category"], "megj": "; ".join(c.get("notes") or []),
             "jeloltek": [{k: s.get(k) for k in ("name", "url", "priority", "status")}
                          for s in c.get("shops", [])]} for c in kat]
    OUT.write_text(json.dumps({"kategoriak": slim}, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"  vezérlő: {len(adat['boltok'])} bolt, {len(slim)} kutatási kategória")


if __name__ == "__main__":
    main()
