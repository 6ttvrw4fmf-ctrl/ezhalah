"""PROBE ONLY: what does dealapp's origin render now? Structural keys only, no listing text."""
import json, re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from curl_cffi import requests as cc
IDS = ["537588", "492398", "611316", "521655", "604959", "591180", "999999999"]
B = "https://dealapp.sa"
def keys(o, d=0):
    if d > 2: return "…"
    if isinstance(o, dict): return {k: keys(v, d+1) for k, v in list(o.items())[:30]}
    if isinstance(o, list): return [f"list[{len(o)}]"]
    return type(o).__name__
for prof in ("chrome124", "safari17_0"):
    s = cc.Session(impersonate=prof)
    s.headers.update({"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    for i in IDS:
        for u in (f"{B}/ar/ad-details/{i}", f"{B}/ar/ad-details/{i}?_={int(time.time())}", f"{B}/en/ad-details/{i}"):
            try:
                r = s.get(u, timeout=45)
            except Exception as e:
                print(prof, u, "EXC", type(e).__name__); continue
            b = r.text or ""
            h = r.headers
            m = re.search(r'<script id="ng-state" type="application/json">(.*?)</script>', b, re.S)
            st = {}
            if m:
                try: st = json.loads(m.group(1))
                except Exception as e: st = {"_parse": str(e)[:60]}
            sm = st.get("schemaMarkupScripts") if isinstance(st, dict) else None
            print(f"{prof} {u[len(B):]} -> {r.status_code} final={str(r.url)[len(B):][:60]} len={len(b)} xcache={h.get('x-cache')} age={h.get('age')} ngstate={bool(m)} "
                  f"stateKeys={list(st.keys())[:25] if isinstance(st, dict) else type(st).__name__} smKeys={list(sm.keys()) if isinstance(sm, dict) else sm!r:.80} "
                  f"RealEstateListing={b.count('RealEstateListing')} realestate={b.count('real-estate')} ldjson={b.count('application/ld+json')} offers={b.count('offers')} wall={b.count('register') + b.count('تسجيل')}")
            if i == "537588" and u.endswith(i) and m and isinstance(st, dict):
                small = {k: keys(v) for k, v in st.items() if not k.startswith("schemaMarkup")}
                print("   STATE SHAPE:", json.dumps(small, ensure_ascii=False)[:2500])
            time.sleep(2)
