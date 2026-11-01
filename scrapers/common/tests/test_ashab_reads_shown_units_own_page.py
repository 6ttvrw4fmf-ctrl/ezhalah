"""ashab: a unit we SHOW whose building card turned rented/sold is read on its OWN page (2026-10-17).

Skipped from the card alone, its page was never read, db.note_read_gone never fired and the prune's
own-page oracle saw only a 200: 6 of 12 struck-but-shown units were rented/sold on their own badge
(spot-check 39028760960)."""
import pytest

import scrapers.ashab.run as R
from scrapers.common import db
from scrapers.common.tests.test_ashab_limit_units_and_skips import _card, _page

B = "https://ashab.sa/properties/"


@pytest.fixture
def crawl(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (11, 4) if c == "بريدة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    monkeypatch.setattr(R, "retry_smarter_session", lambda url, timeout=40: (object(), ["direct"]))
    monkeypatch.setattr(R, "walk", lambda s: ["1023"])
    for name in ("upsert_ashab_residential_batch", "upsert_ashab_commercial_batch"):
        monkeypatch.setattr(db, name, lambda rows: None)
    monkeypatch.setattr(db, "begin_run", lambda slug: 1)
    monkeypatch.setattr(db, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(db, "prune_unseen", lambda *a, **k: 0)
    monkeypatch.setattr(db, "strike_read_gone", lambda *a, **k: 0)
    monkeypatch.setattr(db, "_READ_GONE", {})
    monkeypatch.setattr(R.sys, "argv", ["run"])
    read: list[str] = []

    def run(building_status, cards, unit_pages, known):
        pages = {f"{B}1023": _page(status=building_status,
                                   units='<h6 class="mt-10"><b>الوحدات العقارية</b></h6>' + "".join(cards))}
        pages.update(unit_pages)

        def get(s, url):
            read.append(url)
            return pages[url]
        monkeypatch.setattr(R, "get", get)
        monkeypatch.setattr(R, "_known_active", lambda: set(known))
        assert R.main() == 0
        return read
    return run


def test_a_shown_unit_whose_card_says_rented_is_read_and_its_own_badge_recorded(crawl):
    read = crawl("متاح جزئي", [_card("مؤجر", 1750), _card("مؤجر", 1751)],
                 {f"{B}1023/unit/1750": _page(status="مؤجر", unit_page=True)},
                 known={"ASB1023-U1750"})
    assert f"{B}1023/unit/1750" in read and f"{B}1023/unit/1751" not in read   # only what we show
    assert db._READ_GONE == {"ASB1023-U1750": "مؤجر"}


def test_a_closed_building_still_never_yields_a_row_but_its_shown_units_are_read(crawl, monkeypatch):
    rows = []
    monkeypatch.setattr(db, "upsert_ashab_residential_batch", lambda r: rows.extend(r))
    crawl("مؤجر بالكامل", [_card("متاح", 1), _card("مؤجر", 2)],
          {f"{B}1023/unit/1": _page(unit_page=True), f"{B}1023/unit/2": _page(status="مباع", unit_page=True)},
          known={"ASB1023-U1", "ASB1023-U2"})
    assert rows == [] and db._READ_GONE == {"ASB1023-U2": "مباع"}
