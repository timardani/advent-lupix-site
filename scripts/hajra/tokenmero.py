"""Tokenmérés kalendáriumonként: a Claude Code munkamenet-átiratából (JSONL) összesíti a valós tokenhasználatot,
és egy sort ír a Moai Kalenderáium/TOKENMERES.csv-be.

Használat (az advent-lupix-site mappából):
  python3 scripts/hajra/tokenmero.py <demo-slug> [--kulcsszo szo] [--munka "átdolgozás"] [--megj "..."] [--dry]
A munkamenetet a legfrissebb olyan átirat adja, amelyben a kulcsszó (alapból a slug) szerepel.
Üzenetenként a message.id szerint dedupl. (a streamelt részüzenetek ugyanazt a usage-t ismétlik).
Csak stdlib; a kimenet 1–2 sor.
"""
import argparse, csv, json, sys
from datetime import date
from pathlib import Path

PROJ = Path("/Users/danieltimar/.claude/projects")
CSV = Path("/Users/danieltimar/Documents/tacitOS Projects/Moai Kalenderáium/TOKENMERES.csv")
JSON_OUT = Path(__file__).resolve().parents[2] / "vezerlo" / "tokenmeres.json"  # a vezérlő Tokenmérés oldala olvassa
FIELDS = ["datum", "demo", "munka", "modell", "kerdesek", "input", "cache_iras", "cache_olvasas", "output",
          "osszes", "uj_token", "munkamenet", "megjegyzes"]


def find_session(kw):
    cands = sorted(PROJ.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in cands[:40]:
        with p.open(encoding="utf-8", errors="ignore") as f:
            if kw.lower() in f.read().lower():
                return p
    return None


def summarize(path):
    seen, tot, models, turns = set(), dict(i=0, cw=0, cr=0, o=0), {}, 0
    for line in path.open(encoding="utf-8", errors="ignore"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        m = r.get("message") or {}
        if r.get("type") == "user" and isinstance(m.get("content"), str):
            turns += 1
        u = m.get("usage")
        if not u or r.get("type") != "assistant":
            continue
        key = m.get("id") or r.get("uuid")
        if key in seen:
            continue
        seen.add(key)
        tot["i"] += u.get("input_tokens", 0) or 0
        tot["cw"] += u.get("cache_creation_input_tokens", 0) or 0
        tot["cr"] += u.get("cache_read_input_tokens", 0) or 0
        tot["o"] += u.get("output_tokens", 0) or 0
        models[m.get("model", "?")] = models.get(m.get("model", "?"), 0) + 1
    return tot, max(models, key=models.get) if models else "?", turns, len(seen)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("demo"); ap.add_argument("--kulcsszo"); ap.add_argument("--munka", default="átdolgozás")
    ap.add_argument("--megj", default=""); ap.add_argument("--session"); ap.add_argument("--dry", action="store_true")
    ap.add_argument("--csak-json", action="store_true", help="csak a CSV -> tokenmeres.json tükrözés")
    a = ap.parse_args()
    if a.csak_json:
        return export_json()
    path = Path(a.session) if a.session else find_session(a.kulcsszo or a.demo)
    if not path:
        sys.exit(f"HIBA nincs átirat a(z) '{a.kulcsszo or a.demo}' kulcsszóval: {PROJ}")
    t, model, turns, calls = summarize(path)
    row = {"datum": date.today().isoformat(), "demo": a.demo, "munka": a.munka, "modell": model, "kerdesek": turns,
           "input": t["i"], "cache_iras": t["cw"], "cache_olvasas": t["cr"], "output": t["o"],
           "osszes": t["i"] + t["cw"] + t["cr"] + t["o"], "uj_token": t["i"] + t["cw"] + t["o"],
           "munkamenet": path.stem[:8], "megjegyzes": a.megj}
    print(f"{a.demo}: {calls} modellhívás | új token {row['uj_token']:,} (input {t['i']:,} + cache-írás {t['cw']:,} + output {t['o']:,}) | cache-olvasás {t['cr']:,} | {model}".replace(",", " "))
    if a.dry:
        return
    new = not CSV.exists()
    with CSV.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, delimiter=";")
        if new:
            w.writeheader()
        w.writerow(row)
    print(f"-> {CSV}")
    export_json()


def export_json():
    """A teljes CSV-t a vezerlo/tokenmeres.json-ba tükrözi (a következő push viszi ki)."""
    num = {"kerdesek", "input", "cache_iras", "cache_olvasas", "output", "osszes", "uj_token"}
    with CSV.open(encoding="utf-8") as f:
        rows = [{k: (int(v) if k in num and str(v).isdigit() else v) for k, v in r.items()} for r in csv.DictReader(f, delimiter=";")]
    JSON_OUT.write_text(json.dumps({"frissitve": date.today().isoformat(), "sorok": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {JSON_OUT.name} ({len(rows)} sor)")


if __name__ == "__main__":
    main()
