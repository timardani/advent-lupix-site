#!/usr/bin/env python3
"""A demók második körös akció/kupon auditja és frissítési ideje a vezérlőhöz."""
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMOS = ROOT.parent / "webshop-kalendarium-demok"
OUT = ROOT / "vezerlo" / "demo-audit.json"
SKIP = {"node_modules", "dist", "screenshots", ".git", "__pycache__"}
TEXT_EXT = {".js", ".css", ".html"}
REQUIRED_TYPES = {"kedvezmeny", "1plus1", "ajandek", "szallitas", "csomag"}


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


def normalized_offer(obj):
    day = obj.get("day", obj.get("nap"))
    kind = obj.get("type", obj.get("tipus"))
    code = obj.get("code", obj.get("kod"))
    conditions = obj.get("conditions", obj.get("feltetel"))
    if isinstance(day, int) and kind and code and conditions:
        return day, str(kind), str(code)
    return None


def audit_demo(path):
    sources = []
    text = []
    offers = set()
    for item in path.rglob("*"):
        if not item.is_file() or any(part in SKIP for part in item.parts):
            continue
        sources.append(item)
        try:
            if item.suffix.lower() in TEXT_EXT:
                text.append(item.read_text("utf-8"))
            elif item.suffix.lower() == ".json":
                data = json.loads(item.read_text("utf-8"))
                offers.update(x for obj in objects(data) if (x := normalized_offer(obj)))
        except (OSError, UnicodeError, json.JSONDecodeError):
            pass

    combined = "\n".join(text)
    days = {day for day, _, _ in offers}
    types = {kind for _, kind, _ in offers}
    codes = {code for _, _, code in offers}
    countdown = bool(re.search(r"secondsToMidnight|offerState|leftToday|remaining\s*\(|countdown\s*\(", combined, re.I))
    copy = bool(re.search(r"copyCode|clipboard|execCommand\s*\(", combined, re.I))
    visual = bool(re.search(r"\.stamp\b|\.deal\b|offer-badge|action-badge|deal-row|discount-badge|stakeLabel|pricing\s*\(|priceLine", combined, re.I))
    price = bool(re.search(r"priceLine|pricing\s*\(|originalPrice|line-through|text-decoration\s*:\s*line-through|<s>", combined, re.I))

    missing = []
    if days != set(range(1, 25)) or len(codes) != 24:
        missing.append("nincs 24 teljes napi akció és egyedi kupon")
    if not REQUIRED_TYPES.issubset(types):
        missing.append("nem szerepel mind az 5 akciótípus")
    if not countdown:
        missing.append("nincs éjféli visszaszámlálás/lejárat")
    if not copy:
        missing.append("nincs kuponmásolás")
    if not visual or not price:
        missing.append("nincs igazolt nagy, vizuális akció és ár")

    newest = max((p.stat().st_mtime for p in sources), default=path.stat().st_mtime)
    return {
        "frissitve": datetime.fromtimestamp(newest).astimezone().isoformat(timespec="minutes"),
        "demo2_kesz": not missing,
        "hianyok": missing,
    }


def main():
    result = {"generalva": datetime.now().astimezone().isoformat(timespec="seconds"), "demok": {}}
    for path in sorted(DEMOS.iterdir()):
        if path.is_dir() and not path.name.startswith("_"):
            result["demok"][path.name] = audit_demo(path)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")
    ready = sum(1 for d in result["demok"].values() if d["demo2_kesz"])
    print(f"Demo audit: {ready}/{len(result['demok'])} kész → {OUT}")


if __name__ == "__main__":
    main()
