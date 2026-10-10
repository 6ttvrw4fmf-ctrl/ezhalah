"""Barrier for the weekly Ministry of Justice district-sales job (scrapers/moj/sales.py).

EXECUTES the real module end to end — query building, the DSR decoder, the window, matching, the spread
and the run's write gate — against the ministry's own recorded answers for الرياض/الرمال سكني
(2025-10-10 → 2026-05-18: 285 deals, 1,390,633.21, 4,449.37 /m², p10 430,000, p90 1,646,500) plus a
small synthetic ministry for the bulk path. Then it proves every check can fail: each mutant below is
the real source with ONE line changed, and the barrier must go red on it.

    python scrapers/moj/test_moj_sales.py
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import types
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scrapers.moj import sales as real  # noqa: E402

SRC = (ROOT / "scrapers/moj/sales.py").read_text(encoding="utf-8")
FIXTURE = json.loads((ROOT / "scrapers/moj/fixtures/ramal_truth.json").read_text(encoding="utf-8"))


def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp() * 1000)


# ── a small synthetic ministry (the bulk path) + the recorded one (meta + truth check) ──────────────
RIY, MAK = "منطقة الرياض", "منطقة مكة المكرمه"
DEALS = [  # region, city, area, class, ref, price, m², date
    (RIY, "الرياض", "الرياض/الرمال", "سكني", "r1", 1_000_000, 300, "2025-09-20"),  # in the anchored window only
    (RIY, "الرياض", "الرياض/الرمال", "سكني", "r2", 1_200_000, 400, "2025-12-01"),
    (RIY, "الرياض", "الرياض/الرمال", "سكني", "r3", 900_000, 250, "2026-03-15"),
    (RIY, "الرياض", "الرياض/الرمال", "سكني", "r4", 2_000_000, 500, "2026-05-18"),
    (RIY, "الرياض", "الرياض/الرمال", "سكني", "r0", 5_000_000, 100, "2025-09-10"),  # anchor − 1 year: outside
    (RIY, "القويعية", "القويعية/الورود", "سكني", "w1", 400_000, 400, "2026-01-01"),
    (RIY, "الرياض", "الرياض/النرجس", "سكني", "n1", 2_500_000, 500, "2026-02-01"),
    (RIY, "الرياض", "الرياض/النرجس", "سكني", "n2", 2_500_000, 600, "2026-02-02"),  # same price: only the count can tell
    (RIY, "الرياض", "الرياض/الملقا", "تجاري", "m1", 9_000_000, 1000, "2026-04-01"),
    (RIY, "الرياض", "الرياض/حي الملقا", "تجاري", "m2", 8_000_000, 1000, "2026-04-02"),
    (MAK, "جدة", "جدة/الحمراء", "تجاري", "h1", 7_000_000, 700, "2026-06-01"),
    (MAK, "جدة", "جدة/الحمراء", "زراعي", "h2", 1, 1, "2026-06-02"),               # not a class we store
    (RIY, "عفيف", "عفيف/ حى الورود", "سكني", "a1", 600_000, 600, "2026-07-01"),   # the ministry's «حى » prefix
]
OURS = [
    {"region_ar": "منطقة الرياض", "city_ar": "الرياض", "district_ar": "حي الرمال"},
    {"region_ar": "منطقة الرياض", "city_ar": "القويعية", "district_ar": "حي الورود"},  # two of ours on one
    {"region_ar": "منطقة الرياض", "city_ar": "القويعية", "district_ar": "الورود"},     # normalised key
    {"region_ar": "منطقة الرياض", "city_ar": "الرياض", "district_ar": "حي النرجس"},
    {"region_ar": "منطقة الرياض", "city_ar": "الرياض", "district_ar": "حي الملقا"},     # two MoJ onto one
    {"region_ar": "منطقة مكة المكرمة", "city_ar": "جدة", "district_ar": "حي الحمراء"},
    {"region_ar": "منطقة الرياض", "city_ar": "عفيف", "district_ar": "حي الورود"},
]


class World:
    """Answers the job's requests the way the ministry does. `truncate` marks the district aggregates
    incomplete; `drop_group` leaves one district out of them (a partial read); `missing_deal` hides one
    deal row from the deal-level answer."""

    def __init__(self, truncate=False, drop_group=None, missing_deal="n2"):
        self.truncate, self.drop_group, self.missing_deal = truncate, drop_group, missing_deal
        self.windows: list[tuple[str, str]] = []

    def post(self, payload: bytes) -> bytes:
        b = json.loads(payload)
        for rec in FIXTURE:
            if rec["request"]["queries"][0]["Query"] == b["queries"][0]["Query"]:
                return json.dumps(rec["response"]).encode()
        q = b["queries"][0]["Query"]["Commands"][0]["SemanticQueryDataShapeCommand"]["Query"]
        names = [s["Name"] for s in q["Select"]]
        lo, hi, filt = "0000", "9999", {}
        for w in q.get("Where", []):
            c = w["Condition"]
            if "Comparison" in c:
                v = c["Comparison"]["Right"]["Literal"]["Value"][9:19]
                lo, hi = (v, hi) if c["Comparison"]["ComparisonKind"] == 2 else (lo, v)
            else:
                filt[c["In"]["Expressions"][0]["Column"]["Property"]] = {x[0]["Literal"]["Value"].strip("'") for x in c["In"]["Values"]}
        self.windows.append((lo, hi))
        keep = lambda d: lo <= d[7] <= hi and all(d[{"المنطقة": 0, "الحي": 2, "تصنيف العقار": 3}[k]] in v for k, v in filt.items())
        ds = [d for d in DEALS if keep(d)]
        complete = True
        if names == ["n"]:
            rows = [[len(ds)]]
        elif "ref" in names:
            rows = [[d[0], d[2], d[3], d[4], d[5]] for d in ds if d[4] != self.missing_deal]
        else:
            groups: dict = {}
            for d in ds:
                groups.setdefault((d[0], d[1], d[2], d[3]), []).append(d)
            rows = []
            for (rg, c, a, cl), g in groups.items():
                if a == self.drop_group:
                    continue
                rows.append([rg, c, a, cl, len(g), sum(d[5] for d in g) / len(g), sum(d[5] / d[6] for d in g) / len(g),
                             min(ms(d[7]) for d in g), max(ms(d[7]) for d in g), sum(d[5] for d in g), sum(d[6] for d in g)])
            complete = not self.truncate
        sel = [{"Value": f"C{i}", "Name": n} for i, n in enumerate(names)]
        dm = [{"S": [{"N": f"C{i}"} for i in range(len(names))], "C": rows[0]}] + [{"C": r} for r in rows[1:]] if rows else []
        ds_out = {"N": "DS0", "PH": [{"DM0": dm}], "IC": complete}
        if not complete:
            ds_out["RT"] = [["x"]]
        return json.dumps({"results": [{"result": {"data": {"descriptor": {"Select": sel}, "dsr": {"DS": [ds_out]}}}}]}).encode()


def ministry(m, world: World):
    return m.Ministry(post=world.post, sleep=lambda s: None)


def raises(fn, exc) -> bool:
    try:
        fn()
    except exc:
        return True
    return False


# ── the checks (each returns its problems; the real module must have none) ─────────────────────────
def check_truth(m) -> list[str]:
    """The recorded ministry answer for الرمال must come out of the real decoder + spread EXACTLY."""
    try:
        m.truth_check(ministry(m, World()))
    except m.SourceChanged as e:
        return [f"truth: {e}"]
    return []


def bulk(m, world: World):
    m.MIN_GROUPS = 1
    got = m.fetch(ministry(m, world))
    rows, stats = m.build_rows(got["aggs"], got["deal_rows"], OURS, got["refreshed_at"], "2026-10-10T00:00:00+00:00")
    return got, {(r["moj_area"], r["property_class"]): r for r in rows}


def check_window(m) -> list[str]:
    """Anchored on the ministry's max deal date (2026-09-10 in the recorded meta), never today."""
    out = []
    if m.window(date(2026, 9, 10)) != (date(2025, 9, 11), date(2026, 9, 10)):
        out.append(f"window(2026-09-10) = {m.window(date(2026, 9, 10))}")
    if m.window(date(2028, 2, 29)) != (date(2027, 3, 1), date(2028, 2, 29)):
        out.append("29 Feb anchor")
    try:
        got, rows = bulk(m, World())
    except Exception as e:  # noqa: BLE001
        return out + [f"bulk run raised: {e!r}"]
    if (got["start"], got["end"]) != ("2025-09-11", "2026-09-10"):
        out.append(f"run window {got['start']} → {got['end']}, want 2025-09-11 → 2026-09-10")
    r = rows.get(("الرياض/الرمال", "سكني"))
    if not r or (r["deals"], r["window_from"], r["window_to"]) != (4, "2025-09-20", "2026-05-18"):
        out.append(f"الرمال window/deals wrong: {r and (r['deals'], r['window_from'], r['window_to'])}")
    return out


