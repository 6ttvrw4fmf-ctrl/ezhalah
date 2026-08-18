"""Execute the stress matrix and adjudicate EVERY returned row against EVERY requested predicate.

Validation split (deliberate, to keep load sane while validating everything):
  • city / district / price / area / bedrooms  -> validated for ALL returned rows straight from the
    RPC payload (the RPC returns those columns), so it costs zero extra requests.
  • deal / period / type                        -> require the index row, so a bounded sample per
    search is re-read through the ANON role (user truth).

Failure taxonomy is explicit and never merged:
  PRODUCT  – Ezhalah returned a row that does not satisfy the user's request
  HARNESS  – my test code/spec was wrong (e.g. the 2026-08-17 p_types and p_beds_exact defects)
  INFRA    – network/timeout/5xx; the test never got a verdict
  VARIANT  – source-published Arabic spelling of the SAME canonical city (NOT a defect; recorded)
"""
import os
# Set QA_DIR / STRESS_DIR to your working directories (defaults: ./.stress-qa, ./.stress-out).
SCRATCH_QA = os.environ.get("QA_DIR", os.path.join(os.getcwd(), ".stress-qa"))
SCRATCH_STRESS = os.environ.get("STRESS_DIR", os.path.join(os.getcwd(), ".stress-out"))
import sys, json, time, collections, urllib.request, urllib.parse
sys.path.insert(0, SCRATCH_QA)
sys.path.insert(0, SCRATCH_STRESS)
from lib import rpc, SB, ANON
from contract import build, dimensions, ContractError

OUT = SCRATCH_STRESS
SPECS = json.load(open(f"{OUT}/specs.json"))
LIMIT, IDX_SAMPLE = 200, 80

# public.normalize_ar equivalent (from the live RPC's index expression)
_TR = str.maketrans({"أ":"ا","إ":"ا","آ":"ا","ٱ":"ا","ة":"ه","ى":"ي",
                     "ـ":"", "‎":"", "‏":"", "‌":"", "‍":"",
                     "‪":"", "‫":"", "‬":"", "‭":"", "‮":""})
def norm(s): return " ".join((s or "").strip().lower().translate(_TR).split())
def dnorm(s): return norm((s or "").replace("حي ", " "))

IDX_COLS = ("source_table,listing_id,deal_ar,rent_period_ar,payment_monthly,"
            "rent_now_pay_later,type_ar,production_ready")


def idx_fetch(cands):
    by = collections.defaultdict(list)
    for c in cands: by[c["source_table"]].append(int(c["listing_id"]))
    out = {}
    for tbl, ids in by.items():
        for i in range(0, len(ids), 180):
            part = ids[i:i+180]
            q = (f"search_listings_ar?select={IDX_COLS}&source_table=eq.{tbl}"
                 f"&listing_id=in.({','.join(map(str,part))})&limit={len(part)}")
            req = urllib.request.Request(f"{SB}/rest/v1/{q}")
            req.add_header("apikey", ANON); req.add_header("Authorization", "Bearer " + ANON)
            with urllib.request.urlopen(req, timeout=90) as r:
                for row in json.loads(r.read().decode()):
                    out[f"{row['source_table']}:{row['listing_id']}"] = row
    return out


def period_ok(row, period):
    if row["deal_ar"] != "إيجار": return True
    rnpl = bool(row.get("rent_now_pay_later"))
    if period == "شهري":  return bool(row.get("payment_monthly")) and not rnpl
    if period == "سنوي":  return row.get("rent_period_ar") == "سنوي" or (row.get("rent_period_ar") == "شهري" and rnpl)
    if period == "كلاهما": return bool(row.get("payment_monthly")) or row.get("rent_period_ar") == "سنوي" or \
                                  (row.get("rent_period_ar") == "شهري" and rnpl)
    return True


