#!/usr/bin/env python3
"""Egyszeri pótlás (2026-10-30): a vezérlőből hiányzó kész demók felvétele."""
import json
from pathlib import Path

F = Path(__file__).resolve().parent.parent / "vezerlo" / "adat.json"
adat = json.loads(F.read_text("utf-8"))
kat = {k["nev"] for k in adat["kategoriak"]}
ids = {b["id"] for b in adat["boltok"]}

UJ_KAT = [
    ("CBD / kender", "HempHealth → BudsCartel → Hill Vital"),
    ("Illatgyertya", "Viaszkuckó → Illatgyertya.hu → Aurora Candle"),
    ("Natúrkozmetika / kézműves szappan", "Napvirág → Highland Soap"),
    ("Fűszer / gourmet kamra", "Fűszerész"),
    ("Makett / miniatűr", "Makettshop → Modell & Hobby"),
    ("Művészellátó", "Művészellátó (Hobbyművész) → Kreatív Hobby"),
]
for nev, sor in UJ_KAT:
    if nev not in kat:
        adat["kategoriak"].append({"nev": nev, "sor": sor})

def bolt(id, nev, kategoria, kinek, email, telefon, minoseg, megj):
    return {"id": id, "bolt": nev, "kategoria": kategoria, "demo": id, "allapot": "kuldheto",
            "kinek": kinek, "email": email, "telefon": telefon, "kapcsolat_minoseg": minoseg,
            "kikuldve": "", "hatarido": "", "valasz_datum": "", "teendo": "Mehet a levél",
            "megjegyzes": megj}

UJ = [
    bolt("hemphealth", "HempHealth", "CBD / kender", "", "info@hemphealth.hu", "+36 30 100 9525",
         "Általános cím", "Hemp Health Kft., 1085 Bp., József krt. 59-61.; Meta-hirdetés ID 820423587772367"),
    bolt("viaszkucko", "Viaszkuckó", "Illatgyertya", "Balla János (egyéni vállalkozó)", "info@viaszkucko.hu", "",
         "Tulajdonosi csatorna", "4181 Nádudvar; hírlevél + hűségpont; Meta ID 1374634414503730"),
    bolt("napvirag", "Napvirág Natúrkozmetikum", "Natúrkozmetika / kézműves szappan", "",
         "ugyfelszolgalat@napviragszappan.hu", "", "Ügyfélszolgálat (családi manufaktúra)",
         "Conwell Kft., 2013 óta; hírlevél + hűségpont"),
    bolt("fuszeresz", "Fűszerész", "Fűszer / gourmet kamra", "… Kovács ügyvezető (Éva? nem igazolt)",
         "eve@fuszeresz.hu", "+36 1 951 3067", "Valószínű tulajdonosi cím",
         "Másolat: bolt@fuszeresz.hu; Fűszeres Kft., Szentendre"),
    bolt("makettshop", "Makettshop", "Makett / miniatűr", "", "info@makettshop.hu", "",
         "Általános cím", "Falcon-Model Kft., 4233 Balkány"),
    bolt("muveszellato", "Művészellátó (Hobbyművész)", "Művészellátó", "", "ugyfelszolgalat@muveszellato.com", "",
         "Központi ügyfélszolgálat (Dani: mehet)", "Art-Export 2020 Kft."),
    bolt("sarretichilifarm", "Sárréti ChiliFarm", "Chili / csípős szószok és fűszerek",
         "Bogár Márk (egyéni vállalkozó)", "info@chilifarm.hu", "+36 30 55 45227",
         "Tulajdonosi csatorna", "Családi vállalkozás 2012 óta, Tetétlen"),
]
for b in UJ:
    if b["id"] not in ids:
        adat["boltok"].append(b)

for b in adat["boltok"]:
    if b["id"] == "chilimania" and b["allapot"] != "nem":
        b["allapot"] = "nem"
        b["valasz_datum"] = b.get("valasz_datum") or "2026-10-29"
        b["teendo"] = "Lezárva – nemet mondott"
for k in adat["kategoriak"]:
    if k["nev"].startswith("Chili"):
        k["sor"] = "Chilimánia (nem) → Sárréti ChiliFarm"

F.write_text(json.dumps(adat, ensure_ascii=False, indent=1) + "\n", "utf-8")
print(len(adat["kategoriak"]), "kategória,", len(adat["boltok"]), "bolt")