def check_ppm(m) -> list[str]:
    """avg_ppm is the ministry's own mean of per-deal m² prices, never total ÷ total."""
    try:
        _, rows = bulk(m, World())
    except Exception as e:  # noqa: BLE001
        return [f"bulk run raised: {e!r}"]
    r = rows[("الرياض/الرمال", "سكني")]
    mean = (Decimal(1_000_000) / 300 + Decimal(1_200_000) / 400 + Decimal(900_000) / 250 + Decimal(2_000_000) / 500) / 4
    return [] if Decimal(r["avg_ppm"]) == real.money(mean) else [f"avg_ppm {r['avg_ppm']} ≠ the ministry's mean {real.money(mean)}"]


def check_matching(m) -> list[str]:
    """One of ours ↔ one MoJ district, or nothing shown. Ambiguous rows carry no key the app can read."""
    try:
        _, rows = bulk(m, World())
    except Exception as e:  # noqa: BLE001
        return [f"bulk run raised: {e!r}"]
    want = {("الرياض/الرمال", "سكني"): ("matched", "الرياض", "حي الرمال"),
            ("جدة/الحمراء", "تجاري"): ("matched", "جدة", "حي الحمراء"),       # region spelt differently
            ("عفيف/ حى الورود", "سكني"): ("matched", "عفيف", "حي الورود"),     # «حى » + a leading space
            ("القويعية/الورود", "سكني"): ("ambiguous", None, None),           # two of ours
            ("الرياض/الملقا", "تجاري"): ("ambiguous", None, None),            # two MoJ onto one of ours
            ("الرياض/حي الملقا", "تجاري"): ("ambiguous", None, None)}
    out = [f"{k}: {(rows[k]['match_status'], rows[k]['city_ar'], rows[k]['district_ar'])} want {v}"
           for k, v in want.items() if k not in rows or (rows[k]["match_status"], rows[k]["city_ar"], rows[k]["district_ar"]) != v]
    if any(k[1] not in real.CLASSES for k in rows):
        out.append("a class we do not store was written")
    if real.match([(RIY, "الرياض/الرمال", "الرياض")], [{**OURS[0], "region_ar": "منطقة القصيم"}])[(RIY, "الرياض/الرمال")][0] != "unmatched":
        out.append("a district in another region matched")
    return out


