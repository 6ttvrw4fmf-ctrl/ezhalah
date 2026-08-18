"""Generate the stress matrix: every نوع × every filter dimension the LIVE inventory can support.

Depth is scaled by inventory so a 15-row type does not get 26 near-identical searches (that is the
"diminishing returns" line — extra searches there add cost, not coverage). Bedroom specs are only
emitted for types whose inventory actually publishes bedroom values; elsewhere bedrooms is recorded
as N/A rather than silently "untested".
"""
import os
# Set QA_DIR / STRESS_DIR to your working directories (defaults: ./.stress-qa, ./.stress-out).
SCRATCH_QA = os.environ.get("QA_DIR", os.path.join(os.getcwd(), ".stress-qa"))
SCRATCH_STRESS = os.environ.get("STRESS_DIR", os.path.join(os.getcwd(), ".stress-out"))
import json, sys
sys.path.insert(0, SCRATCH_STRESS)
OUT = SCRATCH_STRESS
PROF = json.load(open(f"{OUT}/profile.json"))

CAT = {"سكني": "Residential", "تجاري": "Commercial"}


def depth(n):
    if n >= 1000: return "L"
    if n >= 200:  return "M"
    if n >= 20:   return "S"
    return "XS"


def gen():
    specs = []

    def add(kind, ty, deal, **kw):
        s = {"kind": kind, "type": ty, "deal": deal,
             "category": CAT[PROF[ty]["cat"]] if ty else None}
        s.update({k: v for k, v in kw.items() if v is not None})
        specs.append(s)

    for ty, meta in PROF.items():
        for deal, inv in meta["deals"].items():
            n = inv.get("n", 0)
            if n <= 0:
                continue
            d = depth(n)
            cities = inv.get("cities") or []
            dists = inv.get("districts") or {}
            P, A = inv.get("p") or {}, inv.get("a") or {}
            beds_avail = [b for b, c in (inv.get("beds") or {}).items() if c > 0]
            has5 = (inv.get("beds5plus") or 0) > 0
            per_variants = ["سنوي", "شهري", "كلاهما"] if deal == "إيجار" else [None]

            # 1) baseline type × deal (+ every period branch for rent)
            for per in per_variants:
                add("base", ty, deal, period=per)

            # 2) cities — depth-scaled
            ncity = {"L": 3, "M": 3, "S": 2, "XS": 1}[d]
            for c in cities[:ncity]:
                add("city", ty, deal, period=per_variants[0], cities=[c])

            # 3) district / multi-district in the top city
            top = cities[0] if cities else None
            dl = dists.get(top, []) if top else []
            for dd in dl[:2]:
                add("district", ty, deal, period=per_variants[0], cities=[top], districts=[dd])
            if len(dl) >= 2:
                add("multi_district", ty, deal, period=per_variants[0], cities=[top], districts=dl[:2])
            if len(dl) >= 3:
                add("multi_district", ty, deal, period=per_variants[0], cities=[top], districts=dl[:3])
                add("multi_district_dup", ty, deal, period=per_variants[0],
                    cities=[top], districts=[dl[0], dl[0]])

            # 4) price shapes off the REAL distribution
            if P.get("p50"):
                shapes = [("price_min_only", dict(price_min=P["p50"])),
                          ("price_max_only", dict(price_max=P["p50"])),
                          ("price_range",    dict(price_min=P["p25"], price_max=P["p75"])),
                          ("price_boundary", dict(price_min=P["p50"], price_max=P["p50"]))]
                if d in ("L", "M"):
                    shapes += [("price_very_low",  dict(price_min=0, price_max=P["p10"])),
                               ("price_very_high", dict(price_min=P["p90"]))]
                for nm, kw in shapes:
                    add(nm, ty, deal, period=per_variants[0], **kw)

            # 5) area shapes off the REAL distribution
            if A.get("a50"):
                shapes = [("area_min_only", dict(area_min=A["a50"])),
                          ("area_max_only", dict(area_max=A["a50"])),
                          ("area_range",    dict(area_min=A["a25"], area_max=A["a75"])),
                          ("area_boundary", dict(area_min=A["a50"], area_max=A["a50"]))]
                if d in ("L", "M"):
                    shapes += [("area_very_small", dict(area_min=1, area_max=A["a10"])),
                               ("area_very_large", dict(area_min=A["a90"]))]
                for nm, kw in shapes:
                    add(nm, ty, deal, period=per_variants[0], **kw)

            # 6) bedrooms — ONLY where the inventory publishes them
            for b in beds_avail:
                add("bedrooms", ty, deal, period=per_variants[0], beds_exact=[int(b)])
            if has5:
                add("bedrooms_5plus", ty, deal, period=per_variants[0], beds_min=5)

            # 7) pairwise combinations
            if P.get("p50") and A.get("a50"):
                add("price+area", ty, deal, period=per_variants[0],
                    price_min=P["p25"], price_max=P["p75"], area_min=A["a25"], area_max=A["a75"])
            if P.get("p50") and beds_avail:
                add("price+bedrooms", ty, deal, period=per_variants[0],
                    price_min=P["p25"], price_max=P["p75"], beds_exact=[int(beds_avail[-1])])
            if A.get("a50") and beds_avail:
                add("area+bedrooms", ty, deal, period=per_variants[0],
                    area_min=A["a25"], area_max=A["a75"], beds_exact=[int(beds_avail[-1])])

            # 8) city + district + type
            if top and dl:
                add("city+district+type", ty, deal, period=per_variants[0],
                    cities=[top], districts=[dl[0]])

            # 9) FULL combination — as many filters at once as the inventory supports
            full = dict(period=per_variants[0], cities=[top] if top else None,
                        price_min=P.get("p25"), price_max=P.get("p75"),
                        area_min=A.get("a25"), area_max=A.get("a75"))
            if beds_avail:
                full["beds_exact"] = [int(beds_avail[-1])]
            if dl:
                full["districts"] = [dl[0]]
            add("full_combo", ty, deal, **full)

            # 10) deliberate zero / very-small result probes
            add("zero_impossible", ty, deal, period=per_variants[0], price_min=1, price_max=2,
                area_min=1, area_max=2)
            if P.get("p90"):
                add("very_small_result", ty, deal, period=per_variants[0],
                    price_min=P["p90"] * 10)

    # 11) GROUP-level searches (فئة/مجموعة with no نوع) — the group surface, not the type surface
    seen = set()
    for ty, meta in PROF.items():
        key = (meta["cat"], meta["group"])
        if key in seen:
            continue
        seen.add(key)
        for deal in ("إيجار", "بيع"):
            specs.append({"kind": "group_level", "type": None, "deal": deal,
                          "category": CAT[meta["cat"]],
                          "period": "سنوي" if deal == "إيجار" else None,
                          "_group": meta["group"]})
    return specs


if __name__ == "__main__":
    s = gen()
    json.dump(s, open(f"{OUT}/specs.json", "w"), ensure_ascii=False)
    import collections
    print("TOTAL SPECS:", len(s))
    print("by kind:", json.dumps(dict(collections.Counter(x["kind"] for x in s)), ensure_ascii=False, indent=1))
    print("typed:", sum(1 for x in s if x.get("type")), "| group-level:", sum(1 for x in s if not x.get("type")))
    print("rent:", sum(1 for x in s if x["deal"] == "إيجار"), "| buy:", sum(1 for x in s if x["deal"] == "بيع"))
