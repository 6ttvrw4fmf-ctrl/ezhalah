"""Regression test for sadin's login-wall detail-page guard (2026-07-27).

Guards a bug where a detail-page fetch that lands on the login wall (session/bot-gate) instead of
the real property page was stored as a fake listing with no real content — og:title is literally
"Login or Create Account" (Arabic), and description/price/area all come back empty (found live:
id 4948043/SD4HO6O). map_listing must skip it entirely rather than store a garbage row.

Run: python -m pytest scrapers/common/tests/test_sadin_login_wall_guard.py -v
"""
from scrapers.sadin.run import map_listing


def test_login_wall_page_is_skipped():
    html = '<html><head><meta property="og:title" content="الدخول أو إنشاء حساب"></head><body></body></html>'
    row, category = map_listing("SD4HO6O", html, {"title": ""}, is_rent=False)
    assert row is None
    assert category == ""


if __name__ == "__main__":
    test_login_wall_page_is_skipped()
    print("OK — sadin login-wall guard regression test passes")