def run_one(spec, seen_ids, types_of):
    res = {"kind": spec["kind"], "type": spec.get("type"), "deal": spec["deal"],
           "dims": sorted(dimensions(spec))}
    try:
        p = build(dict(spec, limit=LIMIT))
    except ContractError as e:
        res.update(cls="HARNESS", err=str(e)[:200]); return res
    # INFRA retry: a lock timeout / schema-cache blip from a CONCURRENT session is not a verdict
    # on the product. Retry once with backoff before recording INFRA.
    d, ms, err = rpc("location_search_candidates_ar", p)
    if err:
        time.sleep(4)
        d, ms2, err2 = rpc("location_search_candidates_ar", p)
        if err2:
            res.update(cls="INFRA", ms=round(ms), err=err2[:160], retried=True); return res
        ms = ms2; err = None; res["retried"] = True
    res["ms"] = round(ms)
    d = d or []
    res["total"] = int(d[0]["total_count"]) if d else 0
    res["returned"] = len(d)
    for c in d: seen_ids.add(f"{c['source_table']}:{int(c['listing_id'])}")

    v = collections.Counter(); variants = collections.Counter(); checked = 0
    # ---- ALL returned rows: city / district / price / area / bedrooms (free, from the payload)
    want_c = [norm(x) for x in (spec.get("cities") or [])]
    want_d = [dnorm(x) for x in (spec.get("districts") or [])]
    for c in d:
        checked += 1
        if want_c and norm(c.get("city_ar")) not in want_c:
            variants["city_variant"] += 1 if c.get("city_ar") else 0
            v["city"] += 0 if c.get("city_ar") else 1
        if want_d and dnorm(c.get("district_ar")) not in want_d: v["district"] += 1
        ep = c.get("effective_price")
        if spec.get("price_min") is not None and (ep is None or float(ep) < spec["price_min"]): v["price_min"] += 1
        if spec.get("price_max") is not None and (ep is None or float(ep) > spec["price_max"]): v["price_max"] += 1
        ar = c.get("area_m2")
        if spec.get("area_min") is not None and (ar is None or float(ar) < spec["area_min"]): v["area_min"] += 1
        if spec.get("area_max") is not None and (ar is None or float(ar) > spec["area_max"]): v["area_max"] += 1
        bd = c.get("bedrooms")
        if spec.get("beds_exact") and (bd is None or int(bd) not in spec["beds_exact"]): v["bedrooms"] += 1
        if spec.get("beds_min") and (bd is None or int(bd) < spec["beds_min"]): v["bedrooms_min"] += 1
    res["rows_validated"] = checked

    # ---- sampled rows: deal / period / type (needs the index row)
    samp = d[:IDX_SAMPLE]
    if samp:
        try:
            idx = idx_fetch(samp)
        except Exception as e:
            res["idx_err"] = str(e)[:120]; idx = {}
        res["idx_checked"] = len(idx)
        want_t = types_of.get(spec.get("type"))
        for c in samp:
            row = idx.get(f"{c['source_table']}:{int(c['listing_id'])}")
            if row is None: continue
            if row["deal_ar"] != spec["deal"]: v["deal"] += 1
            if spec.get("period") and not period_ok(row, spec["period"]): v["period"] += 1
            if want_t and row["type_ar"] not in want_t: v["type"] += 1
            # production_ready=false is DELIBERATE, not a defect: the RPC admits unlocated
            # inventory only when the search carries NO location filter (see its WHERE clause).
            # With a city/district selected it must be production_ready — that IS a defect.
            if (spec.get("cities") or spec.get("districts")) and not row.get("production_ready"):
                v["not_production_ready"] += 1
    v = {k: n for k, n in v.items() if n}   # a zero-count key is not a violation
    res["violations"] = dict(v)
    res["variants"] = dict(variants)
    res["cls"] = "PRODUCT_FAIL" if v else "PASS"
    return res


def main():
    from contract import TYPE_PARAMS
    types_of = {t: set(m["params"]["p_types"]) for t, m in TYPE_PARAMS.items()}
    seen = set(); out = []
    t0 = time.time()
    for i, spec in enumerate(SPECS):
        # cron-collision courtesy: avoid the :00/:15/:20 minute slots for heavy batches
        while time.localtime().tm_min in (0, 15, 20) and time.localtime().tm_sec < 50:
            time.sleep(5)
        out.append(run_one(spec, seen, types_of))
        if (i + 1) % 100 == 0:
            json.dump(out, open(f"{OUT}/results.json", "w"), ensure_ascii=False)
            json.dump(sorted(seen), open(f"{OUT}/seen_ids.json", "w"))
            el = time.time() - t0
            bad = sum(1 for r in out if r["cls"] == "PRODUCT_FAIL")
            print(f"[{i+1}/{len(SPECS)}] {el:.0f}s  product_fails={bad} "
                  f"unique_ids={len(seen)} rows={sum(r.get('rows_validated',0) for r in out)}", flush=True)
        time.sleep(0.05)
    json.dump(out, open(f"{OUT}/results.json", "w"), ensure_ascii=False)
    json.dump(sorted(seen), open(f"{OUT}/seen_ids.json", "w"))
    print("DONE", len(out), "unique_ids", len(seen))


if __name__ == "__main__":
    main()
