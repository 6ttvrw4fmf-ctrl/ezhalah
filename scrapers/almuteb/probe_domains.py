"""PROBE ONLY (not for merge): 869 down-site rule for almuteb — DNS + HTTP on domain variants."""
import json, re, socket, sys
from curl_cffi import requests as cc
HOSTS = ["almuteb.sa", "www.almuteb.sa", "almuteb.com", "www.almuteb.com", "almuteb.com.sa",
         "www.almuteb.com.sa", "almuteb.net", "www.almuteb.net", "almuteb.co", "almutebrealestate.com",
         "almuteb-re.com", "almutebre.com", "almuteb.sa.com", "almuteb.org"]
for h in HOSTS:
    try:
        ips = sorted({a[4][0] for a in socket.getaddrinfo(h, 443)})
    except Exception as e:
        print(f"PROBE {h}: DNS {type(e).__name__} {e}", flush=True); continue
    for path in ("/", "/wp-json/wp/v2/properties?per_page=1"):
        try:
            r = cc.get(f"https://{h}{path}", impersonate="chrome124", timeout=25, allow_redirects=True)
            t = re.search(r"<title[^>]*>(.*?)</title>", r.text or "", re.S | re.I)
            print(f"PROBE {h}{path}: ips={ips} HTTP {r.status_code} final={r.url} total={r.headers.get('x-wp-total')} "
                  f"title={(t.group(1).strip()[:80] if t else None)!r} body={(r.text or '')[:160]!r}", flush=True)
        except Exception as e:
            print(f"PROBE {h}{path}: ips={ips} {type(e).__name__} {str(e)[:150]}", flush=True)
# DoH: does .sa still have NS records for almuteb.sa?
for name, typ in (("almuteb.sa", "NS"), ("almuteb.sa", "A"), ("almuteb.com", "A")):
    try:
        r = cc.get(f"https://dns.google/resolve?name={name}&type={typ}", timeout=20)
        print(f"PROBE DoH {name} {typ}: {r.text[:300]}", flush=True)
    except Exception as e:
        print(f"PROBE DoH {name} {typ}: {type(e).__name__}", flush=True)
sys.exit(1)
