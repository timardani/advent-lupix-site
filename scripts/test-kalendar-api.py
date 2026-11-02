#!/usr/bin/env python3
"""A kalendar-api.py tesztjei valódi HTTP-szerveren, ideiglenes adatmappával.
Futtatás: python3 -I scripts/test-kalendar-api.py <seed-mappa, pl. ../webshop-kalendarium-demok/demeter/hatter-seed>
"""
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SEED = Path(sys.argv.pop(1)).resolve() if len(sys.argv) > 1 else HERE / "kalendar-seed"
NID = next(p.name for p in SEED.iterdir() if (p / "napok.json").exists())
TMP = tempfile.mkdtemp(prefix="kal-test-")

import os  # noqa: E402
os.environ.update(KAL_ADAT=TMP + "/adat", KAL_SEED=str(SEED), KAL_PORT="0", KAL_STATIC=TMP + "/static")
Path(TMP, "static").mkdir()
Path(TMP, "static", "index.html").write_text("<title>naptar</title>")
Path(TMP, "titok.txt").write_text("titok")
spec = importlib.util.spec_from_file_location("kal", HERE / "kalendar-api.py")
kal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kal)

srv = kal.ThreadingHTTPServer(("127.0.0.1", 0), kal.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
A = f"/api/kal/{NID}"
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 30


def req(method, path, body=None, raw=False):
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(BASE + path, data=data, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            b = resp.read()
            return resp.status, (json.loads(b) if b and "json" in resp.headers.get("Content-Type", "") else b)
    except urllib.error.HTTPError as e:
        b = e.read()
        try:
            return e.code, json.loads(b)
        except json.JSONDecodeError:
            return e.code, b


class T(unittest.TestCase):
    def setUp(self):
        kal.budapest_most = lambda now=None: datetime(2026, 11, 20, 12, tzinfo=timezone.utc)

    def test_01_seed_es_olvasas(self):
        s, j = req("GET", A + "/napok")
        self.assertEqual(s, 200)
        self.assertEqual([d["day"] for d in j["napok"]], list(range(1, 25)))
        self.assertTrue(all(d["code"] and d["product"]["image"] for d in j["napok"]))
        self.assertEqual(j["zarolt"], [])

    def test_02_mentes_es_ismeretlen_mezo(self):
        s, j = req("PUT", A + "/napok/3", {"code": "ujkod03", "title": "Új cím", "type": "csomag",
                                          "product": {"name": "Új termék", "priceHuf": 4990, "image": "products/03.webp"}})
        self.assertEqual(s, 200, j)
        self.assertEqual(j["nap"]["code"], "UJKOD03")
        _, j = req("GET", A + "/napok")
        d = j["napok"][2]
        self.assertEqual((d["title"], d["product"]["name"], d["product"]["priceHuf"]), ("Új cím", "Új termék", 4990))
        seed_type = json.loads((SEED / NID / "napok.json").read_text())[2]["type"]
        self.assertEqual(d["type"], seed_type)  # a típus nem írható
        self.assertTrue((Path(TMP) / "adat" / NID / "valtozasok.jsonl").read_text().strip())

    def test_03_hibas_mezok(self):
        s, j = req("PUT", A + "/napok/4", {"code": "x", "product": {"url": "javascript:alert(1)", "priceHuf": -5,
                                                                   "image": "../../etc/passwd", "name": ""}})
        self.assertEqual(s, 422)
        self.assertEqual(set(j["mezok"]), {"code", "product.url", "product.priceHuf", "product.image", "product.name"})
        self.assertEqual(req("PUT", A + "/napok/25", {})[0], 404)
        self.assertEqual(req("PUT", A + "/napok/4", b"nem json", raw=True)[0], 400)
        self.assertEqual(req("PUT", A + "/napok/4", b"x" * 40000, raw=True)[0], 413)

    def test_04_kedvezmeny_pct_frissiti_a_feliratot(self):
        _, j = req("GET", A + "/napok")
        d = next(x for x in j["napok"] if x["type"] == "kedvezmeny")
        s, j = req("PUT", f"{A}/napok/{d['day']}", {"pct": 30})
        self.assertEqual((s, j["nap"]["pct"], j["nap"]["badge"]), (200, 30, "−30%"))
        self.assertEqual(req("PUT", f"{A}/napok/{d['day']}", {"pct": 95})[0], 422)

    def test_05_lement_nap_zarolt(self):
        kal.budapest_most = lambda now=None: datetime(2026, 12, 10, 12, tzinfo=timezone.utc)
        self.assertEqual(req("PUT", A + "/napok/9", {"title": "x"})[0], 409)
        self.assertEqual(req("PUT", A + "/napok/10", {"title": "Mai cím"})[0], 200)
        _, j = req("GET", A + "/napok")
        self.assertEqual((j["ma"], j["zarolt"]), (10, list(range(1, 10))))

    def test_06_meres_csak_szamlalo(self):
        kal.budapest_most = lambda now=None: datetime(2026, 12, 7, 12, tzinfo=timezone.utc)
        for t in ("latogatas", "latogatas", "ablak", "masolas", "atkattintas"):
            self.assertEqual(req("POST", A + "/e", {"t": t, "nap": 7})[0], 204)
        self.assertEqual(req("POST", A + "/e", {"t": "ip", "nap": 7})[0], 400)
        self.assertEqual(req("POST", A + "/e", {"t": "ablak", "nap": 0})[0], 400)
        self.assertEqual(req("POST", A + "/e", b"x" * 400, raw=True)[0], 400)
        _, j = req("GET", A + "/statisztika")
        self.assertEqual(j["valos"]["latogatas"], {"2026-12-07": 2})
        self.assertEqual(j["valos"]["napok"]["7"], {"ablak": 1, "masolas": 1, "atkattintas": 1})
        self.assertIsNotNone(j["pelda"])
        self.assertEqual(len(j["pelda"]["napok"]), 24)
        raw = (Path(TMP) / "adat" / NID / "stat.json").read_text()
        self.assertNotIn("127.0.0.1", raw)

    def test_07_pelda_torles(self):
        self.assertEqual(req("POST", A + "/pelda-torles")[0], 200)
        _, j = req("GET", A + "/statisztika")
        self.assertIsNone(j["pelda"])
        self.assertEqual(j["valos"]["napok"]["7"]["ablak"], 1)

    def test_08_kepfeltoltes(self):
        s, j = req("POST", A + "/kep?nap=5", WEBP, raw=True)
        self.assertEqual(s, 201, j)
        s, b = req("GET", j["url"])
        self.assertEqual((s, b[:4]), (200, b"RIFF"))
        self.assertEqual(req("PUT", A + "/napok/5", {"product": {"image": j["url"]}})[0], 200)
        self.assertEqual(req("POST", A + "/kep?nap=5", b"<svg onload=alert(1)>", raw=True)[0], 415)
        self.assertEqual(req("POST", A + "/kep", WEBP, raw=True)[0], 400)
        self.assertEqual(req("PUT", A + "/napok/5", {"product": {"image": f"/api/kal/{NID}/kep/../../x.webp"}})[0], 422)

    def test_09_utvonal_trukkok(self):
        self.assertEqual(req("GET", "/api/kal/../titok.txt")[0], 404)
        self.assertEqual(req("GET", "/../titok.txt")[0], 404)
        self.assertEqual(req("GET", "/%2e%2e/titok.txt")[0], 404)
        self.assertEqual(req("GET", "/api/kal/nincs-ilyen/napok")[0], 404)
        self.assertEqual(req("GET", A + "/kep/..%2f..%2ftitok.txt")[0], 404)
        s, b = req("GET", "/")
        self.assertEqual((s, b"naptar" in b), (200, True))

    def test_10_budapesti_ido(self):
        spec2 = importlib.util.spec_from_file_location("kal2", HERE / "kalendar-api.py")
        k2 = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(k2)
        self.assertEqual(k2.budapest_most(datetime(2026, 12, 6, 23, 30, tzinfo=timezone.utc)).day, 7)  # tél: +1
        self.assertEqual(k2.budapest_most(datetime(2026, 7, 1, 22, 30, tzinfo=timezone.utc)).hour, 0)  # nyár: +2
        self.assertEqual(k2.mai_nap(datetime(2026, 12, 24, 10, tzinfo=timezone.utc)), 24)
        self.assertIsNone(k2.mai_nap(datetime(2026, 12, 25, 10, tzinfo=timezone.utc)))


if __name__ == "__main__":
    unittest.main(verbosity=1)
