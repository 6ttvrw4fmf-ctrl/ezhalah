"""Profile the LIVE inventory per نوع × deal, through the anon role, so the stress matrix is
grounded in real data instead of random numbers. Re-runnable: the matrix adapts as inventory moves.

For each of the 26 live types we learn: which deals exist, which cities/districts actually hold
stock, realistic price/area percentiles, and which bedroom values are populated. A combination is
only generated when the inventory can support it — that is what makes 1,000+ searches MEANINGFUL
rather than 1,000 guaranteed-empty ones.
"""
import os
# Set QA_DIR / STRESS_DIR to your working directories (defaults: ./.stress-qa, ./.stress-out).
SCRATCH_QA = os.environ.get("QA_DIR", os.path.join(os.getcwd(), ".stress-qa"))
SCRATCH_STRESS = os.environ.get("STRESS_DIR", os.path.join(os.getcwd(), ".stress-out"))
import sys, json, time, urllib.request, urllib.parse, statistics, collections
sys.path.insert(0, SCRATCH_QA)
from lib import SB, ANON
from contract import TYPE_PARAMS

OUT = SCRATCH_STRESS
COLS = "city_ar,district_ar,price_total,price_annual,area_m2,bedrooms"
SAMPLE = 3000


def fetch(path, timeout=90):
    req = urllib.request.Request(f"{SB}/rest/v1/{path}")
    req.add_header("apikey", ANON); req.add_header("Authorization", "Bearer " + ANON)
    req.add_header("Prefer", "count=exact")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        rng = r.headers.get("Content-Range", "")
        total = int(rng.split("/")[-1]) if "/" in rng and rng.split("/")[-1].isdigit() else None
        return json.loads(r.read().decode()), total


def pct(vals, q):
    vals = sorted(v for v in vals if v is not None)
    if not vals: return None
    i = max(0, min(len(vals) - 1, int(round(q * (len(vals) - 1)))))
    return int(vals[i])


prof = {}
for ty, meta in TYPE_PARAMS.items():
    prof[ty] = {"cat": meta["cat"], "group": meta["group"], "deals": {}}
    types_ar = meta["params"]["p_types"]
    inlist = ",".join('"%s"' % t for t in types_ar)
    for deal in ("إيجار", "بيع"):
        q = (f"search_listings_ar?select={COLS}&production_ready=is.true"
             f"&type_ar=in.({urllib.parse.quote(inlist)})"
             f"&deal_ar=eq.{urllib.parse.quote(deal)}&limit={SAMPLE}")
        try:
            rows, total = fetch(q)
        except Exception as e:
            prof[ty]["deals"][deal] = {"error": str(e)[:120]}
            continue
        if not rows:
            prof[ty]["deals"][deal] = {"n": total or 0}
            continue
        cities = collections.Counter(r["city_ar"] for r in rows if r["city_ar"])
        dist_by_city = {}
        for c, _ in cities.most_common(3):
            dd = collections.Counter(r["district_ar"] for r in rows
                                     if r["city_ar"] == c and r["district_ar"])
            dist_by_city[c] = [d for d, _ in dd.most_common(4)]
        prices = [(r["price_total"] if r["price_total"] is not None else r["price_annual"]) for r in rows]
        prices = [float(p) for p in prices if p is not None]
        areas = [float(r["area_m2"]) for r in rows if r["area_m2"] is not None]
        beds = collections.Counter(int(r["bedrooms"]) for r in rows if r["bedrooms"] is not None)
        prof[ty]["deals"][deal] = {
            "n": total if total is not None else len(rows),
            "sampled": len(rows),
            "cities": [c for c, _ in cities.most_common(4)],
            "districts": dist_by_city,
            "p": {q_: pct(prices, v) for q_, v in (("p10",.10),("p25",.25),("p50",.50),("p75",.75),("p90",.90))},
            "a": {q_: pct(areas, v) for q_, v in (("a10",.10),("a25",.25),("a50",.50),("a75",.75),("a90",.90))},
            "beds": {str(b): n for b, n in sorted(beds.items()) if 1 <= b <= 4},
            "beds5plus": sum(n for b, n in beds.items() if b >= 5),
        }
        time.sleep(0.15)

json.dump(prof, open(f"{OUT}/profile.json", "w"), ensure_ascii=False)
have = [(t, d, v.get("n", 0)) for t, m in prof.items() for d, v in m["deals"].items() if v.get("n", 0) > 0]
print("profiled types:", len(prof), "| type×deal combos with inventory:", len(have))
print("total inventory across combos:", sum(n for _, _, n in have))
for t, m in prof.items():
    ds = {d: v.get("n", 0) for d, v in m["deals"].items()}
    print(f"  {t:14} {m['cat']:5} rent={ds.get('إيجار',0):>6} buy={ds.get('بيع',0):>6}")
