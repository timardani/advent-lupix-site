#!/usr/bin/env python3
"""atdolgoz.py – kategóriademó átdolgozásának gépi része új boltra (stdlib only).

Usage: python3 atdolgoz.py <forras-slug> <uj-slug> <bolt-url> [--n 24] [--kat <substr> ...]
                           [--nincs-katalogus] [--fresh]

Lépések:
 1. webshop-kalendarium-demok/<forras> → <uj> másolás (rsync, horgonyzott
    kizárások: /dist /screenshots /research /public/products /node_modules;
    a node_modules külön, teljesen másolódik, hogy a vite/dist ne vesszen el).
 2. package.json: name + szabad dev/preview port (minden demó portját és a
    foglalt portokat kerüli).
 3. katalogus.py <url> --out <uj> (24 termék + képek), hacsak --nincs-katalogus.
 4. jelolt.py adataiból a bolt logója → public/logo-<uj>.<ext> (ha talál).
 5. data/_REGI_BOLT jelzőfájl: amíg létezik, az ajanlat_ellenor.py HIBÁT ad
    (az offers.json / companions.json még a régi boltra szól).
 6. Kimenet ≤15 sor: hol maradt a régi bolt neve/domainje (fájl: találat).
Részletek: scripts/hajra/log/atdolgoz.log. Exit: 0 kész, 1 kész, de lépés
hiányos, 2 nem indult (hibás bemenet, már létező cél).
"""
import json
import re
import shutil
import socket
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMOS = HERE.parents[2] / "webshop-kalendarium-demok"
LOG = HERE / "log" / "atdolgoz.log"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
TEXT_EXT = {".js", ".mjs", ".css", ".html", ".json", ".md", ".py", ".svg"}


