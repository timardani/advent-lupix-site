#!/usr/bin/env python3
"""Adventi naptár háttérrendszer: napi tartalom szerkesztése + névtelen statisztika.

Csak Python standard könyvtár. Egy bolt = egy mappa a KAL_ADAT alatt:
  <KAL_ADAT>/<naptar-id>/napok.json        a 24 nap (termék + akció + kupon)
  <KAL_ADAT>/<naptar-id>/stat.json         valós, napi összesített számlálók
  <KAL_ADAT>/<naptar-id>/kepek/            feltöltött képek
  <KAL_ADAT>/<naptar-id>/valtozasok.jsonl  szerkesztési napló
Az első indításkor a KAL_SEED/<naptar-id>/ (napok.json, pelda-stat.json) kerül át;
meglévő adatot sosem ír felül.

GDPR: a mérés nem használ sütit, eszközazonosítót, IP-címet vagy User-Agentet,
csak (dátum, nap, esemény) szerinti egész számlálókat ment.

Végpontok (prefix: /api/kal/<naptar-id>):
  GET  /napok                 a 24 nap (a naptár és a háttérfelület is ezt olvassa)
  PUT  /napok/<n>             egy nap mezőinek módosítása
  POST /kep                   képfeltöltés (nyers WebP/JPEG/PNG törzs) -> {"url": ...}
  GET  /kep/<fajl>            feltöltött kép
  POST /e                     mérési esemény {"t": latogatas|ablak|masolas|atkattintas, "nap": 1-24}
  GET  /statisztika           {"pelda": {...}|null, "valos": {...}}
  POST /pelda-torles          a példaadatok elrejtése (a valós számlálók maradnak)

Önálló futtatás (ügyfélnél, nginx nélkül): KAL_STATIC=<a naptár dist mappája>
mellett a nem-API útvonalakat is kiszolgálja.
"""
import json
import os
import re
import shutil
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

ADAT = Path(os.environ.get("KAL_ADAT", "/data/kalendar"))
SEED = Path(os.environ.get("KAL_SEED", "/app-seed/kalendar"))
STATIC = os.environ.get("KAL_STATIC", "")
HOST = os.environ.get("KAL_HOST", "127.0.0.1")
PORT = int(os.environ.get("KAL_PORT", "8082"))
KAMPANY_EV = int(os.environ.get("KAL_EV", "2026"))

MAX_JSON = 32_768
MAX_KEP = 2_500_000
ID_RX = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")
KEP_RX = re.compile(r"^[0-9]{2}-[0-9]{10,13}\.(webp|jpg|png)$")
KOD_RX = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,23}$")
ESEMENYEK = ("latogatas", "ablak", "masolas", "atkattintas")
TIPUSOK = {"kedvezmeny", "1plus1", "ajandek", "szallitas", "csomag"}
# szerkeszthető mezők: név -> (hossz-korlát)
NAP_SZOVEG = {"title": 90, "detail": 400, "conditions": 240, "code": 24, "badge": 8}
TERMEK_SZOVEG = {"name": 120, "description": 600, "url": 400, "category": 40, "image": 200}
LOCK = threading.Lock()


# ---------- segédek ----------
def budapest_most(now=None):
    """Budapesti helyi idő tzdata nélkül (EU nyári időszámítás szabálya)."""
    now = now or datetime.now(timezone.utc)
    y = now.year

    def utolso_vasarnap(honap):
        d = datetime(y, honap, 31, 1, tzinfo=timezone.utc)
        return d - timedelta(days=(d.weekday() + 1) % 7)

    nyari = utolso_vasarnap(3) <= now < utolso_vasarnap(10)
    return now + timedelta(hours=2 if nyari else 1)


def mai_nap(now=None):
    """A kampány mai napja (1-24) decemberben, egyébként None."""
    t = budapest_most(now)
    if t.year == KAMPANY_EV and t.month == 12 and t.day <= 24:
        return t.day
    return None


def zarolt(nap, now=None):
    """Elmúlt napot már nem lehet szerkeszteni (a vásárlók látták)."""
    t = budapest_most(now)
    if t.year > KAMPANY_EV or (t.year == KAMPANY_EV and t.month == 12 and t.day > nap):
        return True
    return False


def atomic_write(path: Path, data: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, path)