def check_spread(m) -> list[str]:
    """p10/p90 are real deal prices when the deal rows are the whole group, hidden otherwise."""
    try:
        _, rows = bulk(m, World(missing_deal="n2"))
    except Exception as e:  # noqa: BLE001
        return [f"bulk run raised: {e!r}"]
    out = []
    n = rows[("الرياض/النرجس", "سكني")]
    if n["p10_deal"] is not None or n["p90_deal"] is not None:
        out.append(f"النرجس spread invented from 1 of 2 deals: {n['p10_deal']}–{n['p90_deal']}")
    r = rows[("الرياض/الرمال", "سكني")]
    if (r["p10_deal"], r["p90_deal"]) != ("900000", "2000000"):
        out.append(f"الرمال spread {r['p10_deal']}–{r['p90_deal']}, want 900000–2000000")
    if m.spread([Decimal(1), Decimal(2)], 2, Decimal("9.00")) != (None, None):
        out.append("a spread whose mean disagrees with the ministry's avg_deal was kept")
    return out


def check_partial(m) -> list[str]:
    """A truncated or incomplete read raises before anything is written."""
    out = []
    if not raises(lambda: bulk(m, World(truncate=True)), m.SourceChanged):
        out.append("truncated district aggregates were accepted")
    if not raises(lambda: bulk(m, World(drop_group="الرياض/النرجس")), m.SourceChanged):
        out.append("a read missing a district (totals don't add up) was accepted")
    writes = []
    saved = {k: getattr(m, k) for k in ("fetch", "write", "load_ours", "stored_rows")}
    m.MIN_GROUPS = 1
    m.fetch = lambda mj: saved["fetch"](ministry(m, World(truncate=True)))
    m.write, m.load_ours, m.stored_rows = writes.append, (lambda: OURS), (lambda cols: [])
    argv, sys.argv = sys.argv, ["run"]
    try:
        m.main()
        out.append("main() finished on a partial read")
    except m.SourceChanged:
        pass
    finally:
        sys.argv = argv
        for k, v in saved.items():
            setattr(m, k, v)
    if writes:
        out.append(f"main() wrote {len(writes)} batches on a partial read")
    return out


