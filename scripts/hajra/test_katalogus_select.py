"""Regressziós teszt a katalogus.select() családszűrőjére (futtatás: python3 -I scripts/hajra/test_katalogus_select.py).

Eset: kis bolt 28 rendelhető termékkel, ahol a nevek fele közös „család”-előtagú
(„Chili szósz - …”). A régi szűrő családonként 1 terméket engedett, így 12 maradt.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import katalogus as KT  # noqa: E402


def c(i, name, cat):
    return {"url": f"https://bolt.hu/p{i}", "name": name, "category": cat,
            "image_url": f"https://bolt.hu/img/{i}.jpg", "price": 2000 + i,
            "available": True, "verified": True}


def kis_bolt():
    out, i = [], 0
    for fam, cat, k in (("Chili szósz", "Szószok", 9), ("Chili por", "Fűszerek", 6),
                        ("Chili paszta", "Paszták", 5)):
        for j in range(k):
            i += 1
            out.append(c(i, f"{fam} - ízváltozat {j}", cat))
    for j in range(8):  # egyedi nevű termékek
        i += 1
        out.append(c(i, f"Egyedi{j} termék", "Ajándék"))
    return out


def test_kis_bolt_eleg_termek():
    cands = kis_bolt()
    assert len(cands) == 28
    ranked = KT.select(cands, 24)
    assert len(ranked) == 28, len(ranked)  # mind bekerül (24 + tartalék), nem csak 12
    # a változatos (családonként első) termékek maradnak elöl
    first = [r["name"] for r in ranked[:11]]
    assert sum(n.startswith("Chili szósz") for n in first) == 1, first


def test_azonos_kep_tovabbra_is_kiesik():
    cands = kis_bolt()
    cands[1]["image_url"] = cands[0]["image_url"]
    ranked = KT.select(cands, 24)
    assert len(ranked) == 27
    assert cands[1] not in ranked


def test_nagy_bolt_valtozatlan():
    cands = [c(i, f"Termék{i} egyedi", f"Kat{i % 6}") for i in range(80)]
    cands += [c(100 + i, f"Termék{i} egyedi - másik", "Kat0") for i in range(5)]
    ranked = KT.select(cands, 24)
    assert len(ranked) == 24 + 3 * KT.SPARES
    assert all(r["url"].rsplit("p", 1)[-1].isdigit() and int(r["url"].rsplit("p", 1)[-1]) < 100 for r in ranked)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
