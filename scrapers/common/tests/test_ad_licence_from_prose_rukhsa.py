"""«رخصة الإعلان: N» is the ad licence in prose, as «ترخيص N» already was (🔧 2026-11-07).

Card parity found the REGA ad licence on the source page and on 0 cards for amaall («رخصة الإعلان: 7200661580»,
og:description of its unit page, 11-07) and fahadalshahri («ترخيص<br /> 7201073069»). Runs the REAL parser.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.normalize import ad_licence_from_prose  # noqa: E402


def test_amaall_wording():
    t = "المميزات : موقف خاص مطبخ ملحق مدخل سيارة مصعد توفر الماء رخصة الإعلان: 7200661580"
    assert ad_licence_from_prose(t) == "7200661580"


def test_fahadalshahri_wording_after_tags_are_stripped():
    assert ad_licence_from_prose("تواصل معنا الآن. ترخيص 7201073069") == "7201073069"


def test_spelling_variants():
    assert ad_licence_from_prose("رقم رخصة الاعلان ٧٢٠٠٦٦١٥٨٠") == "7200661580"
    assert ad_licence_from_prose("رخصه إعلان: 7200661580") == "7200661580"


def test_a_bare_rukhsa_is_not_the_ad_licence():
    assert ad_licence_from_prose("رخصة فال 1100012345") is None
    assert ad_licence_from_prose("رخصة: 1100012345") is None


def test_two_different_numbers_are_not_guessed():
    assert ad_licence_from_prose("رخصة الإعلان: 7200661580 ترخيص 7201073069") is None
