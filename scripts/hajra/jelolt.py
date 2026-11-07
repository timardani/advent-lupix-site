#!/usr/bin/env python3
"""jelolt.py – gyors jelölt-kártya webshopokról (stdlib only).

Usage: python3 jelolt.py <url> [<url> ...] [--json out.json] [--fresh]

Per shop: homepage + max 3 legal/contact pages (impresszum/aszf/kapcsolat/
adatkezel) -> platform, cégnév, adószám, e-mail, telefon, hírlevél, logó;
termékszám (Shopify products.json / Woo X-WP-Total / sitemap); generated Meta
Ad Library link. One compact stdout line per shop, details in
scripts/hajra/log/jelolt.log. HTTP cached in scripts/hajra/cache/ (--fresh).
Exit: 0 all shops complete, 1 some data missing / shop failed, 2 all failed.
"""
import json
import re
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hajra_kozos as K  # noqa: E402

LEGAL_KEYS = ["impresszum", "aszf", "kapcsolat", "adatkezel"]
LEGAL_TEXT = {"impresszum": r"impresszum|imprint", "aszf": r"\b[áa]szf\b|általános szerződési|felhasználási feltétel|shop_help\.php\?tab=terms|terms",
              "kapcsolat": r"kapcsolat|contact", "adatkezel": r"adatkezel|adatvédel|privacy"}
TAX_RE = re.compile(r"(?<!\d)(\d{8}-\d-\d{2})(?!\d)")
SUFFIX = r"(?i:Kft|Zrt|Nyrt|Bt|Kkt)\.?|s\.\s?r\.\s?o\.|GmbH|Ltd\.?"
WORD = r"(?:[A-ZÁÉÍÓÖŐÚÜŰ0-9][\w&.'’+\-]*|és|and|&|-)"
COMPANY_RE = re.compile(r"((?:%s[ \t]+){0,6}?%s[ \t]+(?:%s))(?![\wáéíóöőúüű])" % (WORD, WORD, SUFFIX))
FOREIGN_TAX_RE = re.compile(r"(?:DIČ|VAT|közösségi adószám|EU adószám)\s*[:：]?\s*((?:HU|CZ|SK|AT|DE|RO)\s?\d{8,10})", re.I)
EV_RE = re.compile(r"([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:[ -][A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+){1,3})[\s,]*(?:e\.\s?v\.|egyéni vállalkozó|\bEV\b)")
LABEL_RE = re.compile(r"(?im)(?:cégnév|cég ?neve|szolgáltató(?: neve)?|üzemeltető(?: neve)?|vállalkozás neve|társaság neve|eladó(?: neve)?|webshop üzemeltetője)\s*[:：]\s*([^\n]{3,90})")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
INTL_RE = re.compile(r"\(?\+\s?(?:4\d{1,2}|3\d{1,2})\)?[\s\-]?\d{2,3}[\s\-]?\d{3}[\s\-]?\d{3,4}")
PHONE_RE = re.compile(r"(?<![\d-])(?:\+\s?36|06)[\s\-/.()]*(?:1|\d{2})[\s\-/.()]*\d{3}[\s\-.]*\d{3,4}(?!\d)")
NEWS = [("klaviyo", r"klaviyo"), ("mailerlite", r"mailerlite"), ("mailchimp", r"mailchimp|list-manage\.com"),
        ("brevo", r"sendinblue|brevo\.com|sibforms"), ("omnisend", r"omnisend"), ("form", r"hírlevél|hirlevel|feliratkoz|newsletter")]
BAD_MAIL = r"example\.|sentry|wixpress|\.(png|jpe?g|gif|webp|svg)$|@\dx|domain\.|email\.com$|yourmail|u003e"


def legal_links(base, t):
    found = {}
    for m in re.finditer(r'(?is)<a\b[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', t):
        href, label = m.group(1), K.clean(m.group(2)).lower()
        u = K.absu(base, href)
        if K.domain(u) != K.domain(base) or re.search(r"\.(pdf|jpe?g|png)$", u, re.I):
            continue
        hay = href.lower() + " " + label
        for key in LEGAL_KEYS:
            if key not in found and re.search(LEGAL_TEXT[key], hay, re.I):
                found[key] = u
    return list(dict.fromkeys(found[k] for k in LEGAL_KEYS if k in found))


def company(txt):
    c = _company(txt)
    if c and re.search(r"(?i)(kft|zrt|nyrt|bt|kkt)$", c):
        c += "."
    return c


THIRD = re.compile(r"(?i)otp mobil|barion|unas online|shoprenter|biokontroll|simplepay|\bgls\b|foxpost|magyar posta|packeta|\bmpl\b|\bdpd\b|express one|sprinter|stripe|paypal|nemzeti|hatóság|kormányhivatal|naih|nmhh|hostinger|rackforest|tárhely|webonic|szamlazz|billingo|kbos|nébih|google|meta platforms|facebook|mailchimp|mailerlite|cib bank|otp bank|k&h|erste|raiffeisen|unicredit|magnet bank|gránit|webshippy|sameday|innvoice|wix|automattic|woocommerce|szerencsejáték|netrisk|bkik|kereskedelmi és iparkamara|iparkamara|békéltető")