def check_monitor(m) -> list[str]:
    """The monitor flags OUR stored claim when it differs from a fresh read."""
    fresh = {"deals": 285, "avg_deal": "1390633.21", "avg_ppm": "4449.37", "p10_deal": "430000", "p90_deal": "1646500",
             "window_from": "2025-10-10", "window_to": "2026-05-18"}
    same = {**fresh, "avg_deal": 1390633.21, "p10_deal": 430000}
    wrong = {**same, "avg_ppm": "3723.79"}
    out = []
    if m.compare(same, fresh):
        out.append(f"equal values flagged: {m.compare(same, fresh)}")
    if not m.compare(wrong, fresh):
        out.append("a stored avg_ppm that differs from the ministry was not flagged")
    return out


CHECKS = [check_truth, check_window, check_ppm, check_matching, check_spread, check_partial, check_monitor]

TRANSLATE = '.translate(str.maketrans({"ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي"}))'
NORM_BODY = '    s = (s or "")' + TRANSLATE + '\n    return _HAY.sub("", re.sub(r"\\s+", " ", s).strip())'
NORM_BODY_STRIP_FIRST = '    s = _HAY.sub("", (s or "").strip())' + TRANSLATE + '\n    return re.sub(r"\\s+", " ", s).strip()'

# ── mutants: the real source with one line changed; each must turn at least one named check red ──────
MUTANTS = [
    ("avg_ppm recomputed as total ÷ total", check_ppm,
     '"avg_ppm": str(money(a["avg_ppm"]))', '"avg_ppm": str(money(Decimal(str(a["sum_price"])) / Decimal(str(a["sum_area"]))))'),
    ("window anchored to today", check_window,
     'start, end = window(date.fromisoformat(meta["anchor"]))', "start, end = window(date.today())"),
    ("ambiguous district (two of ours) displayed", check_matching,
     "        if len(cands) > 1:\n            out[(region, area)] = (\"ambiguous\", None, None)\n            continue\n", ""),
    ("two MoJ districts onto one of ours displayed", check_matching,
     "        if len(keys) > 1:", "        if False:"),
    ("«حى » prefix kept (old order: strip «حي » before normalising)", check_matching,
     NORM_BODY, NORM_BODY_STRIP_FIRST),
    ("partial read accepted (totals check removed)", check_partial, "if summed != total:", "if False:"),
    ("partial read accepted (truncation ignored)", check_partial,
     'complete = ds.get("IC") is True and "RT" not in ds', "complete = True"),
    ("p10/p90 invented from missing deal rows", check_spread,
     "if not prices or len(prices) != deals:", "if not prices:"),
    ("p10/p90 kept when the deal rows disagree with the ministry's mean", check_spread,
     'if abs(money(sum(prices) / len(prices)) - avg_deal) > Decimal("0.01"):', "if False:"),
    ("monitor blind", check_monitor, "if v(stored, k) != v(fresh, k)]", "if False]"),
]


def mutant(old: str, new: str, i: int):
    assert SRC.count(old) == 1, f"mutant anchor not found exactly once: {old!r}"
    mod = types.ModuleType(f"moj_mutant_{i}")
    mod.__dict__["__name__"] = f"moj_mutant_{i}"
    exec(compile(SRC.replace(old, new), f"<mutant {i}>", "exec"), mod.__dict__)
    return mod


def main() -> int:
    fails = []
    for c in CHECKS:
        probs = c(real)
        print(("✓ " if not probs else "✗ ") + c.__name__ + ("" if not probs else ": " + " | ".join(probs)))
        fails += probs
    for i, (name, check, old, new) in enumerate(MUTANTS):
        with contextlib.redirect_stdout(io.StringIO()):  # a mutant's own run output is noise here
            probs = check(mutant(old, new, i))
        print(("✓ caught: " if probs else "✗ SURVIVED: ") + name + (f"  ({probs[0][:90]})" if probs else ""))
        if not probs:
            fails.append(f"mutant survived: {name}")
    print("PASS" if not fails else f"FAIL ({len(fails)})")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
