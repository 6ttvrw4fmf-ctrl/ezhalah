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
        self.last_names: list[str] = []

    def post(self, payload: bytes) -> bytes:
        b = json.loads(payload)
        for rec in FIXTURE:
            if rec["request"]["queries"][0]["Query"] == b["queries"][0]["Query"]:
                return json.dumps(rec["response"]).encode()
        q = b["queries"][0]["Query"]["Commands"][0]["SemanticQueryDataShapeCommand"]["Query"]
        names = [s["Name"] for s in q["Select"]]
        self.last_names = names
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
        elif "ref" in names:   # the ministry's per-deal row: its date is 'YYYY/MM/DD' text, its m² price a decimal string
            full = [{"region": d[0], "city": d[1], "area": d[2], "cls": d[3], "ref": d[4], "price": d[5], "date": d[7].replace("-", "/"),
                     "area_m2": d[6], "ppm": str(d[5] / d[6])} for d in ds if d[4] != self.missing_deal]
            rows = [[f[n] for n in names] for f in full]
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
    saved = {k: getattr(m, k) for k in ("fetch", "write", "load_ours", "stored_rows", "run_archive")}
    m.MIN_GROUPS = 1
    m.fetch = lambda mj: saved["fetch"](ministry(m, World(truncate=True)))
    m.write, m.load_ours, m.stored_rows = writes.append, (lambda: OURS), (lambda cols: [])
    m.write_deals = lambda rows, window_start: writes.append(rows)   # the deals table write, stubbed like the aggregates write
    m.run_archive = lambda dry_run: writes.append("archive") or {}    # the archive write: never reached on a partial read
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


def check_archive(m) -> list[str]:
    """THE FULL ARCHIVE (owner 2026-10-21: «make sure we're capturing everything»): every published deal — every
    class incl. زراعي, matched or not, every year the ministry has — lands in moj_sales_archive; a later run re-reads
    an overlap so late registrations land; a read short of the ministry's own count writes nothing."""
    out = []
    every = {d[4] for d in DEALS}
    rows: list = []
    try:
        rep = m.run_archive(False, post=World(missing_deal=None).post, sleep=lambda s: None, stored_max=None, write=rows.extend)
    except Exception as e:  # noqa: BLE001
        return [f"archive backfill raised: {e!r}"]
    got = {r["deal_ref"] for r in rows}
    if got != every:
        out.append(f"backfill kept {sorted(got)}, want every published deal {sorted(every)}")
    if "زراعي" not in {r["property_class"] for r in rows}:
        out.append("the farm class (زراعي) was not archived")
    if not any(r["moj_area"] == "القويعية/الورود" for r in rows):
        out.append("a deal whose district does not match ours was not archived")
    if any(r["moj_city"] == "" for r in rows):
        out.append("the ministry's city was not kept")
    later: list = []
    try:
        m.run_archive(False, post=World(missing_deal=None).post, sleep=lambda s: None, stored_max="2026-06-01", write=later.extend)
    except Exception as e:  # noqa: BLE001
        return out + [f"archive overlap run raised: {e!r}"]
    if {r["deal_ref"] for r in later} != {"r4", "h1", "h2", "a1"}:
        out.append(f"overlap run read {sorted(r['deal_ref'] for r in later)}, want the last {m.ARCHIVE_OVERLAP_DAYS} days before 2026-06-01 onward")
    short: list = []
    if not raises(lambda: m.run_archive(False, post=World(missing_deal="n2").post, sleep=lambda s: None, stored_max=None,
                                        write=short.extend), m.SourceChanged):
        out.append("a read missing a deal was accepted")
    if short:
        out.append(f"a partial archive read wrote {len(short)} rows")
    kept, skipped = m.archive_rows([{"ref": "x1", "date": "2026/01/02", "price": None, "area_m2": "10", "ppm": None},
                                    {"ref": None, "date": "2026/01/02"}, {"ref": "x2", "date": None}], "t")
    if skipped != 2 or len(kept) != 1 or kept[0]["price"] is not None:
        out.append(f"archive_rows: kept {kept}, skipped {skipped}; want one row, price NULL (never invented), two skipped")
    return out


