"""PROBE ONLY (branch probe/alqasem-1114, never merged): print the rebuilt site's shape."""
import json, re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.alqasem.run import session, BASE

def get(s, path):
    u = path if path.startswith("http") else BASE + path
    try:
        r = s.get(u, timeout=30, allow_redirects=True)
        return r.status_code, r.text or "", str(r.url), dict(r.headers)
    except Exception as e:
        return -1, str(e), u, {}

def shape(o, d=0, maxd=4):
    if d > maxd: return "…"
    if isinstance(o, dict): return {k: shape(v, d+1, maxd) for k, v in list(o.items())[:40]}
    if isinstance(o, list): return [shape(o[0], d+1, maxd), f"len={len(o)}"] if o else []
    if isinstance(o, str): return o[:70]
    return o

s = session()
for p in ["/properties", "/properties?all=1", "/properties?deal=rent", "/sitemap.xml", "/sitemap_index.xml", "/robots.txt", "/properties/luxury-villa-for-rent"]:
    st, body, url, h = get(s, p); time.sleep(1)
    print(f"\n===== {p} -> {st} {len(body)}B final={url} ctype={h.get('content-type')} server={h.get('server')} xpb={h.get('x-powered-by')}")
    if p.endswith(".txt") or p.endswith(".xml"):
        print(body[:1500]); continue
    print("scripts:", sorted(set(re.findall(r'<script[^>]+src="([^"]+)"', body)))[:25])
    print("api strings:", sorted(set(re.findall(r'["\'](/api/[^"\'\s]{0,80}|https?://[^"\'\s]*api[^"\'\s]{0,80})["\']', body)))[:30])
    print("prop links:", len(set(re.findall(r'/properties/[a-z0-9\-%]+', body))), sorted(set(re.findall(r'/properties/[a-z0-9\-%]+', body)))[:60])
    for tag in ("__NEXT_DATA__", "__NUXT__", "self.__next_f", "wp-content", "postid-", "inertia", "data-page=", "livewire", "wire:", "application/ld+json", "lat", "lng", "price", "ر.س", "رقم الترخيص", "ترخيص"):
        print(f"  has {tag!r}: {body.count(tag)}")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if m:
        print("NEXT_DATA shape:", json.dumps(shape(json.loads(m.group(1))), ensure_ascii=False)[:4000])
    m = re.search(r'data-page="([^"]+)"', body)
    if m:
        import html
        print("INERTIA shape:", json.dumps(shape(json.loads(html.unescape(m.group(1)))), ensure_ascii=False)[:5000])
    for ld in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', body, re.S)[:3]:
        print("LD:", ld[:800])
    txt = re.sub(r"<[^>]+>", "\n", re.sub(r"<(script|style)[^>]*>.*?</\1>", "", body, flags=re.S))
    lines = [l.strip() for l in txt.split("\n") if l.strip()]
    print("TEXT LINES (first 120, digits of 9+ masked):")
    for l in lines[:120]:
        print("   |", re.sub(r"\d{9,}", "<NUM>", l)[:140])
# bundles
st, body, _, _ = get(s, "/properties")
for src in sorted(set(re.findall(r'<script[^>]+src="([^"]+\.js[^"]*)"', body)))[:12]:
    st2, js, u2, _ = get(s, src if src.startswith("http") else BASE + (src if src.startswith("/") else "/" + src))
    hits = sorted(set(re.findall(r'["\'`](/api/[^"\'`\s]{0,90}|https?://[^"\'`\s]{0,60}/api[^"\'`\s]{0,60})["\'`]', js)))
    print(f"\nBUNDLE {src} {st2} {len(js)}B api:", hits[:40])
