"""opensooq prints the REGA ad licence on the AD PAGE, not in the SERP chips (alert 13927 card_parity_card_missing:
opensooq:licence; 67 of 70 active ads stored none on 2026-11-11). Markup from source-reread run 42912650547
(opensooq 20927386 / 18634456, 2026-11-10 22:14 UTC): a spec row «رقم ترخيص الإعلان العقاري» whose value is a link, and
further down the office's «رقم رخصة فال» row, which is never the ad's licence."""
from scrapers.opensooq.run import page_licence

ROW = ('<li class="flex justify-between rounded-8 items-center even:bg-gray text-end gap-2 p-[12px]">'
       '<span class="text-[#57585A] font-normal text-sm">الأطوال (متر عرض)</span>'
       '<a href="http://opensooq.test/x" title="الأطوال (متر عرض): 65 متر عرض">65 متر عرض</a></li>'
       '<li class="flex justify-between rounded-8 items-center even:bg-gray text-end gap-2 p-[12px]">'
       '<span class="text-[#57585A] font-normal text-sm">رقم ترخيص الإعلان العقاري</span>'
       '<a href="http://opensooq.test/l/7201136326" class="font-bold">7201136326</a></li>')
OFFICE = ('<p class="mb-2">ترخيص الإعلان</p><div class="flex items-start sm:items-center flex-col sm:flex-row border-b gap-4">'
          '<p class="font-normal flex-1 mb-2">رقم رخصة فال</p><p class="font-bold flex-1">1200011697</p></div>')


def test_the_ad_licence_row_is_read_from_the_page():
    assert page_licence("<html><body>" + ROW + OFFICE + "</body></html>") == "7201136326"


def test_the_json_escaped_copy_of_the_page_reads_the_same():
    # the SPA state carries the same row with escaped quotes; page_amenities() flattens it the same way
    assert page_licence(("<html>" + ROW + "</html>").replace('"', '\\"')) == "7201136326"


def test_the_office_fal_licence_is_never_the_ad_licence():
    assert page_licence("<html><body>" + OFFICE + "</body></html>") is None
    # a FAL-shaped 10-digit number placed right after the AD label is still refused: only 71/72-prefixed numbers are ad licences
    assert page_licence('<span>رقم ترخيص الإعلان العقاري</span><a href="#">1200011697</a>') is None


def test_a_page_without_the_row_says_nothing():
    assert page_licence("<html><body><p>شقة للبيع في حي الروضة</p></body></html>") is None
    assert page_licence(None) is None
    assert page_licence("") is None


def test_the_row_is_read_only_at_its_own_label_not_from_any_72_number_on_the_page():
    # a phone-shaped or id-shaped 72… figure elsewhere on the page is not a licence
    assert page_licence('<p>رقم الإعلان 7211122233</p><span>رقم ترخيص الإعلان العقاري</span><a href="#">—</a>') is None
