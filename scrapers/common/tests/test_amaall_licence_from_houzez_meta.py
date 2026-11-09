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
