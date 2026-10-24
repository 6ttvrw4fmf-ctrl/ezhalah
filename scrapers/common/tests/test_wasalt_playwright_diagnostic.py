"""Regression tests for scrapers/wasalt/diagnose_playwright.py's pure helpers (owner-requested,
2026-08-24). Only tests logic that doesn't require an actual browser/network -- proxy URL parsing
and result classification -- since a live navigation can't be unit-tested without a real browser
and the real target."""
from scrapers.wasalt.diagnose_playwright import classify, proxy_dict_for_playwright


def test_proxy_dict_for_playwright_empty_string_is_none():
    assert proxy_dict_for_playwright("") is None


def test_proxy_dict_for_playwright_parses_server_and_credentials():
    d = proxy_dict_for_playwright("http://myuser:mypass@gw.dataimpulse.com:823")
    assert d == {
        "server": "http://gw.dataimpulse.com:823",
        "username": "myuser",
        "password": "mypass",
    }


def test_proxy_dict_for_playwright_no_credentials_omits_them():
    d = proxy_dict_for_playwright("http://gw.example.com:8080")
    assert d == {"server": "http://gw.example.com:8080"}
    assert "username" not in d
    assert "password" not in d


def test_classify_nav_failure():
    assert classify({"ok": False, "error": "TimeoutError: boom"}) == "NAV_FAILED"


def test_classify_interactive_challenge_takes_priority_and_is_never_a_pass():
    # Even if the loose "real listing" heuristic somehow also matched, an interactive challenge
    # marker must win -- this script never interacts with one, so it can never count as success.
    result = {"ok": True, "has_interactive_challenge_marker": True,
              "is_cf_challenge_title": False, "looks_like_real_listing": True}
    assert classify(result) == "INTERACTIVE_CHALLENGE_PRESENT_NOT_ATTEMPTED"


def test_classify_cf_challenge_title_not_cleared():
    result = {"ok": True, "has_interactive_challenge_marker": False,
              "is_cf_challenge_title": True, "looks_like_real_listing": False}
    assert classify(result) == "CF_CHALLENGE_NOT_CLEARED"


def test_classify_real_content_loaded_is_the_only_pass_path():
    result = {"ok": True, "has_interactive_challenge_marker": False,
              "is_cf_challenge_title": False, "looks_like_real_listing": True}
    assert classify(result) == "REAL_CONTENT_LOADED"


def test_classify_inconclusive_when_nothing_matched():
    result = {"ok": True, "has_interactive_challenge_marker": False,
              "is_cf_challenge_title": False, "looks_like_real_listing": False}
    assert classify(result) == "INCONCLUSIVE"
