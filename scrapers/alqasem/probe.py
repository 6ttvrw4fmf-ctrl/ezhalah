"""PROBE ONLY (branch probe/alqasem-cg-1114, never merged): the rebuilt site's JSON API + full sitemap."""
import json, re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.alqasem.run import session, BASE
def shape(o, d=0):
    if d > 5: return "…"
    if isinstance(o, dict): return {k: shape(v, d+1) for k, v in list(o.items())[:60]}
    if isinstance(o, list): return [shape(o[0], d+1), f"len={len(o)}"] if o else []
    if isinstance(o, str): return re.sub(r"(?:\+?966|0)5\d{8}", "<PHONE>", o[:90])
    return o
s = session()
st = s.get(BASE + "/sitemap.xml", timeout=30)
locs = re.findall(r"<loc>([^<]+)</loc>", st.text)
print("SITEMAP", st.status_code, len(locs), [u for u in locs if "/properties/" in u and "/en/" not in u])
time.sleep(1)
for p in ["/api/properties?limit=3&depth=1", "/api/properties?limit=0", "/api/listings?limit=2", "/api/units?limit=2", "/api/access"]:
    try:
        r = s.get(BASE + p, timeout=30); time.sleep(1.2)
        print(f"\n=== {p} -> {r.status_code} {r.headers.get('content-type')} {len(r.text)}B")
        if "json" in (r.headers.get("content-type") or ""):
            j = r.json()
            print({k: j[k] for k in j if k != "docs"} if isinstance(j, dict) else type(j))
            if isinstance(j, dict) and j.get("docs"):
                print("DOC0:", json.dumps(shape(j["docs"][0]), ensure_ascii=False)[:6000])
                print("ALL:", [(d.get("id"), d.get("slug"), d.get("legacyId") or d.get("wpId") or d.get("oldId"), d.get("status")) for d in j["docs"]])
        else:
            print(r.text[:300])
    except Exception as e:
        print(p, "ERR", repr(e)[:200])
