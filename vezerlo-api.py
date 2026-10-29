#!/usr/bin/env python3
"""Belső, csak nginx mögül elérhető API a vezérlő adatainak mentéséhez."""
import json
import os
import shutil
import tempfile
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

SEED = Path(os.environ.get("VEZERLO_SEED", "/app-seed/adat.json"))
DATA = Path(os.environ.get("VEZERLO_ADAT", "/data/adat.json"))
HOST = os.environ.get("VEZERLO_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("VEZERLO_API_PORT", "8081"))
MAX_BODY = 16_384
ALLAPOTOK = {
    "elokeszites", "review", "kuldheto", "tartalek", "kikuldve", "valaszolt",
    "foglalt", "nyert", "nem", "nem_reagal", "lejart", "kizart",
}
VALASZ_ALLAPOTOK = {"valaszolt", "foglalt", "nyert", "nem"}
DINAMIKUS_BOLT_MEZOK = {
    "allapot", "kikuldve", "hatarido", "valasz_datum", "teendo",
    "allapot_datum", "elozmenyek",
}


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
            allowed = {"id", "kikuldve", "hatarido", "allapot", "teendo"}
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
                if status in VALASZ_ALLAPOTOK and not bolt.get("valasz_datum"):
                    bolt["valasz_datum"] = today.isoformat()

            if "kikuldve" in payload:
                sent = payload["kikuldve"]
                if isinstance(sent, bool):
                    if sent:
                        bolt["kikuldve"] = bolt.get("kikuldve") or today.isoformat()
                        if bolt.get("allapot") in {"elokeszites", "review", "kuldheto", "tartalek"}:
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
                        if sent and bolt.get("allapot") in {"elokeszites", "review", "kuldheto", "tartalek"}:
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
