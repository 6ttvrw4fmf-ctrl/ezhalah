"""alsaedan: the unit page's own spec cell «مطبخ N» answers kitchen (backlog 513).

CI source-reread 38379218579 (2026-10-13): units 3236, 3161 and 3058 each print, in the unit page's spec
grid, the markup below (verbatim, icon path trimmed). The list card the rows are built from carries only
area, rooms, baths and floor, so kitchen was NULL on every row and alsaedan scored 0 of 8 findable.
"""
import scrapers.alsaedan.run as R

CELL = ('<div><svg class="as-icon" width="18" height="18" viewBox="0 0 24 24"><path d="M4 11h16v6H4z"/></svg>'
        '<small>مطبخ</small><b>1</b></div>\n'
        '<div><svg class="as-icon"></svg><small>غرف النوم</small><b>3</b></div>')


def test_the_kitchen_cell_answers_kitchen():
    assert R.unit_page_answers(CELL) == {"kitchen": True}


def test_a_printed_zero_is_a_no_and_silence_is_unknown():
    assert R.unit_page_answers(CELL.replace("<b>1</b>", "<b>0</b>")) == {"kitchen": False}
    assert R.unit_page_answers('<small>غرف النوم</small><b>3</b>') == {}


def test_each_unit_page_is_read_once_and_a_failed_read_is_unknown(monkeypatch):
    monkeypatch.setattr(R, "UNIT_PAGE_PACE", 0)
    calls = []

    def fetch(url):
        calls.append(url)
        if url.endswith("/9"):
            raise RuntimeError("503")
        return CELL

    rows = [{"listing_url": "https://alsaedan.com/sales/unit/1"},
            {"listing_url": "https://alsaedan.com/sales/unit/1"},      # the same unit offered both ways
            {"listing_url": "https://alsaedan.com/sales/unit/9"}]
    assert R.add_unit_page_answers(None, rows, fetch=fetch) == 1
    assert calls == ["https://alsaedan.com/sales/unit/1", "https://alsaedan.com/sales/unit/9"]
    assert rows[0]["kitchen"] is True and rows[1]["kitchen"] is True
    assert "kitchen" not in rows[2]
