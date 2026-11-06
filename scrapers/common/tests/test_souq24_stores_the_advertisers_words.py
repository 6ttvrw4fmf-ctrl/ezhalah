"""souq24 stores the advertiser's own words (🔬 2026-11-06, backlog 1386).

The markup below is pasted from the live re-read of https://24.com.sa/389/x and /374/x (2026-11-06 ~22:30 UTC),
unchanged. Before this fix every souq24 row stored description = None («24 Souq detail pages carry no
advertiser-written description block» — false), so the word reader never saw «غرفة شغالة», «مطبخ», «المدخل مستقل»
and af-score missed souq24:648168 / 648169.
"""
import sys

sys.path.insert(0, ".")

from scrapers.souq24 import run as R  # noqa: E402

LIVE_389 = '<div class="responsive-text font-weight text-dark border-0 mb-5 mt-5">\n\n\nشقه مكونه من اربع غرف وصالة وغرفة شغالة ومخزن علوي صغير ومطبخ وثلاث دورات مياه ومكيف اسبليت راكب في المطبخ المدخل مستقل والمساحه ممتازه والحي راقي جدا\n \n\n</div>\n\n<div class="p-2" id=\'Specifications\' style="color:#818181;">'

LIVE_374 = '<div class="responsive-text font-weight text-dark border-0 mb-5 mt-5">\n\n\nفيلا للإيجار نظام مودرن مطبخ أمريكي +3غرف وغرفه ماستر +مقلط +مجلس رجال نظام مودرن مفتوح+3دورات مياه+مقلط<br />\nفيلا<br />\nالمساحة 360 متر<br />\nعرض الشارع 15 متر<br />\nالواجهة شرقية<br />\nشارع سكني<br />\n3 غرف<br />\n3 صالات<br />\n3 دورات مياة<br />\nحوش<br />\nمدخل سيارة\n \n\n</div>\n\n<div class="p-2" id=\'Specifications\' style="color:#818181;">'


def test_the_block_before_specifications_is_the_description():
    d = R._advertiser_text(LIVE_389)
    assert d and "غرفة شغالة" in d and "ومطبخ" in d and "المدخل مستقل" in d


def test_line_breaks_stay_clause_breaks():
    d = R._advertiser_text(LIVE_374)
    assert "مطبخ أمريكي" in d and "\nالواجهة شرقية\n" in d


def test_a_contact_line_never_reaches_storage():
    d = R._advertiser_text('<div class="responsive-text x">للتواصل 0551234567<br />مطبخ راكب</div>\n<div class="p-2" id=\'Specifications\'>')
    assert d == "مطبخ راكب"


def test_a_block_not_followed_by_specifications_is_not_read():
    assert R._advertiser_text('<div class="responsive-text x">قائمة الموقع</div><div id="footer"></div>') is None


def test_the_parser_stores_it():
    import inspect
    src = inspect.getsource(R)
    assert "description = _advertiser_text(body)" in src
