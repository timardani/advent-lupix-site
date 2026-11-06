#!/usr/bin/env python3
"""Belső, csak nginx mögül elérhető API a vezérlő adatainak mentéséhez."""
import json
import os
import secrets
import time
import shutil
import tempfile
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

SEED = Path(os.environ.get("VEZERLO_SEED", "/app-seed/adat.json"))
DATA = Path(os.environ.get("VEZERLO_ADAT", "/data/adat.json"))
RELEASES = Path(os.environ.get("VEZERLO_KIADAS", "/usr/share/nginx/html/vezerlo/kiadas.json"))
HOST = os.environ.get("VEZERLO_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("VEZERLO_API_PORT", "8081"))
MAX_BODY = 16_384
ALLAPOTOK = {
    "elokeszites", "review", "kuldheto", "tartalek", "kikuldve", "valaszolt",
    "foglalt", "nyert", "nem", "nem_reagal", "lejart", "kizart",
    # 2026-10-30: egyszerűsített 5 státusz (a régiek visszafelé kompatibilisek)
    "keszul", "lezart",
    # 2026-11-02: a bolt időt kért; a határidő = rákérdezés napja
    "idot_kert",
}
ELOTTE = {"elokeszites", "review", "kuldheto", "tartalek", "keszul"}
VALASZ_ALLAPOTOK = {"valaszolt", "foglalt", "nyert", "nem", "idot_kert"}
DINAMIKUS_BOLT_MEZOK = {
    "allapot", "kikuldve", "hatarido", "valasz_datum", "teendo",
    "allapot_datum", "elozmenyek",
    # 2026-11-03: dátumozott megjegyzés-csempék (Dani írja a felületen)
    "jegyzetek",
}
JEGYZET_MAX = 3000
# Dani által a felületen kézzel beírható kapcsolati adatok. Ha a /data-ban
# már nem üres, az marad; ha üres, a seed (kutatásból jövő) érték érvényes.
KEZI_MEZOK = {"kinek", "email", "telefon", "megjegyzes", "weboldal"}
# A vezérlő Lezárt oszlopának állapotai.
LEZART_ALLAPOTOK = {"lezart", "nem", "lejart", "kizart"}


def demo_access(uri, is_admin):
    """A lezárt bemutató csak a vezérlőbe belépett felhasználónak érhető el."""
    path = uri.split("?", 1)[0]
    # Az nginx normalizálja a kiszolgált útvonalat. Az eredeti URI nem
    # engedhet másik demóba átlépést (../, // vagy %-kódolt változatok).
    if not path.startswith("/") or "%" in path or "//" in path or any(
            segment in {".", ".."} for segment in path.split("/")):
        return False
    parts = path.split("/")
    slug = parts[3] if parts[1:3] == ["api", "kal"] else parts[1]
    releases = json.loads(RELEASES.read_text("utf-8"))
    demo = next((d["demo"] for d in releases["demok"] if d["slug"] == slug), None)
    if not demo:
        return False
    if is_admin:
        return True
    bolt = next((b for b in load_data()["boltok"] if b.get("id") == demo), None)
    # Hiányzó/érvénytelen rekord vagy olvasási hiba esetén nem tesszük nyilvánossá.
    status = bolt.get("allapot") if bolt else None
    return status in ALLAPOTOK and status not in LEZART_ALLAPOTOK


def init_data():
    DATA.parent.mkdir(parents=True, exist_ok=True)
    if not DATA.exists():
        shutil.copy2(SEED, DATA)
        return

    # A seed a központi ügyfél- és kontaktadat-forrás. Friss deploynál az új
    # boltok/kategóriák bekerülnek, a /data-ban vezetett értékesítési állapot,
    # dátumok és előzmények viszont változatlanul megmaradnak.
    seed = json.loads(SEED.read_text("utf-8"))
    live = json.loads(DATA.read_text("utf-8"))
    current = {b.get("id"): b for b in live.get("boltok", [])}
    merged_shops = []
    for base in seed.get("boltok", []):
        merged = dict(base)
        old = current.get(base.get("id"), {})
        for key in DINAMIKUS_BOLT_MEZOK:
            if key in old:
                merged[key] = old[key]
        for key in KEZI_MEZOK:
            if old.get(key):
                merged[key] = old[key]
        merged_shops.append(merged)
    seed["boltok"] = merged_shops
    seed["frissitve"] = live.get("frissitve", seed.get("frissitve"))
    if seed != live:
        save_data(seed)


def load_data():
    return json.loads(DATA.read_text("utf-8"))


def save_data(adat):
    adat["frissitve"] = date.today().isoformat()
    fd, name = tempfile.mkstemp(prefix="adat-", suffix=".json", dir=DATA.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(adat, f, ensure_ascii=False, indent=1)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, DATA)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def default_deadline(sent_date):
    deadline = sent_date + timedelta(days=3)
    while deadline.weekday() >= 5:
        deadline += timedelta(days=1)
    return deadline.isoformat()


def valid_date(value):
    if value == "":
        return value
    return date.fromisoformat(value).isoformat()


class Handler(BaseHTTPRequestHandler):
    server_version = "AdventVezerlo/1.0"

    def log_message(self, fmt, *args):
        print(f"vezerlo-api: {self.address_string()} {fmt % args}", flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/demo-access":
            try:
                allowed = demo_access(self.headers.get("X-Demo-URI", ""),
                                      self.headers.get("X-Vezerlo-OK") == "1")
            except (ValueError, KeyError, IndexError, OSError, TypeError):
                allowed = False
            return self.send_json(200 if allowed else 403, {"elerheto": allowed})
        if urlparse(self.path).path != "/adat":
            return self.send_json(404, {"hiba": "Nincs ilyen végpont."})
        try:
            self.send_json(200, load_data())
        except Exception as exc:
            self.send_json(500, {"hiba": f"Az adat nem olvasható: {type(exc).__name__}"})

    def do_PATCH(self):
        if urlparse(self.path).path != "/adat":
            return self.send_json(404, {"hiba": "Nincs ilyen végpont."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BODY:
                return self.send_json(413, {"hiba": "Érvénytelen kérésméret."})
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
                return self.send_json(400, {"hiba": "Hiányzó boltazonosító."})
            allowed = {"id", "kikuldve", "hatarido", "allapot", "teendo", "jegyzet_uj", "jegyzet"} | KEZI_MEZOK
            if set(payload) - allowed:
                return self.send_json(400, {"hiba": "Nem támogatott mező."})

            adat = load_data()
            bolt = next((b for b in adat.get("boltok", []) if b.get("id") == payload["id"]), None)
            if not bolt:
                return self.send_json(404, {"hiba": "Nincs ilyen bolt."})

            today = date.today()
            old_status = bolt.get("allapot", "")
            if "allapot" in payload:
                status = payload["allapot"]
                if status not in ALLAPOTOK:
                    return self.send_json(400, {"hiba": "Ismeretlen státusz."})
                bolt["allapot"] = status
                if status == "kikuldve" and not bolt.get("kikuldve"):
                    bolt["kikuldve"] = today.isoformat()
                if status == "kikuldve" and not bolt.get("hatarido"):
                    bolt["hatarido"] = default_deadline(today)
                if status == "idot_kert" and "hatarido" not in payload and (not bolt.get("hatarido") or bolt["hatarido"] <= today.isoformat()):
                    # Alapból egy hét múlva kérdezünk rá; a vezérlőben átírható.
                    bolt["hatarido"] = (today + timedelta(days=7)).isoformat()
                if status in VALASZ_ALLAPOTOK and not bolt.get("valasz_datum"):
                    bolt["valasz_datum"] = today.isoformat()

            if "kikuldve" in payload:
                sent = payload["kikuldve"]
                if isinstance(sent, bool):
                    if sent:
                        bolt["kikuldve"] = bolt.get("kikuldve") or today.isoformat()
                        if bolt.get("allapot") in ELOTTE:
                            bolt["allapot"] = "kikuldve"
                        if not bolt.get("hatarido"):
                            bolt["hatarido"] = default_deadline(today)
                    else:
                        bolt["kikuldve"] = ""
                        if bolt.get("allapot") == "kikuldve":
                            bolt["allapot"] = "kuldheto"
                elif isinstance(sent, str):
                    try:
                        bolt["kikuldve"] = valid_date(sent)
                        # A kézzel javított kiküldési dátumhoz tartozó határidő
                        # is automatikusan újraszámolódik. Üres dátum törli azt.
                        bolt["hatarido"] = default_deadline(date.fromisoformat(sent)) if sent else ""
                        if sent and bolt.get("allapot") in ELOTTE:
                            bolt["allapot"] = "kikuldve"
                    except ValueError:
                        return self.send_json(400, {"hiba": "Érvénytelen kiküldési dátum."})
                else:
                    return self.send_json(400, {"hiba": "Érvénytelen kiküldési dátum."})

            if "hatarido" in payload:
                if not isinstance(payload["hatarido"], str):
                    return self.send_json(400, {"hiba": "Érvénytelen határidő."})
                try:
                    bolt["hatarido"] = valid_date(payload["hatarido"])
                except ValueError:
                    return self.send_json(400, {"hiba": "Érvénytelen határidő."})

            if "teendo" in payload:
                task = payload["teendo"]
                if not isinstance(task, str) or len(task) > 500:
                    return self.send_json(400, {"hiba": "Érvénytelen következő teendő."})
                bolt["teendo"] = task.strip()

            if "jegyzet_uj" in payload or "jegyzet" in payload:
                notes = bolt.get("jegyzetek")
                if not isinstance(notes, list):
                    notes = bolt["jegyzetek"] = []
                now = datetime.now(timezone.utc).isoformat(timespec="seconds")
                if "jegyzet_uj" in payload:
                    text = payload["jegyzet_uj"]
                    if not isinstance(text, str) or not text.strip() or len(text) > JEGYZET_MAX:
                        return self.send_json(400, {"hiba": "Érvénytelen megjegyzés."})
                    notes.append({"id": f"n{int(time.time() * 1000)}{secrets.token_hex(2)}",
                                  "datum": now, "szoveg": text.strip()})
                if "jegyzet" in payload:
                    edit = payload["jegyzet"]
                    if (not isinstance(edit, dict) or not isinstance(edit.get("id"), str)
                            or not isinstance(edit.get("szoveg"), str) or not edit["szoveg"].strip()
                            or len(edit["szoveg"]) > JEGYZET_MAX):
                        return self.send_json(400, {"hiba": "Érvénytelen megjegyzés (üresre nem írható)."})
                    note = next((n for n in notes if isinstance(n, dict) and n.get("id") == edit["id"]), None)
                    if not note:
                        return self.send_json(404, {"hiba": "Nincs ilyen megjegyzés."})
                    if note.get("szoveg") != edit["szoveg"].strip():
                        note["szoveg"] = edit["szoveg"].strip()
                        note["modositva"] = now

            for key in KEZI_MEZOK & set(payload):
                value = payload[key]
                if not isinstance(value, str) or len(value) > 500:
                    return self.send_json(400, {"hiba": "Érvénytelen kapcsolati adat."})
                bolt[key] = value.strip()

            if bolt.get("allapot") != old_status:
                bolt["allapot_datum"] = today.isoformat()
                history = bolt.setdefault("elozmenyek", [])
                if not isinstance(history, list):
                    history = bolt["elozmenyek"] = []
                history.append({
                    "datum": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "innen": old_status,
                    "ide": bolt["allapot"],
                })
                del history[:-100]

            save_data(adat)
            self.send_json(200, adat)
        except json.JSONDecodeError:
            self.send_json(400, {"hiba": "Érvénytelen JSON."})
        except Exception as exc:
            self.send_json(500, {"hiba": f"A mentés nem sikerült: {type(exc).__name__}"})


if __name__ == "__main__":
    init_data()
    print(f"vezerlo-api: http://{HOST}:{PORT}, adat={DATA}", flush=True)
    # Egyetlen adminfelülethez a soros szerver szándékos: a read–modify–write
    # mentések így nem írhatják felül egymást párhuzamos kéréseknél.
    HTTPServer((HOST, PORT), Handler).serve_forever()
