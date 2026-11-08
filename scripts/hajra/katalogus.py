#!/usr/bin/env python3
"""katalogus.py – 24 (n) rendelhető, változatos termék egy webshopból (stdlib only).

Usage: python3 katalogus.py <url> --out <demo_dir> [--n 24] [--kat <substr> ...] [--min-ar Ft] [--fresh]
       (felnőtt/erotikus/ivós termék sosem kerül be: NOT_ADVENT)

One central fetcher (hajra_kozos.fetch, disk cache) + platform adapters:
  Shopify      /products.json?limit=250&page=N
  WooCommerce  /wp-json/wc/store/v1/products?per_page=100&page=N
  ShopRenter / Unas / egyéb   category listing HTML (category + product URLs
               from the sitemap) -> product cards; product pages (JSON-LD,
               microdata, ShopRenter.product, Unas cart button) are fetched
               only for the chosen n + 4 spares. Fallback: sitemap product URLs.
Selection: available + image + price; per-category round robin (2-5 each),
no duplicate images (URL + sha1), no near-duplicate names (first 2 words).
Writes <demo_dir>/data/termekek.json, <demo_dir>/data/products.json (demo
schema) and <demo_dir>/public/products/<id>.<ext> (existing files kept).
Exit: 0 = n/n with image, 1 = partial, 2 = failure. Log: log/katalogus.log
"""
import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.parse
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hajra_kozos as K  # noqa: E402

MAX_LISTINGS = 25
MAX_CANDIDATES = 120
SPARES = 4
PER_CAT_MIN, PER_CAT_MAX = 2, 5
OUT_WORDS = r"elfogyott|utánpótlás|nincs készleten|nincs raktáron|nem rendelhető|out of stock|sold out|átmenetileg nem|előrendel"
PRICE_RE = re.compile(r"(?<![\d.,])(\d{1,3}(?:[ .  ]\d{3})+|\d{2,7})(?:,\d{1,2})?\s*(?:Ft|HUF|,-)(?![a-zA-Z])")
WARN = []


def warn(msg):
    WARN.append(msg)
    K.log("WARN", msg)


def slug(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"[^a-z0-9]+", "-", "".join(c for c in s if not unicodedata.combining(c))).strip("-")


def name_key(n):
    w = re.findall(r"[0-9a-z]+", slug(n).replace("-", " "))
    return " ".join(w[:2])


