"""Shared helpers for the hajra/ prospecting scripts (stdlib only).

* fetch(): urllib GET with browser UA, timeout, per-host polite delay,
  429 back-off (5, 10, 20 s) and an on-disk cache keyed by URL hash
  (scripts/hajra/cache/<sha1>.json + .body). Cached unless fresh=True.
* Log: append-only detail log in scripts/hajra/log/<name>.log.
* Small HTML helpers (text, meta, JSON-LD, platform detection).
"""
import hashlib
import html as _html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
LOGDIR = HERE / "log"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
DELAY = 0.8          # seconds between live requests to the same host
TIMEOUT = 25
BACKOFF = (5, 10, 20)
_last = {}
_blocked = {}  # host -> count of 429s that survived the full back-off
BLOCK_AFTER = 2
STATS = {"live": 0, "cache": 0, "err": 0, "429": 0}


class Log:
    def __init__(self, name):
        LOGDIR.mkdir(parents=True, exist_ok=True)
        self.path = LOGDIR / f"{name}.log"
        self.f = open(self.path, "a", encoding="utf-8")
        self.w(f"===== run {now()} argv={sys.argv[1:]}")

    def w(self, *a):
        self.f.write(" ".join(str(x) for x in a) + "\n")
        self.f.flush()


LOG = None


def set_log(name):
    global LOG
    LOG = Log(name)
    return LOG


def log(*a):
    if LOG:
        LOG.w(*a)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm_base(url):
    url = url.strip()
    if not re.match(r"https?://", url):
        url = "https://" + url
    p = urllib.parse.urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def domain(url):
    d = urllib.parse.urlsplit(norm_base(url)).netloc.lower()
    return d[4:] if d.startswith("www.") else d


def _key(url):
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def safe_url(url):
    return urllib.parse.quote(url, safe=":/?=&%#+,;@!$*'()~[]")


class Resp:
    def __init__(self, status, body, headers, url, cached=False):
        self.status, self.body, self.headers, self.url, self.cached = status, body, headers, url, cached

    @property
    def ok(self):
        return self.status == 200

    @property
    def text(self):
        return self.body.decode("utf-8", "ignore") if self.body else ""

    def json(self):
        try:
            return json.loads(self.text)
        except ValueError:
            return None

    def header(self, name):
        name = name.lower()
        for k, v in self.headers.items():
            if k.lower() == name:
                return v
        return None


def fetch(url, fresh=False, accept=None, binary=False, cache=True):
    """GET url -> Resp (never raises). 200/404/410 are cached."""
    url = safe_url(url)
    k = _key(url)
    meta_p, body_p = CACHE / f"{k}.json", CACHE / f"{k}.body"
    if cache and not fresh and meta_p.exists() and body_p.exists():
        try:
            m = json.loads(meta_p.read_text())
            STATS["cache"] += 1
            return Resp(m["status"], body_p.read_bytes(), m.get("headers", {}), m.get("final", url), True)
        except (ValueError, OSError):
            pass
    host = urllib.parse.urlsplit(url).netloc
    if _blocked.get(host, 0) >= BLOCK_AFTER:  # circuit breaker: don't hammer a rate-limited host
        STATS["429"] += 1
        log("429 circuit-open", url)
        return Resp(429, b"", {}, url)
    hdr = {"User-Agent": UA, "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.5",
           "Accept": accept or "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"}
    for attempt in range(len(BACKOFF) + 1):
        wait = DELAY - (time.time() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        STATS["live"] += 1
        try:
            req = urllib.request.Request(url, headers=hdr)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                status, body, headers, final = r.status, r.read(), dict(r.headers.items()), r.geturl()
        except urllib.error.HTTPError as e:
            status, headers, final = e.code, dict(e.headers.items()) if e.headers else {}, url
            try:
                body = e.read()
            except Exception:  # noqa: BLE001
                body = b""
        except Exception as e:  # noqa: BLE001
            STATS["err"] += 1
            log("ERR", url, type(e).__name__, str(e)[:200])
            return Resp(0, b"", {}, url)
        if status == 429 and attempt < len(BACKOFF) and _blocked.get(host, 0) < BLOCK_AFTER - 1:
            log("429 back-off", BACKOFF[attempt], "s", url)
            time.sleep(BACKOFF[attempt])
            continue
        break
    if status == 429:
        _blocked[host] = _blocked.get(host, 0) + 1
        STATS["429"] += 1
    log(status, len(body), url)
    if cache and status in (200, 404, 410):
        CACHE.mkdir(parents=True, exist_ok=True)
        keep = {k2: v for k2, v in headers.items() if k2.lower() in (
            "content-type", "x-wp-total", "x-wp-totalpages", "link", "x-shopid", "x-powered-by", "server")}
        body_p.write_bytes(body)
        meta_p.write_text(json.dumps({"url": url, "final": final, "status": status, "headers": keep,
                                      "at": now()}))
    return Resp(status, body, headers, final)


# ---------- HTML helpers ----------
def text(h):
    t = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", h or "")
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|td|span)>", "\n", t)
    t = _html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"[ \t ]+", " ", t)
    return re.sub(r"\s*\n\s*", "\n", t).strip()