def _company(txt):
    c = _company0(txt)
    return c


def _company0(txt):
    for m in LABEL_RE.finditer(txt):
        v = m.group(1).strip(" .,;")
        c = COMPANY_RE.search(v) or EV_RE.search(v)
        if c and not THIRD.search(c.group(0)):
            return c.group(0).strip()
    hits = [re.sub(r"\s+", " ", m.group(1)).strip() for m in COMPANY_RE.finditer(txt)]
    hits = [h for h in hits if not THIRD.search(h)]
    hits = [h for h in hits if not re.match(r"(?i)(a|az|the|és)\s", h) and len(h) < 80]
    hits = [re.sub(r"^(?:Az?|Copyright|©)\s+", "", h) for h in hits]
    if hits:
        c = Counter(hits)
        return max(c, key=lambda h: (c[h], -hits.index(h)))
    m = EV_RE.search(txt)
    return m.group(0).strip() if m else None


def tax_near(txt, comp):
    """Adószám a cégnévhez legközelebb (utána, 400 karakteren belül); különben a nem harmadik féltől származó leggyakoribb."""
    taxes = [(m.start(), m.group(0)) for m in TAX_RE.finditer(txt)]
    if not taxes:
        return None
    if comp:
        key = comp.split()[0]
        for cm in re.finditer(re.escape(key), txt):
            near = [t for pos, t in taxes if 0 <= pos - cm.start() <= 400]
            if near:
                return near[0]
    good = [t for pos, t in taxes if not THIRD.search(txt[max(0, pos - 250):pos])]
    return Counter(good).most_common(1)[0][0] if good else None


def norm_phone(p):
    d = re.sub(r"\D", "", p)
    if d.startswith("06"):
        d = "36" + d[2:]
    if not d.startswith("36") or len(d) not in (10, 11):
        return None
    rest = d[2:]
    a = rest[:1] if rest.startswith("1") else rest[:2]
    r = rest[len(a):]
    return f"+36 {a} {r[:3]} {r[3:]}"


def emails(t, dom):
    cand = [K.clean(urllib.parse.unquote(x)).split("?")[0] for x in re.findall(r'mailto:([^"\'>\s]+)', t, re.I)]
    cand += EMAIL_RE.findall(K.text(t))
    cand = [c.strip(".").lower() for c in cand if not re.search(BAD_MAIL, c, re.I)
            and not re.search(r"(?i)gov\.hu|naih|nmhh|bekeltet|iparkamara|kamara\.hu|nebih|barion|otpmobil|simplepay|unas\.hu|shoprenter", c)]
    cand = list(dict.fromkeys(cand))
    cand = [c for c in cand if "@" in c]
    own = [c for c in cand if dom.split(".")[0] in c.split("@")[1]]
    return (own or cand)[:2]


def phones(t):
    cand = [urllib.parse.unquote(x) for x in re.findall(r'tel:([^"\'>]+)', t, re.I)]
    cand += PHONE_RE.findall(K.text(t))
    out = []
    for c in cand:
        n = norm_phone(c)
        if n and n not in out:
            out.append(n)
    if not out:
        out = list(dict.fromkeys(re.sub(r"[()]", "", x).strip() for x in INTL_RE.findall(K.text(t))))
    return out[:2]


def logo(base, t):
    imgs = []
    for m in re.finditer(r"(?is)<img\b[^>]*>", t):
        tag = m.group(0)
        if not re.search(r"logo", tag, re.I) or re.search(r"(?i)logo_unas|unas_dark|checkout|gopay|barion|simplepay|payment|szallit|gls|foxpost|otp", tag):
            continue
        src = None
        for attr in ("data-src", "data-lazy-src", "data-original", "src"):
            s = re.search(r'\b%s=["\']([^"\']+)["\']' % attr, tag)
            if s and not s.group(1).startswith("data:"):
                src = s.group(1)
                break
        if src:
            score = (2 if re.search(r"\.svg", src, re.I) else 1 if re.search(r"\.png", src, re.I) else 0)
            score += 1 if re.search(r"logo", src, re.I) else 0
            imgs.append((-score, len(imgs), K.absu(base, src)))
    if imgs:
        return sorted(imgs)[0][2]
    og = K.meta(t, "og:image")
    if og:
        return K.absu(base, og)
    for rel in ("apple-touch-icon", "icon", "shortcut icon"):
        m = re.search(r'<link[^>]+rel=["\']%s["\'][^>]*href=["\']([^"\']+)' % rel, t, re.I) or \
            re.search(r'<link[^>]+href=["\']([^"\']+)["\'][^>]*rel=["\']%s["\']' % rel, t, re.I)
        if m:
            return K.absu(base, m.group(1))
    return None


