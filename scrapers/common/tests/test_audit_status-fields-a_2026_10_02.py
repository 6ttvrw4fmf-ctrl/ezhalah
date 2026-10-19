"""Crawler audit 2026-10-02, group «status fields A»: the source's own availability fields decide.

Owner: «just because you didn't see something doesn't mean it's dead — check the ad's own page to
confirm; if it is removed, remove it». Each crawler here read a feed that publishes its own
availability fields and wrote every item as an active listing without looking at them.

  opensooq  is_active (False on the archived page of both ads the SERP dropped) + the ad's end date
  dallali   the storefront's own rule: is_active, and expires_at not in the past; + the licence end date
  muajarh   the ad licence's end date; a status value nobody has ever seen is KEPT and COUNTED
  squares   a status term nobody has ever seen is KEPT and COUNTED with the page's own word

Every fixture is synthetic: no real ad, name, phone or licence.
"""
import sys

import pytest

import scrapers.dallali.run as DALLALI
import scrapers.muajarh.run as MUAJARH
import scrapers.opensooq.run as OPENSOOQ
import scrapers.squares.run as SQUARES


class _FakeDb:
    """Stands in for scrapers.common.db inside one crawler's main(): records, writes nothing."""

    def __init__(self):
        self.upserted: list[str] = []
        self.unproven: list[str] = []      # rows the crawler wrote but refused to vouch for (2026-10-03)
        self.prunes = 0

    def mark_presence_unproven(self, row):
        self.unproven.append(row["ad_number"])
        return row

    def begin_run(self, slug):
        return 1

    def end_run(self, *a, **k):
        return True

    def retire_superseded_siblings(self, **k):
        return 0

    def prune_unseen(self, table, seen, source=None, **k):
        self.prunes += 1
        return 0

    def __getattr__(self, name):
        if name.startswith("upsert_"):
            return lambda rows: self.upserted.extend(r["ad_number"] for r in rows)
        raise AttributeError(name)


