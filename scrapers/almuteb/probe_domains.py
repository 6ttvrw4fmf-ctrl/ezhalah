"""PROBE ONLY (not for merge): almuteb moved to almuteb.com.sa — read its structure."""
import re, sys
from curl_cffi import requests as cc
B = "https://almuteb.com.sa"
s = cc.Session(impersonate="chrome124")
def get(p):
    try:
        r = s.get(B + p, timeout=30)
        return r.status_code, r.headers.get("content-type", ""), r.text or ""
    except Exception as e:
        return None, "", f"{type(e).__name__} {e}"
for p in ("/robots.txt", "/sitemap.xml", "/sitemap_index.xml"):
    st, ct, t = get(p)
    print(f"PROBE {p}: {st} {ct} len={len(t)}\n{t[:1500]}", flush=True)
st, ct, home = get("/")
links = sorted(set(re.findall(r'href="([^"#]+)"', home)))
print(f"PROBE home links ({len(links)}): {links[:150]}", flush=True)
print("PROBE home scripts:", re.findall(r'<script[^>]+src="([^"]+)"', home)[:20], flush=True)
print("PROBE home api hints:", sorted(set(re.findall(r'["\'](/api/[^"\']+)', home)))[:30], flush=True)
txt = re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", home, flags=re.S))
print("PROBE home text:", re.sub(r"\s+", " ", txt)[:2500], flush=True)
cand = [l for l in links if re.search(r"propert|project|unit|عقار|مشروع|villa|offer", l, re.I)][:6]
for l in cand:
    p = l.replace(B, "") if l.startswith(B) else l
    if not p.startswith("/"):
        continue
    st, ct, t = get(p)
    sub = sorted(set(re.findall(r'href="([^"#]+)"', t)))
    tx = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S)))
    print(f"PROBE page {p}: {st} len={len(t)} links={sub[:80]}\n  text={tx[:1500]}\n  ld={re.findall(r'application/ld\\+json[^>]*>(.*?)</script>', t, re.S)[:2]}", flush=True)
sys.exit(1)