def check_deal_rows(m) -> list[str]:
    """Every deal of a MATCHED district rides into moj_district_deals with the ministry's own date, m², price and
    per-deal m² price (owner 2026-10-16: «the exact same transactions»); nothing for an unmatched or ambiguous
    area, nothing outside the window, nothing half-known, and the m² price is never recomputed here."""
    out = []
    w = World(missing_deal=None)
    m.MIN_GROUPS = 1
    try:
        got = m.fetch(ministry(m, w))
    except m.SourceChanged as e:   # a per-deal read that no longer matches the ministry's recorded answer refuses to run: caught
        return [f"fetch refused: {str(e)[:80]}"]
    if not {"date", "area_m2", "ppm"} <= set(w.last_names):
        out.append(f"the per-deal read no longer asks for date / m² / m² price: {w.last_names}")
    at = "2026-10-16T00:00:00+00:00"
    rows = m.deal_table_rows(got["deal_rows"], got["aggs"], OURS, at)
    got_refs: dict = {}
    for r in rows:
        got_refs.setdefault((r["city_ar"], r["district_ar"], r["property_class"]), []).append(r["deal_ref"])
    want = {("الرياض", "حي الرمال", "سكني"): ["r1", "r2", "r3", "r4"], ("الرياض", "حي النرجس", "سكني"): ["n1", "n2"],
            ("جدة", "حي الحمراء", "تجاري"): ["h1"], ("عفيف", "حي الورود", "سكني"): ["a1"]}
    if {k: sorted(v) for k, v in got_refs.items()} != want:
        out.append(f"deal rows per matched district {got_refs} ≠ {want} (an unmatched/ambiguous area, a زراعي deal, or r0 outside the window got in — or a matched one is missing)")
    r1 = next((r for r in rows if r["deal_ref"] == "r1"), None)
    if r1 != {"moj_region": RIY, "moj_area": "الرياض/الرمال", "property_class": "سكني", "deal_ref": "r1", "deal_date": "2025-09-20",
              "area_m2": "300", "price": "1000000.00", "ppm": "3333.33", "city_ar": "الرياض", "district_ar": "حي الرمال", "fetched_at": at}:
        out.append(f"r1 as stored: {r1}")
    base = {"region": RIY, "area": "الرياض/الرمال", "cls": "سكني", "ref": "z1", "price": 1000, "date": "2026/01/05", "area_m2": 10, "ppm": "777"}
    def one(**kw):
        try:
            return m.deal_table_rows([{**base, **kw}], got["aggs"], OURS, at)
        except Exception as e:   # one bad deal must never crash the run — and a mutant that crashes is caught, not skipped
            return [{"deal_ref": "z1", "ppm": f"raised {type(e).__name__}"}]
    if [r["ppm"] for r in one()] != ["777.00"]:
        out.append(f"the m² price must be the ministry's own column, never price ÷ area: {one()}")
    for kw in ({"date": None}, {"date": "soon"}, {"ref": None}, {"price": None}, {"area_m2": None}, {"area_m2": 0}, {"ppm": None}, {"ppm": "x"}):
        if one(**kw):
            out.append(f"a half-known deal was written: {kw}")
    if one(area="الرياض/مجهول") or one(area="الرياض/الملقا", cls="تجاري") or one(cls="زراعي"):
        out.append("a deal of an unmatched / ambiguous area or of a class we do not store was written")
    return out


CHECKS = [check_truth, check_window, check_ppm, check_matching, check_spread, check_partial, check_monitor, check_deal_rows,
          check_archive]

TRANSLATE = '.translate(str.maketrans({"ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي"}))'
NORM_BODY = '    s = (s or "")' + TRANSLATE + '\n    return _HAY.sub("", re.sub(r"\\s+", " ", s).strip())'
NORM_BODY_STRIP_FIRST = '    s = _HAY.sub("", (s or "").strip())' + TRANSLATE + '\n    return re.sub(r"\\s+", " ", s).strip()'

# ── mutants: the real source with one line changed; each must turn at least one named check red ──────
MUTANTS = [
    ("deals of an ambiguous / unmatched area written", check_deal_rows,
     'if not hit or hit[0] != "matched":', "if not hit:"),
    ("per-deal m² price recomputed as price ÷ area", check_deal_rows,
     'area_m2, price, ppm = Decimal(str(r["area_m2"])), money(r["price"]), money(r["ppm"])',
     'area_m2, price, ppm = Decimal(str(r["area_m2"])), money(r["price"]), money(Decimal(str(r["price"])) / Decimal(str(r["area_m2"])))'),
    ("a deal without a date written", check_deal_rows,
     'if d is None or r.get("ref") is None', 'if r.get("ref") is None'),
    ("the per-deal read dropping the ministry's own m² price", check_deal_rows,
     '("date", col("تاريخ الصفقة ميلادي")), ("area_m2", col("المساحة")), ("ppm", mea("سعر المتر المربع"))],',
     '("date", col("تاريخ الصفقة ميلادي")), ("area_m2", col("المساحة"))],'),
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
    ("archive keeps only the card's two classes (farm dropped)", check_archive,
     "            [on_or_after(DATE, start), on_or_before(DATE, end)])\n        if complete:",
     "            [on_or_after(DATE, start), on_or_before(DATE, end), is_in(\"تصنيف العقار\", CLASSES)])\n        if complete:"),
    ("archive accepts a read short of the ministry's count", check_archive, "    if why:\n", "    if False:\n"),
    ("archive overlap removed (late registrations lost)", check_archive,
     "date.fromisoformat(stored_max) - timedelta(days=ARCHIVE_OVERLAP_DAYS)", "date.fromisoformat(stored_max)"),
    ("archive backfill reads only the card's 12 months", check_archive,
     "        return first, anchor\n", "        return window(date.fromisoformat(anchor))[0].isoformat(), anchor\n"),
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
