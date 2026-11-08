#!/usr/bin/env python3
"""ellenoriz.py – egy demó teljes gépi ellenőrzése egy futásban (stdlib only).

Usage: python3 ellenoriz.py <slug> [<slug> ...] [--egeszseg] [--nincs-capture] [--nincs-build]

Demónként sorban:
  1. ajanlat_ellenor.py (24 napos akciószabályok)
  2. npm test
  3. npm run build
  4. dev szerver SAJÁT szabad porton (127.0.0.1), <title> egyezés ellenőrzése,
     majd DEMO_URL=… npm run capture; utána a szervert leállítja
  5. kulcsképek: a capture alatt keletkezett reveal / deal / presenter-24 képek
Kimenet: demónként 1 MEGFELELT/HIBA sor + lépésenként 1 sor + legfeljebb 4
képútvonal (vision_analyze-hoz). Teljes kimenet: scripts/hajra/log/ellenoriz-<slug>.log.
Exit: 0 minden demó megfelelt, 1 valamelyik hibás, 2 hiányzó demó.
"""
import html
import re
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMOS = HERE.parents[2] / "webshop-kalendarium-demok"
LOGDIR = HERE / "log"
KEY_PATTERNS = [r"reveal.*(iphone-se|small|375)", r"(iphone-se|small|375).*reveal", r"4b-deal",
                r"presenter-day-24", r"reveal", r"desktop"]


class Log:
    def __init__(self, slug):
        LOGDIR.mkdir(exist_ok=True)
        self.path = LOGDIR / f"ellenoriz-{slug}.log"
        self.f = self.path.open("w", encoding="utf-8")
        self.f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {slug}\n")

    def run(self, name, cmd, cwd, env=None, timeout=900):
        self.f.write(f"\n===== {name}: {' '.join(cmd)}\n")
        self.f.flush()
        try:
            p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            self.f.write("TIMEOUT\n")
            return 124, "időtúllépés"
        out = (p.stdout or "") + (p.stderr or "")
        self.f.write(out[-20000:] + f"\nEXIT {p.returncode}\n")
        self.f.flush()
        return p.returncode, last_meaningful(out)


def last_meaningful(out):
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    for l in reversed(lines):
        if re.search(r"(?i)fail|error|hiba|✗|not ok|# fail", l):
            return l[:150]
    return (lines[-1] if lines else "")[:150]


def free_port():
    for port in range(5600, 5800):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("nincs szabad port")


def title_of(text):
    m = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
    return html.unescape(m.group(1).strip()) if m else ""


def wait_title(url, want, secs=40):
    end = time.time() + secs
    while time.time() < end:
        try:
            t = title_of(urllib.request.urlopen(url, timeout=3).read().decode("utf-8", "ignore"))
            if t:
                return t
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.7)
    return None


def key_images(demo, since):
    shots = [p for p in (demo / "screenshots").rglob("*.png") if p.stat().st_mtime >= since - 1]
    picked = []
    for pat in KEY_PATTERNS:
        for p in sorted(shots):
            if re.search(pat, p.name, re.I) and p not in picked:
                picked.append(p)
                break
        if len(picked) == 4:
            break
    return picked, len(shots)


def check(slug, opts):
    demo = DEMOS / slug
    if not (demo / "package.json").exists():
        print(f"HIBA     {slug}: nincs ilyen demó")
        return 2
    lg = Log(slug)
    steps, ok = [], True

    args = [sys.executable, "-I", str(HERE / "ajanlat_ellenor.py"), str(demo), "--quiet"]
    if opts["egeszseg"]:
        args.append("--egeszseg")
    rc, msg = lg.run("ajanlat", args, HERE)
    steps.append(("ajánlatok", rc == 0, msg))
    ok &= rc == 0

    rc, msg = lg.run("test", ["npm", "test", "--silent"], demo)
    steps.append(("unit", rc == 0, msg))
    ok &= rc == 0

    if not opts["nobuild"]:
        rc, msg = lg.run("build", ["npm", "run", "build", "--silent"], demo)
        steps.append(("build", rc == 0, msg))
        ok &= rc == 0

    images, nshots = [], 0
    if not opts["nocapture"]:
        want = title_of((demo / "index.html").read_text("utf-8", "ignore")) if (demo / "index.html").exists() else ""
        port = free_port()
        url = f"http://127.0.0.1:{port}/"
        lg.f.write(f"\n===== dev server {url}\n")
        srv = subprocess.Popen(["npx", "vite", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
                               cwd=demo, stdout=lg.f, stderr=subprocess.STDOUT)
        try:
            got = wait_title(url, want)
            if got is None:
                steps.append(("capture", False, "a dev szerver nem indult el"))
                ok = False
            elif want and got != want:
                steps.append(("capture", False, f"rossz demó a porton: {got[:60]}"))
                ok = False
            else:
                env = dict(**__import__("os").environ, DEMO_URL=url.rstrip("/"), PORT=str(port))  # PORT: a PORT-os capture.mjs-ekhez (pl. chili-család)
                t0 = time.time()
                has_npm = '"capture"' in (demo / "package.json").read_text("utf-8")
                cmd = (["npm", "run", "capture", "--silent"] if has_npm or not (demo / "scripts" / "capture.mjs").exists()
                       else ["node", "scripts/capture.mjs"])  # pl. szobanövény-család: nincs npm capture
                rc, msg = lg.run("capture", cmd, demo, env=env, timeout=1200)
                images, nshots = key_images(demo, t0)
                steps.append(("capture", rc == 0, f"{nshots} kép · {msg}" if rc else f"{nshots} kép"))
                ok &= rc == 0
        finally:
            srv.terminate()
            try:
                srv.wait(8)
            except subprocess.TimeoutExpired:
                srv.kill()

    print(f"{'MEGFELELT' if ok else 'HIBA    '} {slug}")
    for name, good, msg in steps:
        print(f"   {'✓' if good else '✗'} {name}: {msg if not good else (msg if name in ('ajánlatok', 'capture') else 'ok')}"[:170])
    for p in images:
        print(f"   kép: {p}")
    if not ok:
        print(f"   napló: {lg.path}")
    lg.f.close()
    return 0 if ok else 1


def main(argv):
    slugs = [a for a in argv if not a.startswith("--")]
    if not slugs:
        print(__doc__.strip().splitlines()[2])
        return 2
    opts = {"egeszseg": "--egeszseg" in argv, "nocapture": "--nincs-capture" in argv,
            "nobuild": "--nincs-build" in argv}
    return max(check(s, opts) for s in slugs)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
