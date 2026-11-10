"""amaall prints the REGA ad licence among its Houzez meta facts («الترخيص الاعلاني: 7200807823» next to «عرض الشارع /
الواجهة»), not in the body the prose reader scanned — card parity 2026-11-09: on the page, on 0 of 3 sampled cards.
_meta_strings() hands every meta text to the same shape-gated reader (normalize.ad_licence_from_prose)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.amaall import run as R  # noqa: E402
from scrapers.common import normalize  # noqa: E402


def _lic(meta):
    return normalize.ad_licence_from_prose(" ".join(v for _, v in R._meta_strings(meta)))   # as run.py joins them


def test_the_houzez_meta_fact_is_read_lists_unwrapped():
    meta = {"fave_property_price": ["695000"], "street_width": ["18"],
            "additional_features": [{"fave_additional_feature_title": "الواجهة", "fave_additional_feature_value": "south"},
                                    {"fave_additional_feature_title": "الترخيص الاعلاني", "fave_additional_feature_value": "7200807823"}]}
    assert _lic(meta) == "7200807823"
    assert _lic({"notes": ["رخصة الإعلان: 7200661580"]}) == "7200661580"


def test_a_fal_licence_or_a_bare_number_in_meta_is_not_the_ad_licence():
    assert _lic({"fave_fal": ["رخصة فال: 1200039840"]}) is None
    assert _lic({"fave_property_price": ["7200807823"]}) is None      # a number with no licence label is a price


def test_meta_strings_is_read_only_and_skips_nested_shapes():
    meta = {"a": ["x", {"deep": 1, "flag": True}], "b": None, "c": 5}
    assert R._meta_strings(meta) == [("a", "x"), ("deep", "1"), ("c", "5")]


# ── 🔧 2026-11-10: the page's own «تفاصيل إضافية» row, when the REST post carries no licence ─────────────────────────
from scrapers.amaall import run as _am  # noqa: E402

# The markup source-reread run 42907507350 read on 10729186 (phone redacted the same way the run redacts it).
_PAGE = ('<li class="x"><strong>رقم الواتساب:</strong> <span>0551234567</span></li>'
         '<li class="y"><strong>الترخيص الاعلاني:</strong> <span>7200807823</span></li>\t</ul>')


def test_the_page_row_gives_the_licence():
    assert _am.licence_from_page(_PAGE) == "7200807823"
    assert _am.licence_from_page(_PAGE.replace("7200807823", "٧٢٠٠٨٠٧٨٢٣")) == "7200807823"


def test_never_the_whatsapp_row_a_fal_number_or_two_licences():
    assert _am.licence_from_page('<strong>رقم الواتساب:</strong> <span>7200807823</span>') is None
    assert _am.licence_from_page(_PAGE.replace("7200807823", "1100027006")) is None
    two = _PAGE + '<strong>الترخيص الاعلاني:</strong> <span>7200911247</span>'
    assert _am.licence_from_page(two) is None
    assert _am.licence_from_page(None) is None


def test_the_page_is_read_only_for_a_live_row_without_a_licence(monkeypatch):
    calls = []
    monkeypatch.setattr(_am, "_page_html", lambda s, link: calls.append(link) or _PAGE)
    row = {"active": True, "additional_info": {}}
    _am._licence_from_own_page(None, {"link": "https://www.amaall.com/x/"}, row)
    assert row["license_number"] == "7200807823" and row["additional_info"]["rega_ad_license_number"] == "7200807823"
    kept = {"active": True, "additional_info": {"rega_ad_license_number": "7200531735"}}
    _am._licence_from_own_page(None, {"link": "u"}, kept)
    sold = {"active": False, "additional_info": {}}
    _am._licence_from_own_page(None, {"link": "u"}, sold)
    assert calls == ["https://www.amaall.com/x/"] and "license_number" not in sold
    # a failed page read leaves the licence unknown, never «no»
    monkeypatch.setattr(_am, "_page_html", lambda s, link: None)
    miss = {"active": True, "additional_info": {}}
    _am._licence_from_own_page(None, {"link": "u"}, miss)
    assert "license_number" not in miss and miss["additional_info"] == {}
