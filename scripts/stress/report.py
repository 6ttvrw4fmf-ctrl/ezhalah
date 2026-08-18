"""Aggregate the stress run into the coverage matrix + headline numbers. Evidence only."""
import os
# Set QA_DIR / STRESS_DIR to your working directories (defaults: ./.stress-qa, ./.stress-out).
SCRATCH_QA = os.environ.get("QA_DIR", os.path.join(os.getcwd(), ".stress-qa"))
SCRATCH_STRESS = os.environ.get("STRESS_DIR", os.path.join(os.getcwd(), ".stress-out"))
import json, collections, sys, os
OUT = SCRATCH_STRESS
R = json.load(open(f"{OUT}/results.json"))
SEEN = json.load(open(f"{OUT}/seen_ids.json"))
PROF = json.load(open(f"{OUT}/profile.json"))
UI = []
for f in ("ui_desktop.json", "ui_mobile.json"):
    if os.path.exists(f"{OUT}/{f}"):
        UI += json.load(open(f"{OUT}/{f}"))

DIMS = ["deal","period","type","group","city","district","multi_district","bedrooms","price","area"]

cls = collections.Counter(x["cls"] for x in R)
print("=== CLASSIFICATION ===")
for k, v in cls.most_common(): print(f"  {k:14} {v}")
print(f"  TOTAL SEARCHES {len(R)}")

rows = sum(x.get("rows_validated", 0) for x in R)
idx  = sum(x.get("idx_checked", 0) or 0 for x in R)
print(f"\n=== VOLUME ===\n  rows validated (RPC payload, all returned): {rows}")
print(f"  rows re-read via anon index (deal/period/type): {idx}")
print(f"  UNIQUE listing ids inspected: {len(SEEN)}")
print(f"  sum of eligible-set sizes (non-distinct): {sum(x.get('total',0) for x in R)}")

print("\n=== PER-DIMENSION ===")
for d in DIMS:
    n = sum(1 for x in R if d in x.get("dims", []))
    f = sum(1 for x in R if d in x.get("dims", []) and x["cls"] == "PRODUCT_FAIL")
    print(f"  {d:16} tests={n:>5}  product_fails={f}")

print("\n=== COVERAGE MATRIX: نوع × dimension (searches) ===")
hdr = ["نوع","cat","tests","deal","per","city","dist","multi","beds","price","area","fails","N/A"]
print("  " + " ".join(f"{h:>7}" for h in hdr))
per_type = collections.defaultdict(lambda: collections.Counter())
for x in R:
    t = x.get("type") or "<group-level>"
    per_type[t]["tests"] += 1
    if x["cls"] == "PRODUCT_FAIL": per_type[t]["fails"] += 1
    for d in x.get("dims", []): per_type[t][d] += 1
order = list(PROF.keys()) + ["<group-level>"]
for t in order:
    c = per_type.get(t)
    if not c: continue
    cat = PROF[t]["cat"] if t in PROF else "-"
    na = ""
    if t in PROF:
        beds_any = any((v.get("beds") or {}) or v.get("beds5plus") for v in PROF[t]["deals"].values())
        if not beds_any: na = "beds"
    print(f"  {t:>7} {cat:>7} {c['tests']:>7} {c['deal']:>7} {c['period']:>7} {c['city']:>7} "
          f"{c['district']:>7} {c['multi_district']:>7} {c['bedrooms']:>7} {c['price']:>7} "
          f"{c['area']:>7} {c['fails']:>7} {na:>7}")

print("\n=== RESULT-SIZE DISTRIBUTION (are we testing real inventory?) ===")
buckets = collections.Counter()
for x in R:
    t = x.get("total")
    if t is None: buckets["no-verdict"] += 1
    elif t == 0: buckets["0 (zero-result)"] += 1
    elif t < 10: buckets["1-9 (very small)"] += 1
    elif t < 100: buckets["10-99"] += 1
    elif t < 1000: buckets["100-999"] += 1
    else: buckets["1000+ (large)"] += 1
for k, v in sorted(buckets.items()): print(f"  {k:20} {v}")

print("\n=== RES vs COM / BUY vs RENT / PERIOD ===")
resn = sum(1 for x in R if x.get("type") and PROF.get(x["type"],{}).get("cat")=="سكني")
comn = sum(1 for x in R if x.get("type") and PROF.get(x["type"],{}).get("cat")=="تجاري")
print(f"  Residential {resn} | Commercial {comn} | group-level {sum(1 for x in R if not x.get('type'))}")
print(f"  rent {sum(1 for x in R if x['deal']=='إيجار')} | buy {sum(1 for x in R if x['deal']=='بيع')}")

print("\n=== PRODUCT FAILURES (each one, in full) ===")
pf = [x for x in R if x["cls"] == "PRODUCT_FAIL"]
if not pf: print("  none")
for x in pf:
    print("  " + json.dumps({k: x.get(k) for k in ("kind","type","deal","dims","total","returned",
          "rows_validated","idx_checked","violations")}, ensure_ascii=False))

print("\n=== HARNESS / INFRA ===")
for c in ("HARNESS","INFRA"):
    xs = [x for x in R if x["cls"] == c]
    print(f"  {c}: {len(xs)}")
    for x in xs[:6]:
        print("    ", x["kind"], x.get("type"), "->", (x.get("err") or "")[:110])

print("\n=== CITY-SPELLING VARIANTS (source truth, NOT defects) ===")
tv = sum(sum(x.get("variants",{}).values()) for x in R)
print(f"  rows whose city_ar is a source-published spelling of the requested city: {tv}")

if UI:
    j = [u for u in UI if u["t"]=="journey"]; ck = [u for u in UI if u["t"]=="click"]
    ss = [u for u in UI if u["t"]=="stale-state"]
    print("\n=== UI LAYER ===")
    print(f"  journeys {len(j)} | parity ok {sum(1 for x in j if x['parity'])}/{len(j)}"
          f" | «عرض المزيد» ok {sum(1 for x in j if x.get('cards_after') and x['cards_after']>x['cards_b1'])}/{len(j)}")
    print(f"  duplicate ids across eligible pages: {sum(x['dup_ids'] for x in j)} over {sum(x['eligible_rows'] for x in j)} rows")
    print(f"  card-field violations: type={sum(len(x['bad_type']) for x in j)} "
          f"city={sum(len(x['bad_city']) for x in j)} period={sum(len(x['bad_period']) for x in j)}")
    print(f"  click-throughs {len(ck)} | host match {sum(1 for x in ck if x.get('match'))}")
    print(f"  desktop journeys {sum(1 for x in j if x['view']=='desktop')} | mobile {sum(1 for x in j if x['view']=='mobile')}")
    for s in ss: print("  stale-state:", json.dumps({k:v for k,v in s.items() if k not in('t','view')}, ensure_ascii=False)[:200])