def nurl(u):
    p = urllib.parse.urlsplit(u)
    return urllib.parse.urlunsplit((p.scheme, p.netloc.lower(), p.path.rstrip("/") or "/", "", ""))


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = re.sub(r"[^\d.,]", "", str(s))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if len(s.split(",")[-1]) <= 2 else s.replace(",", "")
    elif s.count(".") > 1 or re.search(r"\.\d{3}$", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def is_placeholder(u):
    # helyorzo/helyőrző: magyar helyőrző képnév (popovicsmez: vad-voros-afonya-helyorzo.jpg)
    return not u or bool(re.search(r"no_image|placeholder|noimage|nopic|default-image|helyorzo|helyőrző|data:image", u, re.I))


# ---------------- adapters ----------------
def shopify(base, home, fresh, kat):
    cur = re.search(r'Shopify\.currency\s*=\s*\{"active":"(\w+)"', home.text)
    cur = cur.group(1) if cur else (K.meta(home.text, "og:price:currency") or "HUF")
    out = []
    for page in range(1, MAX_LISTINGS + 1):
        r = K.fetch(f"{base}/products.json?limit=250&page={page}", fresh, accept="application/json")
        d = r.json() if r.ok else None
        if not d or not d.get("products"):
            if page == 1:
                warn(f"products.json HTTP {r.status} -> sitemap + /products/<handle>.js")
                return shopify_sitemap(base, fresh, cur)
            break
        for p in d["products"]:
            av = [v for v in p.get("variants", []) if v.get("available")]
            prices = [num(v.get("price")) for v in av if num(v.get("price"))]
            img = (p.get("images") or [{}])[0].get("src")
            if is_placeholder(img):
                img = None
            if img:
                img += ("&" if "?" in img else "?") + "width=900"
            out.append(dict(
                id=str(p["id"]), name=html.unescape(p.get("title", "")).strip(),
                price=min(prices) if prices else None, currency=cur, available=bool(av),
                url=f"{base}/products/{p.get('handle')}", image_url=img,
                category=(p.get("product_type") or (p.get("tags") or ["egyéb"])[0] or "egyéb").strip(),
                description=K.clean(p.get("body_html"))[:600], verified=True))
        if len(d["products"]) < 250:
            break
    return out, f"{base}/products.json"


def shopify_sitemap(base, fresh, cur):
    entries, _ = K.sitemap_entries(base, fresh, max_fetch=4)
    prods = [e for e in K.product_entries(entries, "Shopify") if "/products/" in e["loc"]]
    k = NEED + SPARES * 3
    step = max(1, len(prods) // k)
    out = []
    for e in prods[::step][:k]:
        out.append(dict(id=None, name=e.get("image_title") or "", price=None, currency=cur, available=None,
                        url=e["loc"], image_url=e.get("image_loc"), category=None, description="",
                        verified=False, sitemap_only=True))
    return out, f"{base}/sitemap.xml (+ .js)"


def shopify_js(c, fresh):
    r = K.fetch(c["url"].split("?")[0] + ".js", fresh, accept="application/json")
    d = r.json() if r.ok else None
    if not isinstance(d, dict):
        K.log("shopify .js", r.status, c["url"])
        return None
    av = [v for v in d.get("variants", []) if v.get("available")]
    prices = [v["price"] / 100 for v in av if v.get("price")]
    img = d.get("featured_image") or (d.get("images") or [None])[0]
    if img and img.startswith("//"):
        img = "https:" + img
    if img:
        img += ("&" if "?" in img else "?") + "width=900"
    return dict(c, id=str(d.get("id")), name=K.clean(d.get("title")), price=min(prices) if prices else None,
                available=bool(av), image_url=img, category=(d.get("type") or "egyéb").strip() or "egyéb",
                description=K.clean(d.get("description"))[:600], verified=True)


def woo_img(im):
    best, src = None, im.get("src")
    for part in (im.get("srcset") or "").split(","):
        bits = part.strip().split()
        if len(bits) == 2 and bits[1].endswith("w"):
            w = int(bits[1][:-1])
            if w >= 700 and (best is None or w < best[0]):
                best = (w, bits[0])
    return best[1] if best else src


def woo(base, home, fresh, kat):
    raw, page, pages = [], 1, 1
    while page <= min(pages, MAX_LISTINGS):
        r = K.fetch(f"{base}/wp-json/wc/store/v1/products?per_page=100&page={page}", fresh, accept="application/json")
        d = r.json() if r.ok else None
        if not isinstance(d, list):
            warn(f"Woo Store API HTTP {r.status} page {page}")
            break
        raw += d
        pages = int(r.header("X-WP-TotalPages") or 1)
        page += 1
    freq = {}
    for p in raw:
        for c in p.get("categories", []):
            freq[c["name"]] = freq.get(c["name"], 0) + 1
    out = []
    for p in raw:
        pr = p.get("prices") or {}
        price = num(pr.get("price"))
        if price is not None:
            price = price / 10 ** int(pr.get("currency_minor_unit") or 0)
        cats = [html.unescape(c["name"]) for c in p.get("categories", []) if c.get("slug") not in ("uncategorized", "egyeb")]
        cat = min(cats, key=lambda c: (freq.get(c, 0), cats.index(c))) if cats else "egyéb"  # most specific
        img = woo_img(p["images"][0]) if p.get("images") else None
        out.append(dict(
            id=str(p["id"]), name=K.clean(p.get("name")), price=price, currency=pr.get("currency_code") or "HUF",
            available=bool(p.get("is_in_stock") and p.get("is_purchasable", True)), url=p.get("permalink"),
            image_url=img, category=cat,
            description=(K.clean(p.get("short_description")) or K.clean(p.get("description")))[:600], verified=True))
    return out, f"{base}/wp-json/wc/store/v1/products?per_page=100"


def listing_name(t):
    bc = K.jsonld(t, "BreadcrumbList").get("itemListElement") or []
    names = [(i.get("name") or (i.get("item") or {}).get("name") if isinstance(i.get("item"), dict) else i.get("name"))
             for i in bc if isinstance(i, dict)]
    names = [n for n in names if n]
    if names:
        return html.unescape(names[-1]).strip()
    h1 = re.search(r"(?is)<h1[^>]*>(.*?)</h1>", t)
    if h1 and K.clean(h1.group(1)):
        return K.clean(h1.group(1))[:60]
    ti = re.search(r"(?is)<title>(.*?)</title>", t)
    return re.split(r"\s[-|–]\s", K.clean(ti.group(1)) if ti else "egyéb")[0][:60] or "egyéb"


def cards(base, t, prodset, cat):
    """Product cards from a listing page = windows around product hrefs."""
    names = {}
    for it in K.jsonld(t, "ItemList").get("itemListElement") or []:
        if isinstance(it, dict) and it.get("url"):
            names[nurl(K.absu(base, it["url"]))] = it.get("name")
    pos = OrderedDict()
    slugs = {u.rsplit("/", 1)[-1] for u in prodset}
    for m in re.finditer(r'href=["\']([^"\'#]+)["\']', t):
        u = nurl(K.absu(base, m.group(1)))
        if K.domain(u) != K.domain(base):
            continue
        if (u in prodset or u.rsplit("/", 1)[-1] in slugs) if prodset else re.search(K.PRODUCT_URL_RE, u):
            pos.setdefault(u, []).append((m.start(), m.end()))
    pos = {u: [p for p in ps if p[0] >= ps[-1][0] - 4000] for u, ps in pos.items()}  # last cluster only
    items = sorted(pos.items(), key=lambda kv: kv[1][0][0])
    out = []
    for i, (u, ps) in enumerate(items):
        lo = max(ps[0][0] - 1500, items[i - 1][1][-1][1] if i else 0)
        hi = min(ps[-1][1] + 2500, items[i + 1][1][0][0] if i + 1 < len(items) else len(t))
        w = t[lo:hi]
        name = names.get(u)
        if not name:
            texts = []
            for m in re.finditer(r'(?is)<a\b[^>]*href=["\']([^"\']*)["\'][^>]*>(.*?)</a>', w):
                c = K.clean(m.group(2))
                if nurl(K.absu(base, m.group(1))) == u and 3 <= len(c) <= 150 and re.search(r"[^\W\d_]{3}", c) \
                        and not PRICE_RE.search(c) and not re.search(r"(?i)kosár|részletek|tovább|megnézem|%", c):
                    texts.append(c)
            name = max(texts, key=len) if texts else None
        imgs = []
        for m in re.finditer(r"(?is)<img\b[^>]*>", w):
            tag = m.group(0)
            if re.search(r"(?i)badge|icon|logo|flag|rating|star", tag):
                continue
            for attr in ("data-src", "data-lazy-src", "data-original", "data-srcset", "srcset", "src"):
                s = re.search(r'\b%s=["\']([^"\'\s]+)' % attr, tag)
                if s and not is_placeholder(s.group(1)) and not s.group(1).endswith(".svg"):
                    alt = re.search(r'\balt=["\']([^"\']{3,150})["\']', tag)
                    imgs.append((0 if re.search(r"(?i)product|/img/|termek", s.group(1)) else 1, len(imgs),
                                 K.absu(base, s.group(1)), html.unescape(alt.group(1)) if alt else None))
                    break
        imgs.sort()
        img = imgs[0][2] if imgs else None
        if not name and imgs:
            name = imgs[0][3]
        dp = re.search(r'data-price(?:-without-currency)?=["\']([\d.,]+)', w)
        prices = [num(x) for x in PRICE_RE.findall(K.text(w))]
        prices = [p for p in prices if p and p >= 50]
        price = num(dp.group(1)) if dp else (min(prices) if prices else None)
        st = re.search(r'(?is)class=["\'][^"\']*stock[^"\']*["\'][^>]*>(.*?)</(?:div|span|p)>', w)
        st = K.clean(st.group(1)).lower() if st else ""
        if st:
            avail = bool(re.search(r"raktáron|készleten|in stock|azonnal|szállítható|elérhető|rendelhető", st)) \
                and not re.search(OUT_WORDS + r"|nincs", st)
        else:
            avail = not re.search(OUT_WORDS, K.text(w).lower())
        out.append(dict(id=None, name=(name or "").strip(), price=price, currency="HUF",
                        available=avail, url=u, image_url=img,
                        category=cat, description="", verified=False))
    return out


WANT_SLUGS = []  # --ids: a sitemap-tartalékban ezek az URL-slugok elsőbbséget kapnak


def groups_key(u, segs):
    s = segs(u)
    return s[-2] if len(s) >= 3 else None


def html_shop(base, home, fresh, kat, platform):
    entries, _ = K.sitemap_entries(base, fresh, max_fetch=6)
    prods = K.product_entries(entries, platform)
    prodset = {nurl(e["loc"]) for e in prods}
    root = nurl(base)
    skip = r"(?i)index\.php|shop_|/blog|aszf|adatv|adatkez|impresszum|kapcsolat|contact|information|cart|kosar|login|fiok|account|hirek|news|\?"
    cats = [e for e in entries if nurl(e["loc"]) not in prodset and nurl(e["loc"]) != root and not re.search(skip, e["loc"])]
    if platform in ("ShopRenter", "Unas"):
        cats = [e for e in cats if e["priority"] == "0.8"] or cats
    article = r"(?i)-[parn]\d+\.htm$|/blog|/hir|/recept|/cikk|/article|/post|/szallitas|/rolunk|/karrier|/gyik|/faq"
    cats = [e for e in cats if not re.search(article, e["loc"])] or cats
    cat_hint = r"(?i)/s\d+\.htm$|/kategori|/category|/collections/|/c/\d+|-c\d+$"
    cat_urls = list(dict.fromkeys(nurl(e["loc"]) for e in cats))
    cat_set = set(cat_urls)
    brand = r"(?i)[-_]m[-_]?\d+$|/manufacturer|/gyarto|/marka|/brand"
    depth = lambda u: urllib.parse.urlsplit(u).path.rstrip("/").count("/")  # noqa: E731
    homelinks = list(dict.fromkeys(nurl(K.absu(base, h)) for h in re.findall(r'href=["\']([^"\'#]+)["\']', home.text)))
    inhome = [u for u in homelinks if u in cat_set and not re.search(brand, u)]
    if not cat_urls:  # no sitemap categories: same-site nav links that are not products
        inhome = [u for u in homelinks if K.domain(u) == K.domain(base) and u != root and u not in prodset
                  and not re.search(skip, u) and not re.search(brand, u)][:60]
        cat_set = set(inhome)
    pool0 = inhome or [u for u in cat_urls if not re.search(brand, u)]
    level = [u for u in pool0 if depth(u) == min(map(depth, pool0))] if pool0 else []
    if any(re.search(cat_hint, u) for u in pool0):
        level = [u for u in pool0 if re.search(cat_hint, u)]
    if kat:
        hit = [u for u in cat_urls if any(slug(k) in slug(u) for k in kat)]
        level = hit + [u for u in level if u not in hit] if hit else level
    K.log("listings", len(cat_urls), "level0", len(level), "products in sitemap", len(prodset))
    out, seen, visited, per_cap, used = [], set(), set(), max(6, MAX_CANDIDATES // 10), 0

    def enough():
        cats_now, keys = {}, set()
        for c in out:
            if c["available"] and c["image_url"] and c["price"] and c["name"] and name_key(c["name"]) not in keys:
                keys.add(name_key(c["name"]))
                cats_now[c["category"]] = cats_now.get(c["category"], 0) + 1
        return len(cats_now) >= 8 and sum(min(v, PER_CAT_MAX) for v in cats_now.values()) >= (NEED + 2 * SPARES) * 1.5

    from collections import deque
    queue, tail_added = deque(level), False
    while used < MAX_LISTINGS and len(out) < MAX_CANDIDATES and not enough():
        if not queue:
            if tail_added:
                break
            tail_added = True  # remaining sitemap categories, brands last
            queue.extend(u for u in sorted(cat_urls, key=lambda x: (bool(re.search(brand, x)), depth(x))) if u not in visited)
            continue
        u = queue.popleft()
        if u in visited:
            continue
        visited.add(u)
        r = K.fetch(u, fresh)
        used += 1
        if not r.ok:
            continue
        cat = listing_name(r.text)
        got = 0
        for c in cards(base, r.text, prodset, cat):
            nk = name_key(c["name"]) if c["name"] else c["url"]
            last = "/" + c["url"].rsplit("/", 1)[-1]
            if c["url"] in seen or nk in seen or last in seen or got >= per_cap:
                continue
            seen.update((c["url"], nk, last))
            out.append(c)
            got += 1
        K.log("listing", u, cat, got)
        if got < 3:  # parent page with sub-category tiles -> first child next, the rest at the end
            path = urllib.parse.urlsplit(u).path.rstrip("/")
            links = list(dict.fromkeys(nurl(K.absu(base, h)) for h in re.findall(r'href=["\']([^"\'#]+)["\']', r.text)))
            il = [nurl(K.absu(base, i.get("url"))) for i in K.jsonld(r.text, "ItemList").get("itemListElement") or []
                  if isinstance(i, dict) and i.get("url")]
            kids = [x for x in links if x in cat_set and x not in visited and urllib.parse.urlsplit(x).path.startswith(path + "/")]
            kids += [x for x in il if x not in visited and x not in prodset and x not in kids]
            if kids:
                queue.appendleft(kids[0])
                queue.extend(kids[1:])
    if len([c for c in out if c["available"] and c["image_url"] and c["price"]]) < NEED + SPARES and prodset:
        # JS-rendered listings: deterministic stride over sitemap product URLs (detail pages verified later)
        rest = sorted(u for u in prodset if u not in seen and "/" + u.rsplit("/", 1)[-1] not in seen)
        k = NEED + SPARES * 3
        # URL szülő-szegmens = kategória (pl. /termekek/<kat>/<slug>); ha legalább 3 van, körbeforgó választás
        segs = lambda u: [p for p in urllib.parse.urlsplit(u).path.split("/") if p]  # noqa: E731
        groups = OrderedDict()
        for u in rest:
            s = segs(u)
            groups.setdefault(s[-2] if len(s) >= 3 else None, []).append(u)
        if len([g for g in groups if g]) >= 3:
            if kat:
                hit = [g for g in groups if g and any(slug(x) in slug(g) for x in kat)]
                order = hit + [g for g in groups if g not in hit]
            else:
                order = list(groups)
            picked, i = [], 0
            while len(picked) < k and any(groups[g] for g in order):
                for g in order:
                    if len(picked) < k and len(groups[g]) > i:
                        picked.append((g, groups[g][i]))
                i += 1
                if i > max(map(len, groups.values())):
                    break
        else:
            step = max(1, len(rest) // k)
            picked = [(None, u) for u in rest[::step][:k]]
        if WANT_SLUGS:  # kézi válogatás: a kért slugok mindenképp jelöltek legyenek
            have = {u for _, u in picked}
            want = [(groups_key(u, segs), u) for u in rest if u.rsplit("/", 1)[-1] in WANT_SLUGS and u not in have]
            picked = want + picked
        for g, u in picked:
            out.append(dict(id=None, name="", price=None, currency="HUF", available=None, url=u, image_url=None,
                            category=g.replace("-", " ") if g else None, description="", verified=False,
                            sitemap_only=True))
        warn(f"listákból kevés termék ({len(seen)}), sitemap-fallback: {len(picked)} URL, {len(groups)} csoport")
    return out, f"{base} (listings: {used})"


# ---------------- product page ----------------
def detail(c, fresh, platform):
    if platform == "Shopify":
        return shopify_js(c, fresh)
    r = K.fetch(c["url"], fresh)
    if not r.ok:
        return None
    t = r.text
    p = K.jsonld(t, "Product")
    offers = p.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    if offers.get("@type") == "AggregateOffer" and not offers.get("price"):
        offers["price"] = offers.get("lowPrice")
    sp = re.search(r"ShopRenter\.product\s*=\s*(\{.*?\});", t)
    try:
        sp = json.loads(sp.group(1)) if sp else {}
    except ValueError:
        sp = {}

    def ip(prop, attr="content"):
        m = re.search(r'itemprop=["\']%s["\'][^>]*\b%s=["\']([^"\']*)' % (prop, attr), t) or \
            re.search(r'\b%s=["\']([^"\']*)["\'][^>]*itemprop=["\']%s["\']' % (attr, prop), t)
        return html.unescape(m.group(1)) if m else None

    price = num(offers.get("price")) or num(sp.get("price")) or num(ip("price")) or num(K.meta(t, "product:price:amount"))
    cur = offers.get("priceCurrency") or sp.get("currency") or ip("priceCurrency") or K.meta(t, "product:price:currency") or "HUF"
    av = offers.get("availability") or ip("availability", "href") or ip("availability")
    low = t.lower()
    if av:
        available = bool(re.search(r"instock|limitedavailability|onlineonly", av, re.I))
    elif platform == "Unas":
        # témánként más a kosárgomb: js-main-product-cart-btn VAGY value/title="Kosárba" gomb
        cart = "js-main-product-cart-btn" in t or re.search(r"""(?i)(?:value|title|aria-label)=["']kosárba["']""", t)
        available = bool(cart) and not re.search(r"elfogyott|nem rendelhető|jelenleg nem kapható", low)
    else:
        available = bool(re.search(r"kosárba|add to cart|add-to-cart", low)) and not re.search(OUT_WORDS, low)
    img = p.get("image")
    if isinstance(img, list):
        img = img[0] if img else None
    if isinstance(img, dict):
        img = img.get("url") or img.get("contentUrl")
    img = img or ip("image", "data-popup-src") or ip("image", "src") or K.meta(t, "og:image")
    if img and "shoprenter" in img:
        img = re.sub(r"/cache/[^/]+/product/", "/cache/w900h900wt1/product/", img)
    crumbs = [i.get("name") or (i.get("item") or {}).get("name") for i in
              (K.jsonld(t, "BreadcrumbList").get("itemListElement") or []) if isinstance(i, dict)
              and not isinstance(i.get("item"), str) or isinstance(i, dict)]
    crumbs = [x for x in crumbs if x][1:-1]
    h1 = re.search(r"(?is)<h1[^>]*>(.*?)</h1>", t)
    name = p.get("name") or sp.get("name") or (K.clean(h1.group(1)) if h1 else None) or c["name"]
    pid = p.get("sku") or p.get("productID") or sp.get("id") or ip("sku")
    return dict(c, name=html.unescape(str(name)).strip(), price=price, currency=cur, available=available,
                image_url=None if is_placeholder(img) else K.absu(c["url"], img),
                category=c.get("category") or (crumbs[-1] if crumbs else None) or ip("category") or "egyéb",
                id=re.sub(r"[^\w-]", "", str(pid)) if pid else hashlib.sha1(c["url"].encode()).hexdigest()[:10],
                description=K.clean(p.get("description") or K.meta(t, "og:description") or "")[:600],
                url=offers.get("url") or c["url"], verified=True)


# ---------------- selection ----------------
# Adventi (családi) kalendáriumba nem való: felnőtt/erotikus és ivós termékek
NOT_ADVENT = r"(?i)erotik|szex|18\+|felnőtt|felnott|monogamy|hancúr|hancur|ivós|\bivos\b|iszogat|vedel|kocsmat[uú]ra"
MIN_PRICE = 1  # --min-ar <Ft> felülírja


def ok(c):
    return (c.get("available") and c.get("image_url") and (c.get("price") or 0) >= MIN_PRICE and c.get("name")
            and not re.search(NOT_ADVENT, "%s %s" % (c.get("name") or "", c.get("category") or "")))


def select(cands, n):
    """Deterministic order: round robin over categories (2 first, then up to 5,
    then relax). Returns the full ranked list (chosen first, then spares)."""
    seen_img, seen_name, groups = set(), set(), OrderedDict()
    for c in cands:
        ik = (c.get("image_url") or "").split("?")[0] or c["url"]
        nk = name_key(c["name"]) if c.get("name") else c["url"]
        if ik in seen_img or nk in seen_name:
            continue
        seen_img.add(ik)
        seen_name.add(nk)
        groups.setdefault(c.get("category") or "egyéb", []).append(c)
    cats = sorted(groups, key=lambda g: -len(groups[g]))  # stable: bigger first, then first seen
    k = max(1, min(len(cats), n // PER_CAT_MIN))
    main, extra = cats[:k], cats[k:]
    ranked, taken = [], {g: 0 for g in cats}

    def take(g):
        if taken[g] < len(groups[g]):
            ranked.append(groups[g][taken[g]])
            taken[g] += 1
            return True
        return False

    for _ in range(PER_CAT_MIN):
        for g in main:
            take(g)
    for cap in list(range(PER_CAT_MIN + 1, PER_CAT_MAX + 1)) + [10 ** 6]:
        pool = main if cap <= PER_CAT_MAX else main + extra
        for g in extra if cap == PER_CAT_MAX + 1 else []:
            pass
        progress = True
        while progress:
            progress = False
            for g in pool:
                if taken[g] < cap and take(g):
                    progress = True
                    if len(ranked) >= n + 3 * SPARES:
                        break
            if len(ranked) >= n + 3 * SPARES:
                break
            if cap <= PER_CAT_MAX:
                break  # one round per cap level
        if len(ranked) >= n + 3 * SPARES:
            break
        if cap == PER_CAT_MAX and extra:
            for g in extra:  # small categories before exceeding the 5 cap
                while taken[g] < PER_CAT_MAX and len(ranked) < n + 3 * SPARES and take(g):
                    pass
    return ranked


def ext_of(url, ctype):
    m = re.search(r"\.(jpe?g|png|webp|gif|avif)(?:$|\?)", urllib.parse.urlsplit(url).path + "?", re.I)
    if m:
        return m.group(1).lower().replace("jpeg", "jpg")
    for e in ("webp", "png", "jpeg", "gif", "avif"):
        if e in (ctype or ""):
            return e.replace("jpeg", "jpg")
    return "jpg"


def download(c, imgdir, fresh):
    existing = sorted(imgdir.glob(f"{c['id']}.*"))
    if existing:
        return existing[0], existing[0].read_bytes()
    r = K.fetch(c["image_url"], fresh, accept="image/avif,image/webp,image/*,*/*", cache=False)
    if not r.ok or len(r.body) < 500 or not (r.header("content-type") or "image").startswith("image"):
        return None, None
    f = imgdir / f"{c['id']}.{ext_of(c['image_url'], r.header('content-type'))}"
    f.write_bytes(r.body)
    return f, r.body


def main(argv):
    global NEED
    args = {"--n": "24"}
    kat, fresh, url = [], "--fresh" in argv, None
    i = 0
    argv = [a for a in argv if a != "--fresh"]
    while i < len(argv):
        a = argv[i]
        if a in ("--out", "--n", "--ids", "--min-ar"):
            args[a] = argv[i + 1] if i + 1 < len(argv) else None
            i += 2
        elif a == "--kat":
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                kat.append(argv[i])
                i += 1
        else:
            url = url or a
            i += 1
    if not url or not args.get("--out"):
        print("usage: katalogus.py <url> --out <demo_dir> [--n 24] [--kat <substr>...] [--ids id1,id2,...] [--min-ar Ft] [--fresh]")
        return 2
    n = NEED = int(args["--n"])
    global MIN_PRICE
    MIN_PRICE = int(args.get("--min-ar") or MIN_PRICE)
    WANT_SLUGS[:] = [x.strip() for x in (args.get("--ids") or "").split(",") if x.strip()]
    out = Path(args["--out"]).expanduser().resolve()
    K.set_log("katalogus")
    base = K.norm_base(url)
    home = K.fetch(base + "/", fresh)
    if not home.ok:
        print(f"HIBA: főoldal HTTP {home.status} ({base})")
        return 2
    base = K.norm_base(home.url)
    platform = K.detect_platform(home)
    K.log("platform", platform, base)
    if platform == "Shopify":
        cands, source = shopify(base, home, fresh, kat)
    elif platform in ("WooCommerce", "WordPress"):
        cands, source = woo(base, home, fresh, kat)
        if not cands:
            cands, source = html_shop(base, home, fresh, kat, platform)
    else:
        cands, source = html_shop(base, home, fresh, kat, platform)
    if kat:
        hit = [c for c in cands if c.get("sitemap_only") or any(k.lower() in f"{c.get('category')} {c.get('name')}".lower() for k in kat)]
        if hit:
            cands = hit
        else:
            warn(f"--kat {kat}: nincs találat, teljes kínálat")
    total = len(cands)
    cands = [c for c in cands if not re.search(NOT_ADVENT, "%s %s %s" % (c.get("name") or "", c.get("category") or "", c.get("url") or ""))
             and not (c.get("price") and c["price"] < MIN_PRICE)]
    # ár nélküli listaelem is mehet (egyes Unas-témák listáján nincs gépi ár); a termékoldal ellenőrzi
    pool = [c for c in cands if c.get("sitemap_only") or (c["available"] is not False and c.get("image_url")
            and ((c.get("price") or 0) > 0 or c.get("verified") is False))]
    pool = pool[:MAX_CANDIDATES]
    K.log("candidates", total, "pool", len(pool))
    # sitemap-only entries must be verified before ranking (need category/name)
    verified_pool = []
    for c in pool:
        if c.get("sitemap_only"):
            d = detail(c, fresh, platform)
            if d and ok(d):
                verified_pool.append(d)
        else:
            verified_pool.append(c)
    ranked = select([c for c in verified_pool if c["verified"] is False or ok(c)], n)
    if args.get("--ids"):  # kézi válogatás: a megadott sorrend = napsorrend, a többlet tartalék
        want = [x.strip() for x in args["--ids"].split(",") if x.strip()]
        by_id = {}
        for c in cands + verified_pool:  # a MAX_CANDIDATES-vágás előtti teljes lista
            if not (c.get("sitemap_only") or c["available"] is not False):
                continue
            # Unas/ShopRenter listán nincs id (csak a termékoldalon): URL-slug és /spd/<id>/ is kulcs
            parts = [p for p in str(c.get("url") or "").rstrip("/").split("/") if p]
            keys = [str(c["id"])] if c.get("id") else []
            if parts:
                keys.append(parts[-1])
            if "spd" in parts and parts.index("spd") + 1 < len(parts):
                keys.append(parts[parts.index("spd") + 1])
            for key in keys:
                by_id.setdefault(key, c)
        miss = [x for x in want if x not in by_id]
        if miss:
            warn(f"--ids: {len(miss)} azonosító nincs a rendelhető jelöltek között: {','.join(miss[:5])}")
        ranked = [by_id[x] for x in want if x in by_id]
    imgdir = out / "public" / "products"
    imgdir.mkdir(parents=True, exist_ok=True)
    (out / "data").mkdir(parents=True, exist_ok=True)
    chosen, hashes, noimg, budget = [], set(), 0, n + SPARES
    for c in ranked:
        if len(chosen) >= n:
            break
        if not c["verified"]:
            if budget <= 0:
                break
            budget -= 1
            d = detail(c, fresh, platform)
            if not d or not ok(d):
                K.log("reject detail", c["url"], d and {k: d[k] for k in ("available", "price", "image_url")})
                continue
            c = d
        f, body = download(c, imgdir, fresh)
        if not f:
            noimg += 1
            K.log("image fail", c["image_url"])
            continue
        h = hashlib.sha1(body).hexdigest()
        if h in hashes:
            K.log("dup image", c["url"])
            continue
        hashes.add(h)
        c["image_local"] = str(f.relative_to(out))
        chosen.append(c)
    if budget <= 0 and len(chosen) < n:
        warn(f"tartalék elfogyott ({n}+{SPARES} termékoldal)")
    now = K.now()
    for c in chosen:
        c["price"] = int(round(c["price"])) if c["currency"] == "HUF" or float(c["price"]).is_integer() else round(c["price"], 2)
    recs = [{"id": c["id"], "name": c["name"], "price": c["price"], "currency": c["currency"], "available": True,
             "url": c["url"], "image_url": c["image_url"], "image_local": c["image_local"],
             "category": c["category"], "fetched_at": now} for c in chosen]
    (out / "data" / "termekek.json").write_text(json.dumps(recs, ensure_ascii=False, indent=1))
    demo = {"shop": K.domain(base), "source": source, "retrievedDate": now[:10], "products": [
        {"day": i + 1, "id": c["id"], "name": c["name"], "url": c["url"],
         "priceHuf": int(round(c["price"])), "currency": c["currency"], "availability": "https://schema.org/InStock",
         "category": c["category"], "description": c.get("description", ""), "originalImageUrl": c["image_url"],
         "image": "/" + c["image_local"].split("public/", 1)[-1], "retrievedAt": now} for i, c in enumerate(chosen)]}
    (out / "data" / "products.json").write_text(json.dumps(demo, ensure_ascii=False, indent=1))
    cats = {c["category"] for c in chosen}
    if any(c["currency"] != "HUF" for c in chosen):
        warn("nem HUF pénznem: " + ",".join(sorted({c["currency"] for c in chosen})))
    small = [g for g in cats if sum(1 for c in chosen if c["category"] == g) < PER_CAT_MIN]
    if small and len(cats) > 1:
        warn(f"{len(small)} kategória csak 1 termékkel")
    s = K.STATS
    print(f"{len(chosen)}/{n} rendben, {noimg}-nél nincs kép, kategóriák: {len(cats)} | {platform}, jelölt {total}"
          f" | http live {s['live']} cache {s['cache']}")
    for w in WARN[:5]:
        print("! " + w)
    print(f"-> {out / 'data' / 'termekek.json'} | log: {K.LOG.path}")
    K.log("chosen", json.dumps(recs, ensure_ascii=False))
    if not chosen:
        return 2
    return 0 if len(chosen) == n else 1


NEED = 24
if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
