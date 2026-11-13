"""daraa (⚡ 2026-11-10, backlog 1197): served 0 of 7 pins while every project page names its own map.

Measured on the live pages (source-reread 42761646737): the footer's «الموقع → مكة المكرمة» link
(maps.app.goo.gl/E9tH7KXbn48rNxrq6) is the same on every page — the company, never a project — and the project's
own map button (`rel="noopener noreferrer"`) is a different link per project. Only the button is read.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.daraa import run as R  # noqa: E402

FOOTER = ('[\\"$\\",\\"a\\",\\"2246\\",{\\"dir\\":\\"auto\\",\\"className\\":\\"hover:text-accent\\",'
          '\\"href\\":\\"https://maps.app.goo.gl/E9tH7KXbn48rNxrq6\\",\\"target\\":\\"_blank\\",\\"children\\":\\"مكة المكرمة\\"}]')
BUTTON = ('[\\"$\\",\\"a\\",null,{\\"href\\":\\"https://maps.app.goo.gl/{L}\\",\\"target\\":\\"_blank\\",'
          '\\"rel\\":\\"noopener noreferrer\\",\\"className\\":\\"px-6 py-2.5 bg-accent\\"}]')


def page(*parts):
    return "".join(f'<script>self.__next_f.push([1,"{p}"])</script>' for p in parts)


def test_the_project_button_is_the_pin_and_the_footer_never_is():
    blob = R.flight(page(FOOTER, BUTTON.replace("{L}", "g3H1cVt1cLMCofHm6")))
    assert R.project_pin_link(blob) == "https://maps.app.goo.gl/g3H1cVt1cLMCofHm6"


def test_a_share_suffix_is_dropped():
    blob = R.flight(page(BUTTON.replace("{L}", "ucSFx51RLUa3rPdz9?g_st=com.google.maps.preview.copy")))
    assert R.project_pin_link(blob) == "https://maps.app.goo.gl/ucSFx51RLUa3rPdz9"


def test_footer_only_or_two_buttons_is_no_pin():
    assert R.project_pin_link(R.flight(page(FOOTER))) is None
    two = page(BUTTON.replace("{L}", "aaaaaaaaaaaaaaaaa"), BUTTON.replace("{L}", "bbbbbbbbbbbbbbbbb"))
    assert R.project_pin_link(R.flight(two)) is None


def _card():
    return {"link": "/projects/205059", "title": "دارا لاكجري - 39", "isSoldOut": False, "extraInfo": ["شقق / جاهزة للإفراغ"]}


def _detail(**kw):
    d = {"tags": ["جاهزة للإفراغ"], "title": "دارا لاكجري - 39", "description": "", "amenities": {},
         "specs": {"الفئة": "شقة", "المسافة إلى الحرم المكي": "3 إلى 5 كم", "الحي": "بطحاء قريش"}, "images": []}
    d.update(kw)
    return d


def test_the_resolved_pin_reaches_the_row_and_a_page_without_a_button_says_so(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c: (5, 2))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, c: "حي بطحاء قريش")
    (row, _), _ = R.map_project(_card(), _detail(pin_link="https://maps.app.goo.gl/x",
                                                 pin={"latitude": 21.43, "longitude": 39.84}))
    assert (row["additional_info"]["latitude"], row["additional_info"]["longitude"]) == (21.43, 39.84)
    (row, _), _ = R.map_project(_card(), _detail(pin_link=None))
    assert row["additional_info"].get("pin_absent") is True and "latitude" not in row["additional_info"]
    # a button whose hop failed states nothing: no pin, and NOT pin_absent (the stored pair is kept)
    (row, _), _ = R.map_project(_card(), _detail(pin_link="https://maps.app.goo.gl/x", pin={}))
    assert "pin_absent" not in row["additional_info"] and "latitude" not in row["additional_info"]