def load(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def naptar_dir(nid: str):
    if not ID_RX.match(nid):
        return None
    d = ADAT / nid
    if not d.exists():
        seed = SEED / nid
        if not (seed / "napok.json").exists():
            return None
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(seed / "napok.json", d / "napok.json")
    return d


def pelda(nid: str):
    return load(SEED / nid / "pelda-stat.json", None)


def ures_stat():
    return {"latogatas": {}, "napok": {}, "pelda_torolve": False}


# ---------- validálás ----------
def tiszta(s, n):
    if not isinstance(s, str):
        raise ValueError("szöveg kell")
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", s).strip()
    if len(s) > n:
        raise ValueError(f"legfeljebb {n} karakter")
    return s


def kep_ok(nid, v):
    return (v.startswith("products/") and ".." not in v) or bool(
        re.match(rf"^/api/kal/{re.escape(nid)}/kep/[0-9]{{2}}-[0-9]{{10,13}}\.(webp|jpg|png)$", v))


def alkalmaz(nid, nap: dict, valtozas: dict):
    """A kérésből csak az engedélyezett mezők kerülnek át; hibánál ValueError."""
    uj = json.loads(json.dumps(nap))
    hibak = {}
    for k, n in NAP_SZOVEG.items():
        if k in valtozas:
            try:
                v = tiszta(valtozas[k], n)
                if k == "code":
                    v = v.upper()
                    if not KOD_RX.match(v):
                        raise ValueError("3–24 karakter: nagybetű, szám, kötőjel")
                if k in ("title", "code") and not v:
                    raise ValueError("nem lehet üres")
                uj[k] = v
            except ValueError as e:
                hibak[k] = str(e)
    if "pct" in valtozas and uj.get("type") == "kedvezmeny":
        try:
            p = int(valtozas["pct"])
            if not 1 <= p <= 90:
                raise ValueError
            uj["pct"] = p
            if "badge" not in valtozas:
                uj["badge"] = f"−{p}%"
        except (ValueError, TypeError):
            hibak["pct"] = "1 és 90 közötti egész szám"
    termek = valtozas.get("product") or {}
    if not isinstance(termek, dict):
        termek = {}
    for k, n in TERMEK_SZOVEG.items():
        if k in termek:
            try:
                v = tiszta(termek[k], n)
                if k == "name" and not v:
                    raise ValueError("nem lehet üres")
                if k == "url" and not re.match(r"^https?://[^\s\"'<>]+$", v):
                    raise ValueError("teljes webcím kell (https://…)")
                if k == "image" and not kep_ok(nid, v):
                    raise ValueError("érvénytelen kép")
                uj["product"][k] = v
            except ValueError as e:
                hibak[f"product.{k}"] = str(e)
    if "priceHuf" in termek:
        try:
            p = int(termek["priceHuf"])
            if not 1 <= p <= 10_000_000:
                raise ValueError
            uj["product"]["priceHuf"] = p
        except (ValueError, TypeError):
            hibak["product.priceHuf"] = "pozitív egész forintösszeg"
    if hibak:
        raise ValueError(json.dumps(hibak, ensure_ascii=False))
    return uj


def kep_tipus(b: bytes):
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return None


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    server_version = "kal/1"

    def log_message(self, fmt, *args):  # nincs hozzáférési napló (IP sem)
        return

    def send(self, status, body=b"", ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > limit:
            raise OverflowError
        return self.rfile.read(n)

    def route(self):
        p = unquote(urlparse(self.path).path)
        m = re.match(r"^/api/kal/([^/]+)(/.*)?$", p)
        if not m:
            return None, None, p
        return m.group(1), (m.group(2) or "/"), p

    # statikus kiszolgálás önálló módban
    def static(self, p):
        if not STATIC:
            return self.send(404, {"hiba": "nincs ilyen"})
        root = Path(STATIC).resolve()
        f = (root / p.lstrip("/")).resolve()
        if root not in f.parents and f != root:
            return self.send(404, {"hiba": "nincs ilyen"})
        if f.is_dir():
            f = f / "index.html"
        if not f.is_file():
            return self.send(404, b"404", "text/plain")
        typ = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
               ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp",
               ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg"}.get(f.suffix, "application/octet-stream")
        self.send(200, f.read_bytes(), typ)

    def do_GET(self):
        nid, rest, p = self.route()
        if nid is None:
            return self.static(p)
        d = naptar_dir(nid)
        if d is None:
            return self.send(404, {"hiba": "ismeretlen naptár"})
        if rest == "/napok":
            napok = load(d / "napok.json", None)
            return self.send(200, {"napok": napok, "ma": mai_nap(), "ev": KAMPANY_EV,
                                   "zarolt": [n for n in range(1, 25) if zarolt(n)]})
        if rest == "/statisztika":
            stat = load(d / "stat.json", ures_stat())
            return self.send(200, {"pelda": None if stat.get("pelda_torolve") else pelda(nid),
                                   "valos": {"latogatas": stat["latogatas"], "napok": stat["napok"]}})
        m = re.match(r"^/kep/([^/]+)$", rest)
        if m and KEP_RX.match(m.group(1)) and (d / "kepek" / m.group(1)).is_file():
            ext = m.group(1).rsplit(".", 1)[1]
            typ = {"webp": "image/webp", "jpg": "image/jpeg", "png": "image/png"}[ext]
            return self.send(200, (d / "kepek" / m.group(1)).read_bytes(), typ,
                             {"Cache-Control": "public, max-age=31536000, immutable"})
        return self.send(404, {"hiba": "nincs ilyen"})

    do_HEAD = do_GET

    def do_PUT(self):
        nid, rest, _ = self.route()
        d = naptar_dir(nid) if nid else None
        m = re.match(r"^/napok/([0-9]{1,2})$", rest or "")
        if d is None or not m or not 1 <= int(m.group(1)) <= 24:
            return self.send(404, {"hiba": "nincs ilyen"})
        n = int(m.group(1))
        if zarolt(n):
            return self.send(409, {"hiba": "Ez a nap már lement, nem módosítható."})
        try:
            valtozas = json.loads(self.body(MAX_JSON))
            if not isinstance(valtozas, dict):
                raise ValueError("{}")
        except OverflowError:
            return self.send(413, {"hiba": "túl nagy kérés"})
        except (json.JSONDecodeError, ValueError):
            return self.send(400, {"hiba": "hibás JSON"})
        with LOCK:
            napok = load(d / "napok.json", None)
            if not napok or len(napok) != 24:
                return self.send(500, {"hiba": "sérült adat"})
            try:
                uj = alkalmaz(nid, napok[n - 1], valtozas)
            except ValueError as e:
                return self.send(422, {"hiba": "Hibás mező", "mezok": json.loads(str(e))})
            napok[n - 1] = uj
            atomic_write(d / "napok.json", json.dumps(napok, ensure_ascii=False, indent=1))
            with open(d / "valtozasok.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"ido": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                    "nap": n, "mezok": sorted(valtozas)}, ensure_ascii=False) + "\n")
        return self.send(200, {"nap": uj})

    def do_POST(self):
        nid, rest, _ = self.route()
        d = naptar_dir(nid) if nid else None
        if d is None:
            return self.send(404, {"hiba": "nincs ilyen"})
        if rest == "/e":
            return self.esemeny(d)
        if rest == "/kep":
            return self.kep(d, nid)
        if rest == "/pelda-torles":
            with LOCK:
                stat = load(d / "stat.json", ures_stat())
                stat["pelda_torolve"] = True
                atomic_write(d / "stat.json", json.dumps(stat, ensure_ascii=False))
            return self.send(200, {"ok": True})
        return self.send(404, {"hiba": "nincs ilyen"})

    def esemeny(self, d):
        try:
            e = json.loads(self.body(256))
            t, nap = e.get("t"), int(e.get("nap", 0))
        except (OverflowError, json.JSONDecodeError, ValueError, TypeError, AttributeError):
            return self.send(400, {"hiba": "hibás esemény"})
        if t not in ESEMENYEK or not 1 <= nap <= 24:
            return self.send(400, {"hiba": "hibás esemény"})
        datum = budapest_most().date().isoformat()
        with LOCK:
            stat = load(d / "stat.json", ures_stat())
            if t == "latogatas":
                stat["latogatas"][datum] = stat["latogatas"].get(datum, 0) + 1
            else:
                nk = stat["napok"].setdefault(str(nap), {})
                nk[t] = nk.get(t, 0) + 1
            atomic_write(d / "stat.json", json.dumps(stat, ensure_ascii=False))
        return self.send(204)

    def kep(self, d, nid):
        m = re.search(r"[?&]nap=([0-9]{1,2})", self.path)
        nap = int(m.group(1)) if m else 0
        if not 1 <= nap <= 24:
            return self.send(400, {"hiba": "hiányzó nap"})
        try:
            b = self.body(MAX_KEP)
        except OverflowError:
            return self.send(413, {"hiba": "A kép legfeljebb 2,5 MB lehet."})
        ext = kep_tipus(b)
        if not ext:
            return self.send(415, {"hiba": "Csak WebP, JPEG vagy PNG kép tölthető fel."})
        nev = f"{nap:02d}-{int(time.time() * 1000)}.{ext}"
        (d / "kepek").mkdir(exist_ok=True)
        (d / "kepek" / nev).write_bytes(b)
        return self.send(201, {"url": f"/api/kal/{nid}/kep/{nev}"})


def main():
    ADAT.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"kalendar-api: {HOST}:{PORT} adat={ADAT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