def newsletter(t):
    low = t.lower()
    for name, pat in NEWS:
        if re.search(pat, low):
            return name
    return None


def count_products(base, platform, fresh):
    if platform == "Shopify":
        n = 0
        for page in range(1, 5):
            r = K.fetch(f"{base}/products.json?limit=250&page={page}", fresh, accept="application/json")
            d = r.json() if r.ok else None
            if not d or "products" not in d:
                if n:
                    return str(n), "products.json"
                break  # 429 / blocked -> sitemap below
            n += len(d["products"])
            if len(d["products"]) < 250:
                return str(n), "products.json"
        else:
            return f"{n}+", "products.json"
    if platform in ("WooCommerce", "WordPress"):
        r = K.fetch(f"{base}/wp-json/wc/store/v1/products?per_page=1", fresh, accept="application/json")
        tot = r.header("X-WP-Total") if r.ok else None
        if tot:
            return tot, "wc-store-api"
    entries, complete = K.sitemap_entries(base, fresh, max_fetch=5)
    prods = K.product_entries(entries, platform)
    if prods:
        return f"~{len(prods)}" + ("" if complete else "+"), "sitemap"
    return "unknown", "-"


def meta_link(dom):
    q = dom.rsplit(".", 1)[0] if "." in dom else dom
    return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=HU&q="
            f"{urllib.parse.quote(q)}&search_type=keyword_unordered")


def shop(url, fresh):
    base = K.norm_base(url)
    rec = {"input": url, "domain": K.domain(base), "ok": False}
    r = K.fetch(base + "/", fresh)
    if not r.ok:
        rec["error"] = f"homepage HTTP {r.status}"
        return rec
    base = K.norm_base(r.url)
    rec.update(base=base, ok=True)
    t = r.text
    rec["platform"] = K.detect_platform(r)
    pages, used = [t], []
    txt = K.text(t)
    for u in legal_links(base, t)[:3]:
        if TAX_RE.search(txt) and company(txt) and emails("\n".join(pages), rec["domain"]) and phones("\n".join(pages)):
            break
        p = K.fetch(u, fresh)
        used.append(f"{p.status} {u}")
        if p.ok:
            pages.append(p.text)
            txt += "\n" + K.text(p.text)
    allh = "\n".join(pages)
    comp = company(txt)
    tax = tax_near(txt, comp)
    if not tax:
        ft = [re.sub(r"\s", "", x) for x in FOREIGN_TAX_RE.findall(txt)]
        tax = Counter(ft).most_common(1)[0][0] if ft else None
    rec.update(
        company=comp, tax_id=tax,
        emails=emails(allh, rec["domain"]), phones=phones(allh), newsletter=newsletter(t),
        logo=logo(base, t), legal_pages=used, meta_ad_library=meta_link(rec["domain"]))
    rec["email"] = rec["emails"][0] if rec["emails"] else None
    rec["phone"] = rec["phones"][0] if rec["phones"] else None
    rec["products"], rec["products_source"] = count_products(base, rec["platform"], fresh)
    return rec


def line(r):
    if not r.get("ok"):
        return f"{r['domain']} | HIBA: {r.get('error')}"
    cg = r["company"] or "?cég"
    return " | ".join([
        r["domain"], r["platform"], f"{cg} {r['tax_id'] or '?adószám'}", r["email"] or "?email",
        r["phone"] or "?tel", f"hírlevél:{r['newsletter'] or 'nem'}",
        f"termék:{r['products']}", f"logó:{'✓' if r['logo'] else '-'}"])


def main(argv):
    fresh = "--fresh" in argv
    argv = [a for a in argv if a != "--fresh"]
    jout = None
    if "--json" in argv:
        i = argv.index("--json")
        if i + 1 >= len(argv):
            print("usage: jelolt.py <url> [<url> ...] [--json out.json] [--fresh]")
            return 2
        jout = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    urls = [a for a in argv if not a.startswith("--")]
    if not urls:
        print("usage: jelolt.py <url> [<url> ...] [--json out.json] [--fresh]")
        return 2
    K.set_log("jelolt")
    recs = []
    for u in urls:
        try:
            rec = shop(u, fresh)
        except Exception as e:  # noqa: BLE001
            rec = {"input": u, "domain": K.domain(u), "ok": False, "error": f"{type(e).__name__}: {e}"}
        recs.append(rec)
        K.log("REC", json.dumps(rec, ensure_ascii=False))
        print(line(rec), flush=True)
    if jout:
        Path(jout).write_text(json.dumps(recs, ensure_ascii=False, indent=1))
    bad = [r for r in recs if not r.get("ok")]
    gaps = [r for r in recs if r.get("ok") and not (r["company"] and r["tax_id"] and r["email"])]
    s = K.STATS
    print(f"-- {len(recs) - len(bad)}/{len(recs)} shop ok, {len(gaps)} hiányos | http live {s['live']} cache {s['cache']} | log: {K.LOG.path}")
    if len(bad) == len(recs):
        return 2
    return 1 if bad or gaps else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
