#!/usr/bin/env python3
"""advent.lupix.hu – kiadó szkript.

A kiadas.json-ban felsorolt demók kész buildjét bemásolja a site/<titkos-slug>/
mappába, és a gyökérhivatkozásokat (/assets, /products, /favicon.svg …)
/<slug>/… alakra írja át, hogy egy domainen, alkönyvtárból működjenek.
A demók forrásához nem nyúl (legfeljebb `npm run build`, ha a build régebbi).

Használat:
  python3 kiad.py                 # kiadás a kiadas.json alapján
  python3 kiad.py --uj fonalam    # új titkos slug a demóhoz (felveszi a kiadas.json-ba)
  python3 kiad.py --le fonalam    # demó levétele (kikerül a kiadas.json-ból)
Utána: git add -A && git commit && git push, majd Coolify → Redeploy.
"""
import json, re, secrets, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEMOS = ROOT.parent / "webshop-kalendarium-demok"
SITE = ROOT / "site"
CONF = ROOT / "kiadas.json"
DOMAIN = "https://advent.lupix.hu"
TEXT_EXT = {".html", ".js", ".css", ".json", ".svg", ".webmanifest"}
STATIC_KEEP = {"index.html", "app.js", "style.css", "fonts.css", "fonts", "assets",
               "favicon.svg", "products-data.js"}  # statikus (nem Vite) demóknál
SRC_DIRS = ("src", "data", "public", "index.html")


def load():
    return json.loads(CONF.read_text("utf-8")) if CONF.exists() else {"demok": []}


def save(conf):
    CONF.write_text(json.dumps(conf, ensure_ascii=False, indent=2) + "\n", "utf-8")


def newest(paths):
    t = 0
    for p in paths:
        if p.is_file():
            t = max(t, p.stat().st_mtime)
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.is_file() and "node_modules" not in f.parts:
                    t = max(t, f.stat().st_mtime)
    return t


def ensure_build(demo: Path):
    dist = demo / "dist"
    if not (demo / "package.json").exists():
        return None  # statikus demó
    if not dist.exists() or newest([demo / s for s in SRC_DIRS]) > newest([dist]):
        print(f"  build: {demo.name} (a build hiányzik vagy régebbi a forrásnál)")
        subprocess.run(["npm", "run", "build"], cwd=demo, check=True,
                       stdout=subprocess.DEVNULL)
    return dist


def rewrite(out: Path, slug: str):
    idx = (out / "index.html").read_text("utf-8")
    if 'src="./' in idx or "src='./" in idx:
        return 0  # relatív (base './') build: magától működik alkönyvtárból
    entries = sorted((p.name for p in out.iterdir()), key=len, reverse=True)
    names = "|".join(re.escape(e) for e in entries if e != "index.html")
    # csak idézőjel/zárójel/egyenlőség/szóköz/vessző utáni, gyökérrel kezdődő hivatkozás
    rx = re.compile(r'(?<=[\"\'`(=\s,])/(?=(?:%s)(?:[/\"\'`)?#\s]|$))' % names)
    n = 0
    for f in out.rglob("*"):
        if f.suffix.lower() not in TEXT_EXT or not f.is_file():
            continue
        s = f.read_text("utf-8", errors="surrogateescape")
        s2, k = rx.subn(f"/{slug}/", s)
        if f.name == "index.html" and f.parent == out:
            # OG-kép teljes URL-lel (link-előnézethez)
            s2 = re.sub(r'(property="og:image"\s+content=")/', rf'\1{DOMAIN}/', s2)
            if 'name="robots"' not in s2:
                s2 = s2.replace("<head>", '<head>\n<meta name="robots" content="noindex,nofollow,noarchive">', 1)
        if s2 != s:
            f.write_text(s2, "utf-8", errors="surrogateescape")
            n += k
    return n


def publish():
    subprocess.run([sys.executable, ROOT / "scripts" / "demo-audit.py"], check=True)
    conf = load()
    keep = {"index.html", "robots.txt", "404.html"}
    for p in SITE.iterdir():  # régi kiadások törlése a site/-ból (git-ben visszakereshető)
        if p.name not in keep:
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    for d in conf["demok"]:
        demo = DEMOS / d["demo"]
        out = SITE / d["slug"]
        dist = ensure_build(demo)
        if dist:
            shutil.copytree(dist, out)
        else:
            out.mkdir()
            for name in STATIC_KEEP:
                src = demo / name
                if src.is_dir():
                    shutil.copytree(src, out / name)
                elif src.exists():
                    shutil.copy2(src, out / name)
        n = rewrite(out, d["slug"])
        print(f"  ✓ {d['demo']:<16} {DOMAIN}/{d['slug']}/?bemutato=1   ({n} hivatkozás átírva)")
    print(f"Kész: {len(conf['demok'])} demó a site/ mappában.")


def main():
    args = sys.argv[1:]
    conf = load()
    if args[:1] == ["--uj"] and len(args) == 2:
        name = args[1]
        if not (DEMOS / name).is_dir():
            sys.exit(f"Nincs ilyen demó: {name}")
        if any(d["demo"] == name for d in conf["demok"]):
            sys.exit(f"{name} már kint van.")
        conf["demok"].append({"demo": name, "slug": f"{name}-{secrets.token_hex(3)}"})
        save(conf)
    elif args[:1] == ["--le"] and len(args) == 2:
        conf["demok"] = [d for d in conf["demok"] if d["demo"] != args[1]]
        save(conf)
    elif args:
        sys.exit(__doc__)
    publish()


if __name__ == "__main__":
    main()
