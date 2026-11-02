"""SQCC: the unit's own per-floor room lists and notice line answer the Advanced Filter (🔬 AF engineer, 2026-10-26).

A duplex page prints one «<h2>دور ارضي</h2>» section per floor, each a `shape_data_list` of bare <b> items, plus a
`shape_notice` («يتكون من  كراج - حوش»), all after the listing block parse_page() used to read. CI source-reread
40299894589: 13707675 states a kitchen, a maid's room and a garage there; all three were stored NULL.
Fixture trimmed from that page; the footer phone is fake.
"""
import pytest

import scrapers.sqcc.run as Q

URL = "https://sqcc.sa/realestate/x/"
SALE = {"وحدات للبيع": {URL}, "الدمام": {URL}}

PAGE = """<link rel='shortlink' href='https://sqcc.sa/?p=91' />
<div class="precemp"> <h2>دوبلكس متصل للبيع</h2></div><div id="postin" style="">
<div class="news_shape_txt_all"> <p>950,000 ريال</p> <div class="serv_info">
<span class="icons139">4</span><span class="icons141">المساحة 197م</span></div></div>
<div class="postin_txt"></div>
<div id="shape_data">
	<div class="width">
    	<ul class="shape_data_list"><li>
            	<div>
					<span class="icons10"></span>
					<p>العمر : 13 سنة - زاوية على شارعين</p>
            	</div>
			</li><!--End Loop--></ul><!--End List-->    </div><!--End Width-->
</div><!--End Data--></div><div id="data"></div>
<div id="shape_notice" class="width">
		<div class="shape_notice shape_notice0">يتكون من  كراج - حوش</div>
	</div><!--End Aboutus-->
<div id="shape_about_default">
	<div class="width">
    	<div class="pages_title"><h2>دور ارضي</h2><div style='clear:both;'></div><!--End Both--><p><b></b></p></div>
    </div><!--End Width-->
</div><!--End About-->
<div id="shape_data">
	<div class="width">
    	<ul class="shape_data_list"><li>
            	<div>
								<b>مجلس رجال</b>
            	</div>
			</li><!--End Loop--><li>
            	<div>
								<b>مطبخ</b>
            	</div>
			</li><!--End Loop--></ul><!--End List-->    </div><!--End Width-->
</div><!--End Data-->
<div id="shape_about_default">
	<div class="width">
    	<div class="pages_title"><h2>دور اول</h2><p><b></b></p></div>
    </div>
</div>
<div id="shape_data">
	<div class="width">
    	<ul class="shape_data_list"><li>
            	<div>
								<b>٤ غرف نوم واحدة ماستر</b>
            	</div>
			</li><!--End Loop--><li>
            	<div>
								<b>غرفه خادمة</b>
            	</div>
			</li><!--End Loop--></ul><!--End List-->    </div>
</div>
<div class="foot_phone">رقم الهاتف : 0138113427</div><ul class="shape_data_list"><li><div><b>مصعد</b></div></li></ul>"""


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(Q, "to_catalog", lambda c, region_hint=None: (13, 5) if c == "الدمام" else (None, None))
    monkeypatch.setattr(Q, "find_district_in_text", lambda t, cid: "حي طيبة" if "طيبة" in t else None)


def test_the_floor_lists_and_the_notice_are_read_in_page_order():
    assert Q.parse_page(PAGE)["features"] == ["مجلس رجال", "مطبخ", "٤ غرف نوم واحدة ماستر", "غرفه خادمة",
                                              "يتكون من كراج - حوش"]


def test_the_ad_own_rooms_answer_kitchen_maid_room_and_parking():
    (row, _), why = Q.map_listing(URL, Q.parse_page(PAGE), SALE, "حي طيبة (الدمام)")
    assert why == ""
    assert row["kitchen"] is True and row["maid_room"] is True and row["parking"] is True
    assert "مطبخ" in row["description"] and "العمر : 13 سنة" in row["description"]
    assert row["property_age"] == 13                       # the spec list is still read as before


def test_the_footer_is_never_read_and_silence_stays_null():
    (row, _), _ = Q.map_listing(URL, Q.parse_page(PAGE), SALE, "حي طيبة (الدمام)")
    assert "elevator" not in row                           # «مصعد» sits after the footer: not this ad's statement
    assert "0138113427" not in repr(Q.parse_page(PAGE))


def test_a_page_without_floor_lists_reads_nothing_new():
    bare = PAGE[:PAGE.find('<div id="shape_notice"')]
    assert Q.parse_page(bare)["features"] == []
    (row, _), _ = Q.map_listing(URL, Q.parse_page(bare), SALE, "حي طيبة (الدمام)")
    assert not any(c in row for c in ("kitchen", "maid_room", "parking"))
