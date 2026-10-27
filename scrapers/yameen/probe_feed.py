"""PROBE ONLY (not for merge): why the yameen list feed lost its 4 for-sale lands."""
import json, sys
from scrapers.goldendeal.run import session, api_url
from scrapers.yameen.run import TENANT
s = session(TENANT)
def show(label, url):
    try:
        r = s.get(url, timeout=40)
        b = r.json() if "json" in (r.headers.get("content-type") or "") else None
        if isinstance(b, dict) and isinstance(b.get("data"), list):
            rows = b["data"]
            print(f"PROBE {label}: HTTP {r.status_code} total={(b.get('meta') or {}).get('total')} n={len(rows)} "
                  f"purposes={sorted({(x.get('purpose'), x.get('availability_status')) for x in rows})} "
                  f"ids={[x.get('id') for x in rows][:40]}", flush=True)
        elif isinstance(b, dict):
            d = b.get("data") or {}
            keep = {k: d.get(k) for k in ("id", "purpose", "availability_status", "published_on_website", "type",
                                           "selling_price", "category", "status", "is_published", "deleted_at", "updated_at")}
            print(f"PROBE {label}: HTTP {r.status_code} {json.dumps(keep, ensure_ascii=False)} keys={sorted(d)[:80]}", flush=True)
        else:
            print(f"PROBE {label}: HTTP {r.status_code} {(r.text or '')[:200]!r}", flush=True)
    except Exception as e:
        print(f"PROBE {label}: {type(e).__name__} {e}", flush=True)
base = api_url(TENANT)
show("list", f"{base}?page=1&per_page=100")
for q in ("purpose=sell", "purpose=sale", "purpose=buy", "filter[purpose]=sell", "type=land", "category=residential&purpose=sell"):
    show(f"list?{q}", f"{base}?page=1&per_page=100&{q}")
for pid in (45194, 45197, 45960, 52439, 54413):
    show(f"detail {pid}", api_url(TENANT, pid))
for pid in (45194, 54413):
    try:
        r = s.get(f"https://www.yameen.sa/properties/{pid}", timeout=40)
        t = r.text or ""
        print(f"PROBE web {pid}: HTTP {r.status_code} final={r.url} len={len(t)} has_404={'404' in t[:3000]} "
              f"title={t[t.find('<title'):t.find('</title>')][:120]!r}", flush=True)
    except Exception as e:
        print(f"PROBE web {pid}: {type(e).__name__}", flush=True)
sys.exit(1)