def clean(s):
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def meta(t, prop):
    for pat in (r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']*)["\']',
                r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']%s["\']'):
        m = re.search(pat % re.escape(prop), t, re.I)
        if m:
            return _html.unescape(m.group(1)).strip()
    return None


def jsonld_all(t):
    out = []
    for m in re.findall(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', t):
        try:
            d = json.loads(m.strip())
        except ValueError:
            try:
                d = json.loads(re.sub(r"[\x00-\x1f]", " ", m.strip()))
            except ValueError:
                continue
        stack = [d]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                if "@graph" in x:
                    stack.extend(x["@graph"] if isinstance(x["@graph"], list) else [x["@graph"]])
                out.append(x)
    return out


def jsonld(t, typ):
    for d in jsonld_all(t):
        ty = d.get("@type")
        if ty == typ or (isinstance(ty, list) and typ in ty):
            return d
    return {}


def detect_platform(r):
    """r = homepage Resp."""
    t = r.text
    h = " ".join(f"{k}:{v}" for k, v in r.headers.items()).lower()
    if "cdn.shopify" in t or "Shopify.theme" in t or "x-shopid" in h or "shopify" in h:
        return "Shopify"
    if re.search(r"shoprenter", t, re.I) or "shoprenter" in h:
        return "ShopRenter"
    if re.search(r"\bunas\b|UNAS|unas\.hu|unascdn", t) or "unas" in h:
        return "Unas"
    if "woocommerce" in t.lower() or "wc-block" in t or "/wp-json/wc/" in t:
        return "WooCommerce"
    if "wp-json" in t or "wp-content" in t:
        return "WordPress"
    return "egyéb"


def absu(base, href):
    return urllib.parse.urljoin(base + "/", _html.unescape(href or "").strip())


def sitemap_entries(base, fresh=False, max_fetch=6, want=r"product|termek"):
    """robots.txt sitemaps (or /sitemap.xml) -> (entries, complete).
    entries: list of dicts {loc, priority, image}; product child sitemaps of
    an index are preferred (and then only those are read)."""
    import gzip
    sms = []
    r = fetch(base + "/robots.txt", fresh)
    if r.ok:
        sms = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", r.text)
    if not sms:
        sms = [base + "/sitemap.xml"]
    out, fetched, queue, seen, complete = [], 0, list(dict.fromkeys(sms)), set(), True
    while queue:
        if fetched >= max_fetch:
            complete = False
            break
        u = queue.pop(0)
        if u in seen:
            continue
        seen.add(u)
        r = fetch(u, fresh, accept="application/xml,text/xml,*/*")
        fetched += 1
        if not r.ok:
            continue
        b = r.body
        if b[:2] == b"\x1f\x8b":
            try:
                b = gzip.decompress(b)
            except OSError:
                continue
        body = b.decode("utf-8", "ignore")
        if "<sitemapindex" in body:
            kids = [_html.unescape(x) for x in re.findall(r"<loc>\s*(.*?)\s*</loc>", body)]
            pref = [k for k in kids if re.search(want, k, re.I)]
            queue = pref if pref else queue + kids
            continue
        for bl in re.findall(r"(?s)<url>(.*?)</url>", body):
            m = re.search(r"<loc>\s*(.*?)\s*</loc>", bl)
            if not m:
                continue
            pr = re.search(r"<priority>\s*([\d.]+)", bl)
            il = re.search(r"<image:loc>\s*(.*?)\s*</image:loc>", bl)
            it = re.search(r"<image:title>\s*(.*?)\s*</image:title>", bl, re.S)
            out.append({"loc": _html.unescape(m.group(1)), "priority": pr.group(1) if pr else None,
                        "image": "<image:" in bl, "src": u,
                        "image_loc": _html.unescape(il.group(1)) if il else None,
                        "image_title": _html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", it.group(1))).strip() if it else None})
    return out, complete


PRODUCT_URL_RE = r"/products?/|/termek/|/termekek/|-e\d+\.htm$|/spd/|/p/\d+"


def product_entries(entries, platform):
    """Pick the product URLs out of sitemap entries (platform heuristics)."""
    if not entries:
        return []
    if any(re.search(r"product|termek", e["src"], re.I) for e in entries):
        return [e for e in entries if re.search(r"product|termek", e["src"], re.I)
                and not re.search(r"product[-_]?(cat|tag)", e["src"], re.I)]
    if platform == "ShopRenter":
        return [e for e in entries if e["priority"] == "0.6"]
    imgs = [e for e in entries if e["image"]]
    if platform == "Unas" or len(imgs) >= max(5, len(entries) * 0.2):
        return imgs
    return [e for e in entries if re.search(PRODUCT_URL_RE, e["loc"], re.I)]
