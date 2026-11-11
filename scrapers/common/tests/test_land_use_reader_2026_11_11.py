"""A plain «أرض» ad's land use, read from its own words (🔬 2026-11-11, backlog 1718 = the reader half of 1650).

Owner decision 2026-11-08: a listing typed only «أرض» goes to the land group its own text names, and an unknown use goes
to every land group. This is the READER half only: `word_checker.check()` emits `land_use_ar` (سكني / تجاري / زراعي /
صناعي) or nothing. Serving it is 🔧's half (1650): `listing_text_facts.facts` is guarded by CHECK
`text_facts_all_quoted()`, which accepts only the AF yes/no and number columns, so a text fact written into the overlay
today would make the WHOLE facts-words batch fail. The overlay therefore must not carry it until that check is widened —
the last test pins that.

Every sentence below is a real served plain-«أرض» ad (aqar / haraj, read 2026-11-11 through execute_sql).
"""
from scrapers.facts import word_checker as W
from scrapers.facts.words import overlay_row


def use(text: str):
    return W.facts_of(W.clean_text(None, text)).get("land_use_ar")


def test_the_land_or_its_deed_names_the_use():
    assert use("*للبيع ارض زاوية سكنية شرق بريدة - حي الروابي*") == "سكني"                    # aqar 6989916
    assert use("قطعة زراعية للبيع 168 000 م ¦ 🌾 قطعة زراعيه للبيع – النبقية") == "زراعي"      # haraj 19324720
    assert use("أرض للبيع، 620 م². ارض بصك زراعي") == "زراعي"                                 # aqar 11510463
    assert use("أرض للبيع تجارية في حي طويق بالرياض، بمساحة 651 م²") == "تجاري"             # aqar 18818283
    assert use("📍 أرض صناعية للبيع – خميس مشيط") == "صناعي"                                 # aqar 168649
    assert use("الأرض بمخطط معتمد وصك الكتروني سكني حي السوق") == "سكني"                     # aqar 10932898
    assert use("نوع العقار : #ارض_سكنية رقم310") == "سكني"                                   # haraj 21304003
    assert use("3 اراضي زراعية متجاورات") == "زراعي"                                         # haraj 18911812


def test_two_uses_a_conversion_or_a_wanted_line_is_silence():
    assert use("ارض زاويه تجاريه سكنيه للايجار مساحة الارض 660") is None                     # aqar 20871284
    assert use("استخدام العقار: سكني-تجاري. عدد الشوارع: شارع واحد") is None                 # aqar 17753606
    assert use("قطعتي ارض للبيع الاستخدام ( تجاري / سكني ) الارض على صكين") is None          # aqar 11518885
    assert use("الارض للبيع تجاري سكني من المالك مباشرة") is None                            # aqar 8017472
    assert use("أرض زراعية قابلة للتحويل إلى سكني") is None
    assert use("مطلوب أراضي تجارية على شارع الملك عبدالعزيز من الملاك") is None


def test_a_street_a_pitch_a_licence_or_a_building_is_not_the_land():
    assert use("خلف الأرض شارع تجاري • قريبه من جميع الخدمات") is None                      # haraj 18743550
    assert use("موقع تجاري للبيع بجوهرة العروس") is None                                     # haraj 20641041
    assert use("🔺رخص فال #🔺 السجل التجاري #🔻 تاريخ انتهاء رخصة الإعلان") is None          # haraj 18946243
    assert use("مناسبة لإقامة مشروع استثماري أو قصر سكني") is None                          # aqar 114530
    assert use("أرض للبيع في حي الصناعية الثانية, مدينة الدمام") is None                    # aqar 14995537
    assert use("ارض سكنية قريبة من ارض تجارية") == "سكني"        # the nearby land is not this one


def test_the_overlay_never_stores_it_until_the_db_check_accepts_text_facts():
    row, found = overlay_row("aqar_residential_listings", dict(id=6989916, ad_number="A1", src_hash="0" * 32,
                             title="أرض للبيع", body="للبيع ارض زاوية سكنية شرق بريدة يوجد مصعد"), "facts-words-t")
    assert any(f["fact"] == "land_use_ar" and f["value_text"] == "سكني" for f in found), found   # the reader read it…
    assert "land_use_ar" not in row["facts"], row                                                # …the overlay did not keep it
    assert all(isinstance(v["v"], (bool, int, float)) for v in row["facts"].values()), row
