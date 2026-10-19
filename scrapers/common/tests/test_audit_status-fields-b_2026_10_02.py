"""Crawler audit 2026-10-02, group status-fields-b: satel, ramzalqasim, mizlaj, wahadat.

THE HOLE. Each of these sources publishes its own availability field, and each crawler either
ignored it or read it through a DENYLIST — so a state the crawler had never seen (Sold, Reserved,
in_prograss, a blank, is_sold=true, a project with is_active=false) was upserted ACTIVE every run.

THE RULE THESE TESTS PIN. Only a value MEASURED to mean "on the market" may be written active:
    satel        status == "Available"              (live feed 2026-10-02: Available 66, Rented out 167)
    ramzalqasim  avalible == "available"            (available 151, sold 42, under_construction 3,
                                                     in_prograss 2)
    mizlaj       is_sold False, is_reserved False,  (34 of 34 listing pages)
                 deleted_at null
    wahadat      project is_active is True          (72 of 72 project pages read)
A confirmed gone value keeps its existing handling. Everything else is HELD: not upserted (so never
re-asserted alive), never declared gone (an unknown is not a NO), and counted in the run's notes.
For the three crawlers whose prune has no per-listing oracle the held ids stay in the prune's
seen-set, so absence logic cannot age out a row the source still lists — but only in the seen-set of
the table they belong to: a held residential id must not make the commercial table's seen-set
non-empty, or prune_unseen's 0-seen circuit breaker is bypassed. And an unreadable status
source fails closed: nothing is written and the run is marked failed.

Every fixture below is synthetic and minimal — no real ad, name, phone or licence.
main() is driven end to end with the network and the database replaced, because the hole is in
what main() WRITES, not in a helper.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.mizlaj import run as mizlaj  # noqa: E402
from scrapers.ramzalqasim import run as ramz  # noqa: E402
from scrapers.satel import run as satel  # noqa: E402
from scrapers.wahadat import run as wahadat  # noqa: E402


class FakeDb:
    """Stands in for scrapers.common.db (and sold_pin): records every call, writes nothing."""

    def __init__(self):
        self.calls: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name):
        def call(*a, **k):
            self.calls.append((name, a, k))
            return {"begin_run": 1, "end_run": True}.get(name, 0)
        return call

    def upserted(self) -> dict[str, dict]:
        return {r["ad_number"]: r for n, a, _ in self.calls if n.startswith("upsert_") for r in a[0]}

    def pruned_seen(self) -> set[str]:
        return set().union(*[set(a[1]) for n, a, _ in self.calls if n == "prune_unseen"] or [set()])

    def prune_seen_by_table(self) -> dict[str, set[str]]:
        return {a[0]: set(a[1]) for n, a, _ in self.calls if n == "prune_unseen"}

    def end(self) -> dict:
        return [k for n, _, k in self.calls if n == "end_run"][-1]


@pytest.fixture
def fake(monkeypatch):
    f = FakeDb()
    for mod in (satel, ramz, mizlaj, wahadat):
        monkeypatch.setattr(mod, "db", f)
    for mod in (satel, ramz):
        monkeypatch.setattr(mod, "sold_pin", f)
    monkeypatch.setattr(sys, "argv", ["run"])
    return f


# ── satel ────────────────────────────────────────────────────────────────────────────────────────
def _satel_item(pnum: str, **over) -> dict:
    return {"propertyNumber": pnum, "type": "Rent", "catName": "Residential", "subCatName": "Apartments",
            "price": 50000, "priceGroup": "Yearly", "cityEn": "Riyadh", **over}


def _run_satel(monkeypatch, items) -> int:
    monkeypatch.setattr(satel, "fetch_all", lambda s: (items, len(items)))
    monkeypatch.setattr(satel, "_fetch_detail", lambda s, pnum: None)
    return satel.main()


def test_satel_only_a_measured_available_status_is_written_active(fake, monkeypatch):
    rc = _run_satel(monkeypatch, [
        _satel_item("T1", status="Available"),
        _satel_item("T2", status="Rented out"),
        _satel_item("T3", status="Sold"),          # never measured on this source
        _satel_item("T4"),                         # no status at all
    ])
    up = fake.upserted()
    assert rc == 0
    assert up["STT1"]["active"] is True and up["STT2"]["active"] is False
    assert "STT3" not in up and "STT4" not in up, "an unmeasured status must not be written at all"
    assert {"STT3", "STT4"} <= fake.pruned_seen(), "a held row is still IN the feed — never aged out"
    assert "Sold" in fake.end()["notes"] and "(blank)" in fake.end()["notes"]


def test_satel_fails_closed_when_no_row_states_a_known_status(fake, monkeypatch):
    rc = _run_satel(monkeypatch, [_satel_item("T1"), _satel_item("T2")])
    assert rc == 1 and fake.upserted() == {} and fake.pruned_seen() == set()
    assert fake.end()["ok"] is False


def test_satel_held_residential_id_never_enters_the_commercial_seen_set(fake, monkeypatch):
    # No commercial row in the feed → the commercial prune must get an EMPTY seen-set, which is what
    # trips prune_unseen's "0 scraped → keep everything active" breaker. A held residential id
    # leaking in would get past it and strike every commercial row on absence alone.
    assert _run_satel(monkeypatch, [_satel_item("T1", status="Available"),
                                    _satel_item("T3", status="Sold")]) == 0
    seen = fake.prune_seen_by_table()
    assert seen["satel_commercial_listings"] == set()
    assert seen["satel_residential_listings"] == {"STT1", "STT3"}


# ── ramzalqasim ──────────────────────────────────────────────────────────────────────────────────
def _marker(rid: int, **over) -> dict:
    return {"id": rid, "type": "villa", "status": "sell", "price": "500000.00", "area": 300,
            "city": "عنيزة", "district": "الحي التجريبي", **over}


def test_ramzalqasim_only_available_is_written_active(fake, monkeypatch):
    monkeypatch.setattr(ramz, "fetch_markers", lambda s: [
        _marker(1, avalible="available"),
        _marker(2, avalible="sold"),
        _marker(3, avalible="in_prograss"),        # measured, but nobody knows what it means
        _marker(4),                                # blank
        _marker(5, avalible="reserved"),           # never measured on this source
    ])
    rc = ramz.main()
    up = fake.upserted()
    assert rc == 0
    assert up["RQ1"]["active"] is True and up["RQ2"]["active"] is False
    assert not {"RQ3", "RQ4", "RQ5"} & set(up), "an unclassified availability must not be written"
    assert {"RQ3", "RQ4", "RQ5"} <= fake.pruned_seen()
    assert "in_prograss" in fake.end()["notes"] and "reserved" in fake.end()["notes"]


def test_ramzalqasim_fails_closed_when_the_field_is_gone_from_the_feed(fake, monkeypatch):
    monkeypatch.setattr(ramz, "fetch_markers", lambda s: [_marker(1), _marker(2)])
    assert ramz.main() == 1 and fake.upserted() == {} and fake.pruned_seen() == set()
    assert fake.end()["ok"] is False


def test_ramzalqasim_held_residential_id_never_enters_the_commercial_seen_set(fake, monkeypatch):
    monkeypatch.setattr(ramz, "fetch_markers", lambda s: [_marker(1, avalible="available"),
                                                          _marker(3, avalible="in_prograss")])
    assert ramz.main() == 0
    seen = fake.prune_seen_by_table()
    assert seen["ramzalqasim_commercial_listings"] == set()
    assert seen["ramzalqasim_residential_listings"] == {"RQ1", "RQ3"}


# ── mizlaj ───────────────────────────────────────────────────────────────────────────────────────
def _page(lid: int, **over) -> dict:
    return {"id": lid, "slug": f"s{lid}", "name": "فيلا للبيع", "total_price": 500000,
            "advertisement_type": "Sell", "is_sold": False, "is_reserved": False, "deleted_at": None,
            **over}


def _run_mizlaj(monkeypatch, pages: dict) -> int:
    # map-data mode: the LIST record carries id + price, so a row can be built without the page.
    monkeypatch.setattr(mizlaj, "fetch_map_data", lambda s: [
        {"id": int(slug[1:]), "slug": slug, "name": "فيلا للبيع", "total_price": 500000} for slug in pages])
    monkeypatch.setattr(mizlaj, "fetch_detail", lambda s, slug: pages[slug])
    return mizlaj.main()


def test_mizlaj_reads_the_pages_own_sold_reserved_deleted_flags(fake, monkeypatch):
    flagless = {k: v for k, v in _page(6).items() if k != "is_sold"}
    rc = _run_mizlaj(monkeypatch, {
        "s1": _page(1),
        "s2": _page(2, is_sold=True),
        "s3": _page(3, is_reserved=True),
        "s4": _page(4, deleted_at="2026-10-01T00:00:00Z"),
        "s5": None,                                # page unreadable — the list record must not stand in
        "s6": flagless,                            # the flag vanished from the page
    })
    assert rc == 0
    assert set(fake.upserted()) == {"MZ1"} and fake.upserted()["MZ1"]["active"] is True
    notes = fake.end()["notes"]
    for reason in ("is_sold", "is_reserved", "deleted_at", "page_unreadable", "is_sold_missing"):
        assert reason in notes, f"{reason} must be counted in the run notes, got {notes!r}"


def test_mizlaj_fails_closed_when_no_page_states_the_flags(fake, monkeypatch):
    rc = _run_mizlaj(monkeypatch, {"s1": None, "s2": {"id": 2, "slug": "s2", "total_price": 1}})
    assert rc == 1 and fake.upserted() == {} and fake.end()["ok"] is False
    assert not any(n == "prune_unseen" for n, _, _ in fake.calls)


# ── wahadat ──────────────────────────────────────────────────────────────────────────────────────
def _run_wahadat(monkeypatch, projects: dict) -> int:
    class _Resp:
        status_code, text = 200, ""

    class _Sess:
        def get(self, url, **kw):
            return _Resp()

    urls = [f"https://wahadat.sa/project/{slug}" for slug in projects]
    seq = iter(projects.items())

    def parse(html, url):
        slug, flag = next(seq)
        proj = {"name_ar": "مشروع تجريبي", "types": ["شقة"],     # no city: no catalog lookup
                "advertisement_purpose": "sale", "url": url, **flag}
        return proj, [{"id": f"{slug}-0000-0000-0000", "status": "available", "price": 500000, "area": 100}]

    monkeypatch.setattr(wahadat.cc, "Session", _Sess)
    monkeypatch.setattr(wahadat, "sitemap_projects", lambda sess: urls)
    monkeypatch.setattr(wahadat, "parse_project", parse)
    return wahadat.main()


def test_wahadat_units_of_a_project_not_flagged_active_are_held(fake, monkeypatch):
    rc = _run_wahadat(monkeypatch, {"aaaa": {"is_active": True}, "bbbb": {"is_active": False}, "cccc": {}})
    up = fake.upserted()
    assert rc == 0
    assert set(up) == {"WHDaaaa00000000"}, f"only the is_active=true project's unit is written, got {set(up)}"
    assert {"WHDbbbb00000000", "WHDcccc00000000"} <= fake.pruned_seen()
    assert fake.end()["notes"] == "held_project_not_active=2"


def test_wahadat_fails_closed_when_no_project_states_is_active(fake, monkeypatch):
    with pytest.raises(RuntimeError):
        _run_wahadat(monkeypatch, {"aaaa": {}, "bbbb": {}})
    assert fake.upserted() == {} and fake.end()["ok"] is False
