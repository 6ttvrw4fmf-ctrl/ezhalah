"""souq24's «Specifications» table ticks reach their columns (🔬 2026-11-05).

The markup below is pasted from the live re-read of https://24.com.sa/1303/x (net.http_get, 2026-11-05 09:4x UTC),
trimmed of whitespace only. Before this fix 0 of 42 active souq24 ads carried AC / car entrance / private entrance
/ bathrooms / halls, although the pages tick and count them, so af-score found 0 of 2 (souq24:17980938 asked
air_conditioner + private_entrance).
"""
import sys

sys.path.insert(0, ".")

from scrapers.souq24 import run as R  # noqa: E402

LIVE_1303 = '''<div class="p-2" id='Specifications' style="color:#818181;">
<table class="table nowrap  table-bordered scroll-horizontal">
<tr>
<th>المساحة</th>
<td>141 &#160; متر مربع</td>
</tr>
<tr>
<th>عدد الغرف</th>
<td> 3 </td>
</tr>
<tr>
<th>عدد الصالات</th>
<td> 1 </td>
</tr>
<tr>
<th>عدد دورات المياة</th>
<td> 2 </td>
</tr>
<tr>
<th>عرض الشارع</th>
<td>15 م</td>
</tr>
<tr>
<th>رسوم نقل الملكية</th>
<td> غير محدد </td>
</tr>
<tr>
<th>مكيفات</th>
<td> <i class="fa fa-check-square text-dark" style="font-size:30px;" aria-hidden="true"></i></td>
</tr>
<tr>
<th>مدخل خاص</th>
<td> <i class="fa fa-check-square text-dark" style="font-size:30px;" aria-hidden="true"></i></td>
</tr>
<tr>
<th>سطح خاص</th>
<td> <i class="fa fa-check-square text-dark" style="font-size:30px;" aria-hidden="true"></i></td>
</tr>
</table>'''


def facts(body):
    return R._spec_facts(body, R._spec_table(body))


def test_ticked_rows_are_structured_yes():
    f = facts(LIVE_1303)
    assert f["air_conditioner"] is True and f["private_entrance"] is True


def test_counted_rows_and_street_width():
    f = facts(LIVE_1303)
    assert f["bathrooms"] == 2 and f["halls"] == 1 and f["street_width_m"] == 15.0


def test_an_absent_row_is_silence_never_no():
    f = facts(LIVE_1303)
    for col in ("car_entrance", "elevator", "kitchen", "maid_room", "parking"):
        assert col not in f            # NULL by omission, never False
    assert False not in f.values()


def test_unmapped_ticks_and_room_total_are_not_invented():
    f = facts(LIVE_1303)
    assert "bedrooms" not in f          # «عدد الغرف» is a total room count (owner decision), never bedrooms
    assert "special_surface" not in f   # «سطح خاص» is a private roof, not aqar's «واجهة مميزة»


def test_a_non_ticked_cell_is_not_a_tick():
    body = "<tr><th>مكيفات</th><td> غير محدد </td></tr>"
    assert "air_conditioner" not in facts(body)


def test_the_row_the_crawl_upserts_carries_them():
    body = ('realestate_name = "دور"\n<title>دور للإيجار في الرياض حي الملز | تطبيق سوق العقار 24</title>\n'
            '<div style="font-size:25px;" class="x">75,000<span class="icon-Saudi_Riyal_Symbol-2"></span> سنوي </div>\n'
            'للإيجار في الرياض\n' + LIVE_1303)
    row, cat = R.map_listing(1303, body)
    assert cat == "residential"
    assert row["air_conditioner"] is True and row["private_entrance"] is True
    assert row["bathrooms"] == 2 and row["halls"] == 1
