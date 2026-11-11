"""The REGA ad licence the ad's own page prints must reach the row; anything else must not.

Card parity, 2026-11-09 (alert 13688): alta's ad pages print «رخصة الإعلان: 7200575239» and 0 of 2
sampled cards showed a licence. The scraper read WP REST only, and this site's REST carries no
property meta, so the licence was never read at all. The fixture is the detail block of the real page
https://alta.com.sa/estate_property/أرض-سكنية-للبيع-في-مكة-حي-النسيم/ as served that day.

Both directions are executed:
  the ad's own licence cell          → license_number + additional_info.rega_ad_license_number
  a 10-digit number elsewhere        → nothing (the page renders other ads too)
  two different licences             → nothing (unknown, never a pick)
  a page that could not be read      → no licence key at all, so a stored licence survives

Run: python scrapers/alta/test_licence_is_read_from_the_ads_own_page.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import scrapers.alta.run as m  # noqa: E402

BLOCK = (Path(__file__).parent / "testdata" / "ad_page_detail_block_2026-11-09.html").read_text(encoding="utf-8")

# 1. The real page.
assert m.licence_from_ad_page(BLOCK) == "7200575239", m.licence_from_ad_page(BLOCK)

# 2. Not from anywhere else on the page: a related ad's text, a phone-shaped id, an office licence.
assert m.licence_from_ad_page("<p>رخصة الإعلان: 7200575239</p>") is None
assert m.licence_from_ad_page('<li>7200575239 ترخيص</li><a href="/p/7496969728">x</a>') is None
no_cell = BLOCK.replace("licinse", "scheme")
assert m.licence_from_ad_page(no_cell) is None
assert m.licence_from_ad_page(BLOCK.replace("7200575239", "غير متاح")) is None
assert m.licence_from_ad_page("") is None and m.licence_from_ad_page(None) is None

# 3. Two different licences in two cells: unknown.
two = BLOCK + BLOCK.replace("7200575239", "7200413886")
assert m.licence_from_ad_page(two) is None
assert m.licence_from_ad_page(BLOCK + BLOCK) == "7200575239"          # the same one twice is still one


class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text


class _Session:
    def __init__(self, pages):
        self.pages, self.asked = pages, []

    def get(self, url, timeout=0):
        self.asked.append(url)
        got = self.pages.get(url)
        if isinstance(got, Exception):
            raise got
        return got


A, B, C = (f"https://alta.com.sa/estate_property/{x}/" for x in "abc")
posts = [{"id": 1, "link": A}, {"id": 2, "link": B}, {"id": 3, "link": C},
         {"id": 4, "link": "https://elsewhere.example/estate_property/d/"}, {"id": "5", "link": A}]
s = _Session({A: _Resp(200, BLOCK), B: _Resp(503, BLOCK), C: TimeoutError("curl: (28)")})
got = m.fetch_licences(s, posts)
assert got == {1: "7200575239"}, got
assert s.asked == [A, B, C], "only this site's own ad pages are fetched"

# 4. Into the row, through the real mapper.
tax = {k: {} for k in ("property_category", "property_action_category", "property_city", "property_area",
                       "property_status", "property_features")}
tax["property_category"] = {1: "أرض"}
tax["property_action_category"] = {1: "للبيع"}


def _row(pid, licences):
    p = {"link": A, "slug": "a", "id": pid, "property_category": [1], "property_action_category": [1],
         "property_status": [], "title": {"rendered": "أرض سكنية للبيع"}, "content": {"rendered": ""}}
    row, why = m.map_listing(p, tax, None, licences)
    assert row, f"the fixture post no longer maps: {why}"
    return row


row = _row(1, got)
assert row["license_number"] == "7200575239"
assert row["additional_info"]["rega_ad_license_number"] == "7200575239"
unread = _row(2, got)                                   # its page answered 503
assert "license_number" not in unread and "rega_ad_license_number" not in unread["additional_info"], \
    "an unread page must not write a licence key (a stored licence must survive)"
assert "license_number" not in _row(1, None)

print("OK alta: the ad page's own licence cell reaches the row; nothing else does")