def _run(monkeypatch, mod):
    fake = _FakeDb()
    monkeypatch.setattr(mod, "db", fake)
    monkeypatch.setattr(mod, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(mod, "find_district_in_text", lambda t, cid: None)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    assert mod.main() == 0
    return fake


# ── opensooq ────────────────────────────────────────────────────────────────────────────────────
def _osq(i, **kw):
    x = {"id": i, "cat1_code": "RealEstateForSale", "cat2_code": "ApartmentsForSale", "title": "شقة للبيع",
         "price_amount": "500,000 ريال", "city_label": "الرياض", "nhood_label": "النزهة", "cps": [],
         "is_active": True, "listing_status": "posted", "expired_at": "29-11-2099"}
    x.update(kw)
    return x


def test_opensooq_reads_the_items_own_availability():
    assert OPENSOOQ.unavailable(_osq(1)) == ""
    assert OPENSOOQ.unavailable(_osq(1, is_active=False)) == "inactive_at_source"
    assert OPENSOOQ.unavailable(_osq(1, expired_at="01-01-2020")) == "ad_end_date_expired"
    assert OPENSOOQ.unavailable(_osq(1, expired_at="قبل 17 ساعة")) == ""       # sign lost: unknown, kept
    x = _osq(1)
    del x["is_active"]
    assert OPENSOOQ.unavailable(x) == "status_unreadable"


def test_opensooq_never_upserts_an_inactive_or_expired_item(monkeypatch, capsys):
    items = [_osq(1), _osq(2, is_active=False), _osq(3, expired_at="01-01-2020"), _osq(4, listing_status="paused")]
    monkeypatch.setattr(OPENSOOQ, "walk", lambda s: (items, len(items)))
    fake = _run(monkeypatch, OPENSOOQ)
    assert sorted(fake.upserted) == ["OSQ1", "OSQ4"] and fake.prunes == 1
    assert fake.unproven == ["OSQ4"]                  # kept, counted, and not stamped as checked
    out = capsys.readouterr().out
    assert "inactive_at_sourcex1" in out and "ad_end_date_expiredx1" in out
    assert "listing_status_pausedx1" in out          # a word never measured: kept, and said out loud


def test_opensooq_an_unreadable_status_is_neither_written_nor_pruned(monkeypatch):
    unread = _osq(2)
    del unread["is_active"]
    monkeypatch.setattr(OPENSOOQ, "walk", lambda s: ([_osq(1), unread], 2))
    fake = _run(monkeypatch, OPENSOOQ)
    assert fake.upserted == ["OSQ1"] and fake.prunes == 0


def test_opensooq_an_end_date_it_cannot_read_is_kept_and_counted(monkeypatch, capsys):
    # measured 2026-10-02: 5 of 77 live ads carry a relative phrase in expired_at — never a gate, never silent
    items = [_osq(1), _osq(2, expired_at=None), _osq(3, expired_at="قبل 17 ساعة")]
    monkeypatch.setattr(OPENSOOQ, "walk", lambda s: (items, len(items)))
    fake = _run(monkeypatch, OPENSOOQ)
    assert sorted(fake.upserted) == ["OSQ1", "OSQ2", "OSQ3"] and fake.prunes == 1
    assert "expired_at_not_a_datex2" in capsys.readouterr().out


# ── dallali ─────────────────────────────────────────────────────────────────────────────────────
def _dll(i="a1", **kw):
    x = {"id": i, "is_active": True, "expires_at": None, "listing_type": "rent", "title": "مكتب", "description": "",
         "price": 90000, "unit": {"unit_type": "office", "area": 80},
         "rega_display_data": {"advertisementType": "إيجار", "endDate": "04/08/2099",
                               "location": {"city": "الرياض", "district": "الربيع"}}}
    x.update(kw)
    return x


@pytest.fixture
def _dallali_catalog(monkeypatch):
    monkeypatch.setattr(DALLALI, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(DALLALI, "find_district_in_text", lambda t, cid: None)


def test_dallali_applies_the_storefronts_own_expiry_rule(_dallali_catalog):
    assert DALLALI.map_listing(_dll())[1] == ""
    assert DALLALI.map_listing(_dll(expires_at="2099-01-01T00:00:00.000Z"))[1] == ""
    assert DALLALI.map_listing(_dll(expires_at="2001-01-01T00:00:00.000Z")) == (None, "expired_at_source")
    assert DALLALI.map_listing(_dll(expires_at="2001-01-01T00:00:00")) == (None, "expired_at_source")
    assert DALLALI.map_listing(_dll(is_active=False)) == (None, "inactive")
    lapsed = _dll()
    lapsed["rega_display_data"]["endDate"] = "04/08/2016"
    assert DALLALI.map_listing(lapsed) == (None, "ad_licence_expired")


def test_dallali_an_unreadable_status_is_neither_written_nor_pruned(monkeypatch):
    assert DALLALI.map_listing(_dll(is_active=None)) == (None, "status_unreadable")
    assert DALLALI.map_listing(_dll(expires_at="soon")) == (None, "status_unreadable")
    monkeypatch.setattr(DALLALI, "walk", lambda s: ([_dll("a1"), _dll("a2", expires_at="soon")], 2))
    fake = _run(monkeypatch, DALLALI)
    assert fake.upserted == ["DLLa1"] and fake.prunes == 0


def test_dallali_a_licence_end_date_it_cannot_read_is_kept_and_counted(monkeypatch, capsys):
    rows = [_dll("a1"), _dll("a2"), _dll("a3")]
    rows[1]["rega_display_data"] = dict(rows[1]["rega_display_data"], endDate=None)
    rows[2]["rega_display_data"] = dict(rows[2]["rega_display_data"], endDate="1449/02/28")     # Hijri year
    monkeypatch.setattr(DALLALI, "walk", lambda s: (rows, len(rows)))
    fake = _run(monkeypatch, DALLALI)
    assert sorted(fake.upserted) == ["DLLa1", "DLLa2", "DLLa3"]
    assert "licence_end_date_unreadx2" in capsys.readouterr().out


# ── muajarh ─────────────────────────────────────────────────────────────────────────────────────
def _mjr(i, **kw):
    x = {"id": i, "slug": f"s{i}", "adv_license": "7200000000", "listing_type": "rent", "title": "فيلا",
         "price": "100000.00", "rent_duration_label_ar": "سنوي", "city": "الرياض", "district": "العارض",
         "category": {"nameEn": "villas", "nameAr": "فلل"}, "parameters": [],
         "status": True, "request_status": "approved", "state": None, "adv_license_expire_date": "2099-03-02"}
    x.update(kw)
    return x


def test_muajarh_a_lapsed_licence_is_out_and_an_unseen_status_is_kept_and_counted(monkeypatch, capsys):
    rows = [_mjr(1), _mjr(2, adv_license_expire_date="2016-03-02"), _mjr(3, status=False),
            _mjr(4, request_status="pending")]
    monkeypatch.setattr(MUAJARH, "walk", lambda s: (rows, len(rows)))
    monkeypatch.setattr(MUAJARH, "get_json", lambda s, url: {"data": next(r for r in rows if url.endswith("/" + r["slug"]))})
    fake = _run(monkeypatch, MUAJARH)
    assert sorted(fake.upserted) == ["MJR1", "MJR3", "MJR4"]
    assert sorted(fake.unproven) == ["MJR3", "MJR4"]  # kept, counted, and not stamped as checked
    out = capsys.readouterr().out
    assert "ad_licence_expiredx1" in out
    assert "status_Falsex1" in out and "request_status_pendingx1" in out


def test_muajarh_a_licence_end_date_it_cannot_read_is_kept_and_counted(monkeypatch, capsys):
    rows = [_mjr(1), _mjr(2, adv_license_expire_date=None), _mjr(3, adv_license_expire_date="1448-09-13")]
    monkeypatch.setattr(MUAJARH, "walk", lambda s: (rows, len(rows)))
    monkeypatch.setattr(MUAJARH, "get_json", lambda s, url: {"data": next(r for r in rows if url.endswith("/" + r["slug"]))})
    fake = _run(monkeypatch, MUAJARH)
    assert sorted(fake.upserted) == ["MJR1", "MJR2", "MJR3"]
    assert "adv_license_expire_date_unreadx2" in capsys.readouterr().out


# ── squares ─────────────────────────────────────────────────────────────────────────────────────
def _sqr(i, status_term, label):
    rec = {"id": i, "link": f"https://example.invalid/property/{i}/", "title": {"rendered": "فيلا بحي النزهة للبيع"},
           "content": {"rendered": ""}, "class_list": ["property_type-136", f"property_status-{status_term}"]}
    page = (f'<a href="https://example.invalid/property_type/villa/">فيلا</a>'
            f'<div class="price-area"> <span class="status"> {label} </span> <span class="price "> ريال900,000 </span></div>')
    return rec, page


def test_squares_a_status_term_never_measured_is_kept_and_counted_with_the_pages_own_word(monkeypatch, capsys):
    posts = [_sqr(1, "90", "ل للبيع"), _sqr(2, "91", "مباع")]
    monkeypatch.setattr(SQUARES, "walk_session", lambda: object())
    monkeypatch.setattr(SQUARES, "fetch_catalogue", lambda s: ([r for r, _ in posts], len(posts)))
    monkeypatch.setattr(SQUARES, "fetch_pages", lambda s, rows: {str(r["id"]): p for r, p in posts})
    monkeypatch.setattr(SQUARES, "stated_city", lambda text: (None, None, None))
    fake = _run(monkeypatch, SQUARES)
    assert sorted(fake.upserted) == ["SQR1", "SQR2"]
    assert fake.unproven == ["SQR2"]                  # kept, counted, and not stamped as checked
    out = capsys.readouterr().out
    assert "status_term_91_مباعx1" in out and "status_term_90" not in out
