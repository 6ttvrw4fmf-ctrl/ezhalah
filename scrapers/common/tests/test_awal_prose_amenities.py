"""awal: amenities its own ad text states are captured YES-only (2026-10-17)."""
import pytest

from scrapers.awal import run as R


def _post(content):
    return {"title": {"rendered": "شقه علويه للايجار"}, "content": {"rendered": content},
            "link": "https://awal.sa/x/", "id": 1}


@pytest.mark.parametrize("content,want", [
    ("<p>الشقه مكونه من :- غرفتين نوم وصاله ومطبخ و دورتين مياه الدرج مستقل</p>", {"kitchen"}),     # 645534
    ("<p>مجلس رجال – 2 دورات مياه – مطبخ – 2 غرف نوم – مستودع</p>", {"kitchen"}),                 # 645495
    ("<p>غرفتين نوم وصاله</p>", set()),
])
def test_amenities_the_ad_states_are_captured(content, want):
    row, _, _ = R.map_listing(_post(content), "")
    assert {c for c in R._PROSE_COLS if row.get(c) is True} == want


def test_a_denied_amenity_is_stored_as_no():
    row, _, _ = R.map_listing(_post("<p>لا يوجد مطبخ</p>"), "")
    assert row["kitchen"] is False          # owner 2026-10-24: an explicit negation is a stated no
