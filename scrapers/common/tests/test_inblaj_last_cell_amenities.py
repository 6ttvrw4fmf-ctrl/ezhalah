"""inblaj.net variant A: «المرافق» is the LAST cell of «تفاصيل العقار», so its value must end at the page's own
buttons, not only at a next field name (🔬 2026-11-10, backlog 1662).

LIVE is the visible text of gudai 12390333, re-read through net.http_get on 2026-11-10 (response 10892, the cells in
page order, then the «اتصل بنا / واتساب / احجز زيارتك» block that follows the table). Before the fix _label() needed a
field name within 60 characters, none follows the last cell, so it returned None: the site's own «غرفة خادمة» never
reached maid_room (stored NULL), and af-score read gudai findability 0/2 on 2026-11-09.
"""
import sys

sys.path.insert(0, ".")

from scrapers.common import inblaj_platform as I  # noqa: E402
from scrapers.common import normalize  # noqa: E402

LIVE = ("تفاصيل العقار نوع العرض: للبيع نوع العقار: فيلا المدينة: الرياض الحي: النخيل عام الاكتمال: 2023 "
        "المساحة: 480 م2 عدد الغرف: 9 الحمامات: 5 مؤثثة: لا "
        "المرافق: مسبح، غرفة خادمة، كاميرات مراقبة، نظام صوت مركزي اتصل بنا واتساب احجز زيارتك Next Previous")
# gudai testdata 1619: the same template with an EMPTY «المرافق» cell — it must stay silent, never read the button
EMPTY = "مؤثثة: لا المرافق: اتصل بنا واتساب احجز زيارتك"


def test_the_last_cell_is_read_up_to_the_buttons():
    assert I._label(LIVE, "المرافق") == "مسبح، غرفة خادمة، كاميرات مراقبة، نظام صوت مركزي"


def test_the_site_list_answers_maid_room():
    assert normalize.amenities_from_text(I._label(LIVE, "المرافق")).get("maid_room") is True


def test_an_empty_last_cell_stays_silent():
    assert I._label(EMPTY, "المرافق") is None


def test_the_other_cells_are_unchanged():
    assert I._label(LIVE, "الحمامات") == "5"
    assert I._label(LIVE, "مؤثثة") == "لا"
    assert I._label(LIVE, "الحي") == "النخيل"


def test_a_long_site_list_is_not_cut_to_nothing():
    long_list = "، ".join(["مسبح", "غرفة خادمة", "غرفة سائق", "مصعد", "مطبخ راكب", "مكيفات سبليت", "حديقة خارجية",
                           "ملحق خارجي", "مواقف خاصة", "كاميرات مراقبة", "نظام صوت مركزي", "إنارة ذكية"])
    v = I._label("المرافق: " + long_list + " اتصل بنا", "المرافق")
    assert v == long_list and len(long_list) > 60
