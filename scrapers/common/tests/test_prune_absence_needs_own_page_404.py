"""prune_unseen with no oracle: absence never hides on its own (2026-10-09).

A caller that passed no verify_gone used to deactivate a row on three crawl misses alone. On
2026-10-09 abwbna and shomou hid 4 rows that way with no source reading (P1 unknown_treated_as_dead),
and 46 sites in scrapers/absence-only-prune.txt still could. LISTING_LIVENESS.md §1-§3: absence is a
candidate signal; only the ad's OWN page may kill. Such a row is now hidden only when its stored URL
answers 404/410 while a page this crawl just saw answers live; anything else holds the strike.
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db  # noqa: E402

ACTIVE = ([{"ad_number": f"D{i}", "missing_count": 2} for i in range(3)]
          + [{"ad_number": f"L{i}", "missing_count": 0} for i in range(20)])
SEEN = {f"L{i}" for i in range(20)}
URL = {r["ad_number"]: f"https://src.example/ad/{r['ad_number']}" for r in ACTIVE}
ROW_EXTRA: dict = {}


class _Q:
    def __init__(self, sink, table):
        self.sink, self.table_name, self.payload, self.want = sink, table, None, None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        if col == "ad_number":
            self.want = val
        return self

    def limit(self, *_a, **_k):
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def insert(self, rows):
        self.sink.append(("insert", self.table_name, rows))
        return self

    def in_(self, _col, ads):
        self.sink.append(("update", self.table_name, dict(self.payload), list(ads)))
        return self

    def execute(self):
        if self.want is not None:
            return types.SimpleNamespace(data=[{"listing_url": URL.get(self.want),
                                                **ROW_EXTRA.get(self.want, {})}])
        return types.SimpleNamespace(data=ACTIVE)


class _Resp:
    def __init__(self, status, url):
        self.status_code, self.url, self.text = status, url, "<html>page</html>"


class _Session:
    def __init__(self, dead_status=404, control_status=200, dead_lands=None):
        self.dead_status, self.control_status, self.dead_lands = dead_status, control_status, dead_lands
        self.calls: list[str] = []

    def get(self, url, timeout=None, allow_redirects=True):
        self.calls.append(url)
        if "/ad/D" in url:
            return _Resp(self.dead_status, self.dead_lands or url)
        return _Resp(self.control_status, url)


def _run(monkeypatch, session):
    sink: list = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda n: _Q(sink, n)))
    monkeypatch.setattr(db, "_execute", lambda q, what=None: q.execute())
    monkeypatch.setattr(db, "_own_page_session", lambda: session)
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    killed = db.prune_unseen("x_residential_listings", SEEN, source="X")
    kills = [a for k, *rest in sink if k == "update" for _t, p, a in [rest] if p.get("active") is False
             for a in a]
    evidence = [r for k, _t, rows in [s for s in sink if s[0] == "insert"] for r in rows]
    return killed, sorted(kills), evidence


def test_own_page_404_with_a_live_control_hides_with_evidence(monkeypatch):
    killed, kills, ev = _run(monkeypatch, _Session())
    assert killed == 3 and kills == ["D0", "D1", "D2"]
    assert {e["verdict"] for e in ev} == {"GONE"} and len(ev) == 3
    assert all(e["note"].startswith(db.OWN_PAGE_ORACLE) for e in ev)


def test_absence_with_a_live_own_page_never_hides(monkeypatch):
    killed, kills, ev = _run(monkeypatch, _Session(dead_status=200))
    assert killed == 0 and kills == []
    assert {e["verdict"] for e in ev} == {"UNKNOWN"}, "a 200 is no opinion here, never a death"


def test_a_source_that_404s_its_live_controls_hides_nothing(monkeypatch):
    killed, kills, _ = _run(monkeypatch, _Session(control_status=404))
    assert killed == 0 and kills == []


def test_blocked_or_redirected_reads_hide_nothing(monkeypatch):
    for s in (_Session(dead_status=403), _Session(dead_status=503),
              _Session(dead_status=404, dead_lands="https://src.example/")):
        killed, kills, _ = _run(monkeypatch, s)
        assert killed == 0 and kills == [], s.__dict__


def test_a_caller_oracle_is_still_used_as_given(monkeypatch):
    sink: list = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda n: _Q(sink, n)))
    monkeypatch.setattr(db, "_execute", lambda q, what=None: q.execute())
    monkeypatch.setattr(db, "_own_page_session", lambda: (_ for _ in ()).throw(AssertionError("used")))
    assert db.prune_unseen("x_residential_listings", SEEN, verify_gone=lambda ad: "gone") == 3


def test_the_read_budget_holds_the_rest_unknown(monkeypatch):
    monkeypatch.setattr(db, "_OWN_PAGE_MAX_READS", 2)
    killed, kills, ev = _run(monkeypatch, _Session())
    assert killed == 2 and len(kills) == 2
    held = [e for e in ev if e["verdict"] == "UNKNOWN"]
    assert len(held) == 1 and "read budget" in held[0]["note"]


def test_a_passed_published_end_date_is_the_sources_own_word(monkeypatch):
    # shomou / earthapp, 2026-10-09: the list drops an ad past its own end date while its page still
    # answers 200. The stored end date the source printed is the evidence; a future or missing one is not.
    monkeypatch.setattr(sys.modules[__name__], "ROW_EXTRA", {
        "D0": {"additional_info": {"ad_end_date": "2026-09-30"}},
        "D1": {"license_expiry": "2026-10-01"},
        "D2": {"additional_info": {"ad_end_date": "2099-12-31"}}})
    killed, kills, ev = _run(monkeypatch, _Session(dead_status=200))
    assert kills == ["D0", "D1"] and killed == 2
    gone = {e["ad_number"]: e["note"] for e in ev if e["verdict"] == "GONE"}
    assert set(gone) == {"D0", "D1"} and all("published end date" in n for n in gone.values())


# ── 2026-10-09 (backlog 300): a crawl that READ an ad sold/rented records it; that is not absence ──
def test_note_read_gone_records_only_sold_or_rented(monkeypatch):
    monkeypatch.setattr(db, "_READ_GONE", {})
    assert db.note_read_gone("A1", "مباع بالكامل") and db.note_read_gone("A2", "تم التأجير")
    for status in ("محجوز", "قريبا", "", None, "متاح"):
        assert not db.note_read_gone("A3", status), status
    assert not db.note_read_gone(None, "مباع")
    assert set(db._READ_GONE) == {"A1", "A2"}


def test_a_crawl_read_sold_hides_even_when_the_page_answers_200(monkeypatch):
    monkeypatch.setattr(db, "_READ_GONE", {"D0": "مباع"})
    killed, kills, ev = _run(monkeypatch, _Session(dead_status=200))
    assert kills == ["D0"] and killed == 1
    assert [e["note"] for e in ev if e["verdict"] == "GONE"] == [f"{db.OWN_PAGE_ORACLE}: its own page read «مباع» this run"]


def test_the_crawlers_that_drop_sold_ads_record_the_reading(monkeypatch):
    from scrapers.ashab import run as ashab
    from scrapers.ryadah import run as ryadah
    from scrapers.wajaf import run as wajaf
    monkeypatch.setattr(db, "_READ_GONE", {})
    got = ashab.map_page({"badges": ["للبيع", "مباع"], "title": "", "description": "", "spec": {}},
                         "123", "https://x/properties/123")
    assert got[0] is None and db._READ_GONE.get(f"{ashab.PREFIX}123") == "مباع"
    got = ryadah.map_property({"id": 5}, {"status": "تم البيع"}, [])
    assert got[0] is None and db._READ_GONE.get(f"{ryadah.PREFIX}5") == "تم البيع"
    got = wajaf.map_page({"units": [], "badges": ["مؤجر"], "url": "https://x/unit/77"})
    assert got[0] is None and db._READ_GONE.get(f"{wajaf.PREFIX}U77") == "مؤجر"
    ashab.map_page({"badges": ["للبيع", "محجوز"], "title": "", "description": "", "spec": {}}, "9", "u")
    assert f"{ashab.PREFIX}9" not in db._READ_GONE, "reserved is not a removal"