def log(msg):
    LOG.parent.mkdir(exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def run(cmd, cwd=None, timeout=900):
    log("RUN " + " ".join(map(str, cmd)))
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    log(f"EXIT {p.returncode}\n{p.stdout[-4000:]}\n{p.stderr[-4000:]}")
    return p


def used_ports():
    ports = set()
    for pj in DEMOS.glob("*/package.json"):
        ports.update(int(x) for x in re.findall(r"--port\s+(\d+)", pj.read_text("utf-8", "ignore")))
    return ports


def free(port):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pick_port():
    used = used_ports()
    for dev in range(5201, 5400):
        if dev not in used and dev - 1000 not in used and free(dev) and free(dev - 1000):
            return dev
    raise SystemExit("nincs szabad port 5201–5399 között")


def old_identity(src):
    terms = {src.name}
    pp = src / "data" / "products.json"
    if pp.exists():
        d = json.loads(pp.read_text("utf-8"))
        items = d.get("products", d) if isinstance(d, dict) else d
        for p in items[:3]:
            host = urllib.parse.urlsplit(str(p.get("url", ""))).hostname or ""
            host = host.removeprefix("www.")
            if host:
                terms.update({host, host.split(".")[0]})
    return {t for t in terms if len(t) >= 4}


def mark_old(new, src_name):
    names = [n for n in ("offers.json", "companions.json") if (new / "data" / n).exists()]
    if names:
        (new / "data" / "_REGI_BOLT").write_text(
            f"{src_name}: {', '.join(names)} még a régi boltra szól\n", "utf-8")
    return names


def fetch_logo(url, new):
    jout = HERE / "log" / f"atdolgoz-jelolt-{new.name}.json"
    p = run([sys.executable, "-I", str(HERE / "jelolt.py"), url, "--json", str(jout)], cwd=HERE, timeout=240)
    try:
        rec = json.loads(jout.read_text("utf-8"))[0]
    except Exception:  # noqa: BLE001
        return None, None
    logo = rec.get("logo")
    if not logo:
        return None, rec
    ext = (re.search(r"\.(svg|png|webp|jpe?g)(?:$|\?)", logo, re.I) or [None, "png"])[1].lower()
    dest = new / "public" / f"logo-{new.name}.{ext}"
    try:
        req = urllib.request.Request(logo, headers={"User-Agent": UA})
        dest.write_bytes(urllib.request.urlopen(req, timeout=25).read())
    except Exception as e:  # noqa: BLE001
        log(f"LOGO FAIL {logo} {e}")
        return None, rec
    return dest, rec


def leftovers(new, terms):
    hits = []
    pat = re.compile("|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True)), re.I)
    for f in new.rglob("*"):
        rel = f.relative_to(new)
        if rel.parts[0] in {"node_modules", "dist", "screenshots", "research"} or not f.is_file():
            continue
        if f.suffix.lower() not in TEXT_EXT or f.stat().st_size > 400_000:
            continue
        n = len(pat.findall(f.read_text("utf-8", "ignore")))
        if n:
            hits.append((n, str(rel)))
    return sorted(hits, reverse=True)


def main(argv):
    flags = {a for a in argv if a.startswith("--")}
    pos, kat, n = [], [], "24"
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--n":
            n = argv[i + 1]
            i += 2
            continue
        if a == "--kat":
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                kat.append(argv[i])
                i += 1
            continue
        if not a.startswith("--"):
            pos.append(a)
        i += 1
    if len(pos) != 3:
        print(__doc__.strip().splitlines()[2])
        return 2
    src, new, url = DEMOS / pos[0], DEMOS / pos[1], pos[2]
    if not src.is_dir():
        print(f"HIBA nincs forrásdemó: {src.name}")
        return 2
    if new.exists():
        print(f"HIBA már létezik: {new.name} (nem írom felül)")
        return 2
    log(f"=== {src.name} -> {new.name} {url}")
    excl = ["--exclude", "/dist", "--exclude", "/screenshots", "--exclude", "/research",
            "--exclude", "/public/products", "--exclude", "/node_modules", "--exclude", "__pycache__"]
    run(["rsync", "-a", *excl, f"{src}/", f"{new}/"])
    if (src / "node_modules").is_dir():
        run(["rsync", "-a", f"{src}/node_modules/", f"{new}/node_modules/"])
    for d in ("screenshots", "public/products"):
        (new / d).mkdir(parents=True, exist_ok=True)
    incomplete = []

    pj = new / "package.json"
    dev = pick_port()
    old_dev = None
    if pj.exists():
        t = pj.read_text("utf-8")
        m = re.search(r"vite(?: --host \S+)? --port (\d+) --strictPort", t)
        old_dev = m.group(1) if m else None
        t = re.sub(r'"name":\s*"[^"]*"', f'"name": "{new.name}-advent-local-demo"', t, count=1)
        t = re.sub(r"(vite(?: --host \S+)?)( --port )\d+( --strictPort)", rf"\g<1>\g<2>{dev}\g<3>", t)
        t = re.sub(r"(vite preview(?: --host \S+)?)( --port )\d+", rf"\g<1>\g<2>{dev - 1000}", t)
        pj.write_text(t, "utf-8")
    for f in (new / "scripts").glob("*.mjs"):
        t = f.read_text("utf-8")
        t2 = re.sub(r"(https?://127\.0\.0\.1:)\d{4}", rf"\g<1>{dev}", t)
        if old_dev:  # e.g. `const PORT=process.env.PORT||5290` – különben a forrásdemó futó szerverét fotózza
            t2 = re.sub(rf"(?<!\d){old_dev}(?!\d)", str(dev), t2)
        if t2 != t:
            f.write_text(t2, "utf-8")

    old_terms = old_identity(src)
    marked = mark_old(new, src.name)

    kat_line = "kihagyva"
    if "--nincs-katalogus" not in flags:
        cmd = [sys.executable, "-I", str(HERE / "katalogus.py"), url, "--out", str(new), "--n", n]
        if kat:
            cmd += ["--kat", *kat]
        if "--fresh" in flags:
            cmd.append("--fresh")
        p = run(cmd, cwd=HERE, timeout=1200)
        kat_line = (p.stdout.strip().splitlines() or ["(nincs kimenet)"])[-1][:140]
        if p.returncode != 0:
            incomplete.append("katalógus")

    logo, rec = fetch_logo(url, new)
    if not logo:
        incomplete.append("logó")
    plat = (rec or {}).get("platform") or "?"
    company = (rec or {}).get("company") or "?"

    hits = leftovers(new, old_terms)
    print(f"KÉSZ   {src.name} → {new.name} | port {dev}/{dev - 1000} | platform {plat} | cég {company}")
    print(f"   katalógus: {kat_line}")
    print(f"   logó: {logo.relative_to(new) if logo else 'NINCS – kézzel a bolt fejlécéből (05 modul)'}")
    if marked:
        print(f"   régi bolté, átírandó: data/{', data/'.join(marked)} (jelző: data/_REGI_BOLT)")
    print(f"   régi név/domain ({', '.join(sorted(old_terms))}) maradt {len(hits)} fájlban:")
    for cnt, rel in hits[:9]:
        print(f"     {cnt:>3} × {rel}")
    if len(hits) > 9:
        print(f"     … +{len(hits) - 9} fájl (napló: {LOG.relative_to(HERE.parents[1])})")
    log("HITS " + json.dumps(hits, ensure_ascii=False))
    return 1 if incomplete else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
