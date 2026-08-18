"""RPC params builder + CONTRACT ASSERTIONS.

Fixes the two harness defects found in the 2026-08-17 daily audit:

  C1  t5_sweep.py read `t.get("p_types")` where p_types actually lived under t["params"],
      so p_types/p_tables/p_tables2/p_types2 were silently None in all 99 searches. The tests
      were LABELLED شقة/فيلا while the request carried no type filter at all.
  C2  p_beds_exact was sent as a scalar; production sends an ARRAY. All 7 bedroom tests
      errored with 22P02 instead of testing anything.

The fix is not "be more careful" — it is that a spec now CANNOT be executed unless every
filter it claims is provably present in the outgoing request body, in production's shape.
assert_contract() raises before any network call.
"""
import os
# Set QA_DIR / STRESS_DIR to your working directories (defaults: ./.stress-qa, ./.stress-out).
SCRATCH_QA = os.environ.get("QA_DIR", os.path.join(os.getcwd(), ".stress-qa"))
SCRATCH_STRESS = os.environ.get("STRESS_DIR", os.path.join(os.getcwd(), ".stress-out"))
import json, sys

QA = SCRATCH_QA
TYPE_PARAMS = json.load(open(f"{QA}/type_params.json"))   # captured from the LIVE UI, per نوع


class ContractError(AssertionError):
    pass


def build(spec):
    """spec -> the exact RPC body production would send. Never silently drops a filter."""
    ty = spec.get("type")
    if ty is not None and ty not in TYPE_PARAMS:
        raise ContractError(f"unknown نوع {ty!r} — not one of the 26 live types")
    live = TYPE_PARAMS[ty]["params"] if ty else None

    p = {
        "p_deal": spec["deal"],
        "p_rent_period": spec.get("period") if spec["deal"] == "إيجار" else None,
        "p_cities": spec.get("cities"),
        "p_districts": spec.get("districts"),
        "p_platforms": None,
        "p_region_ids": None,
        "p_category": spec.get("category"),
        # THE C1 FIX: read the type block from the captured LIVE params, under ["params"].
        "p_types":   (live or {}).get("p_types"),
        "p_types2":  (live or {}).get("p_types2"),
        "p_tables":  (live or {}).get("p_tables"),
        "p_tables2": (live or {}).get("p_tables2"),
        # THE C2 FIX: production sends an ARRAY of exact bedroom counts.
        "p_beds_exact": ([int(b) for b in spec["beds_exact"]] if spec.get("beds_exact") else None),
        "p_beds_min": spec.get("beds_min"),
        "p_price_min": spec.get("price_min"),
        "p_price_max": spec.get("price_max"),
        "p_area_min": spec.get("area_min"),
        "p_area_max": spec.get("area_max"),
        "p_per_platform": None,
        "p_limit": spec.get("limit", 300),
        "p_offset": spec.get("offset", 0),
    }
    assert_contract(spec, p)
    return p


def assert_contract(spec, p):
    """Every filter the spec CLAIMS must be present in the request, in production's shape.
    Raises ContractError before the request is ever sent."""
    errs = []

    # --- type: the C1 guard ---------------------------------------------------------------
    # The ONLY correct definition of "the type filter is present" is: identical to what the LIVE
    # UI sends for that نوع. Do not hand-assert a shape — 19 of the 26 types are kinds:BOTH and
    # send ONE merged 62-table scope with NO scope B, while the other 7 send the 31+31 two-scope
    # form. (My first version asserted scope B unconditionally and wrongly rejected all 19.)
    if spec.get("type"):
        live = TYPE_PARAMS[spec["type"]]["params"]
        for k in ("p_types", "p_types2", "p_tables", "p_tables2"):
            if p.get(k) != live.get(k):
                errs.append(f"{k} does not match the live UI request for نوع={spec['type']}")
        if not p.get("p_types"):
            errs.append(f"spec claims نوع={spec['type']} but p_types is empty")
        if not p.get("p_tables"):
            errs.append("a typed search must carry p_tables (table scope)")
        if (p.get("p_tables2") is None) != (p.get("p_types2") is None):
            errs.append("scope B is half-populated: p_tables2 and p_types2 must both be set or both null")
        if not p.get("p_category"):
            errs.append("a typed search must carry p_category")
    else:
        if p.get("p_types"):
            errs.append("spec claims NO نوع but p_types is populated")

    # --- deal / period --------------------------------------------------------------------
    if p["p_deal"] != spec["deal"]:
        errs.append("p_deal does not match the spec")
    if spec["deal"] == "إيجار" and spec.get("period") and p["p_rent_period"] != spec["period"]:
        errs.append(f"spec claims period={spec['period']} but p_rent_period={p['p_rent_period']!r}")
    if spec["deal"] == "بيع" and p["p_rent_period"] is not None:
        errs.append("بيع must not carry a rent period")

    # --- location -------------------------------------------------------------------------
    if spec.get("cities") and p["p_cities"] != spec["cities"]:
        errs.append("p_cities does not match the spec")
    if spec.get("districts") and p["p_districts"] != spec["districts"]:
        errs.append("p_districts does not match the spec")

    # --- bedrooms: the C2 guard -----------------------------------------------------------
    if spec.get("beds_exact"):
        if not isinstance(p["p_beds_exact"], list):
            errs.append(f"p_beds_exact must be a LIST (production shape), got {type(p['p_beds_exact']).__name__}")
        elif p["p_beds_exact"] != [int(b) for b in spec["beds_exact"]]:
            errs.append("p_beds_exact does not match the spec")
    if spec.get("beds_min") and p["p_beds_min"] != spec["beds_min"]:
        errs.append("p_beds_min does not match the spec")

    # --- numeric ranges -------------------------------------------------------------------
    for sk, pk in (("price_min","p_price_min"),("price_max","p_price_max"),
                   ("area_min","p_area_min"),("area_max","p_area_max")):
        if spec.get(sk) is not None and p[pk] != spec[sk]:
            errs.append(f"{pk} ({p[pk]!r}) does not match spec {sk} ({spec[sk]!r})")

    if errs:
        raise ContractError("CONTRACT VIOLATION for spec "
                            + json.dumps({k: v for k, v in spec.items() if v is not None}, ensure_ascii=False)
                            + " :: " + " | ".join(errs))


def dimensions(spec):
    """Which filter dimensions this spec actually exercises — drives the coverage matrix."""
    d = {"deal"}
    if spec["deal"] == "إيجار" and spec.get("period"): d.add("period")
    if spec.get("type"): d.add("type")
    if spec.get("category") and not spec.get("type"): d.add("group")
    if spec.get("cities"): d.add("city")
    if spec.get("districts"):
        d.add("district")
        if len(spec["districts"]) > 1: d.add("multi_district")
    if spec.get("beds_exact") or spec.get("beds_min"): d.add("bedrooms")
    if spec.get("price_min") is not None or spec.get("price_max") is not None: d.add("price")
    if spec.get("area_min") is not None or spec.get("area_max") is not None: d.add("area")
    return d
