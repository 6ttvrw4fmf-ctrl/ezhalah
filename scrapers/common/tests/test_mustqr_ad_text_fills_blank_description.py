"""Regression (2026-10-30): mustqr ads with an empty `description` must carry the ad's own text.

Measured that day: 445/1,049 residential + 85/292 commercial active mustqr ads stored description NULL,
so the AI facts reader (scrapers/facts/extract.py, title + description ≥ 30 chars) skipped them. The ad
page still shows their full text: mustqr's PropertyPage renders `raw_text || description` (live on
/property/4827, 4958, 5014). The scraper never read raw_text (it carries phones), so the text was lost.

Now, for exactly the rows with no description, `ad_texts()` fetches `id,raw_text` separately and
`ad_body()` reduces it to the ad body as the page shows it (licence/CR header, emoji and the office
sign-off cut) through the shared redact_pii. raw_text stays out of the bulk select
(test_mustqr_fetch_page_column_allowlist), and a failed fetch leaves the description NULL, never ''.

Run: python -m pytest scrapers/common/tests/test_mustqr_ad_text_fills_blank_description.py -v
"""
import json

import scrapers.mustqr.run as m

# Shape of mustqr's real raw_text (ad 4827, 2026-10-30), with a phone line added in the body.
RAW_4827 = (
    "‏\n‏🚦رقم رخصة فال 1200007373\n‏🚦السجل التجاري 3350141921\n‏\n"
    "‏🌐 رقم العرض 2083\n‏\n‏☑️ عرض جديد\n‏\n"
    "‏🟩 للبيع ارض بحي السويفله مخطط التعاون 🟩\n‏\n"
    "‏رقم المخطط : 2728\n‏رقم القطعة : 69\n‏\n‏المساحة : 329.2م٢ \n‏\n"
    "‏شارع شرقي : عرض 20 م بطول 15.27م\n‏\n"
    "للتواصل 0551234567\n"
    "‏🔵 سوم / 90 الف\n‏🔴 حد / 140 الف قابل لتفاوض \n‏\n"
    "‏مباشر \n‏\n‏مكتب مستقر العقاري \n0559876543\n"
    "‏__________________________________\n‏لمتابعة عروضنا نتشرف بزيارتكم موقعنا \n"
    "‏https://mustqr.sa/qr\n‏"
)
# What mustqr.sa/property/4827 shows (2026-10-30), plus the redacted body phone.
SHOWN_4827 = ("رقم العرض 2083 للبيع ارض بحي السويفله مخطط التعاون رقم المخطط : 2728 رقم القطعة : 69 "
              "المساحة : 329.2م٢ شارع شرقي : عرض 20 م بطول 15.27م للتواصل [redacted] "
              "سوم / 90 الف حد / 140 الف قابل لتفاوض")

BASE_ROW = {"id": 4827, "type": "ارض", "category": "بيع", "usage_type": "سكني", "area_sqm": 329,
            "neighborhood": "السويفلة", "title": "للبيع ارض بحي السويفله مخطط التعاون",
            "description": None, "price_som": 90000}


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body, ensure_ascii=False)

    def json(self):
        return self._body


class _Session:
    def __init__(self, status=200, rows=None, raise_exc=False):
        self.status, self.rows, self.raise_exc, self.urls = status, rows or [], raise_exc, []

    def get(self, url, headers=None, timeout=None):
        self.urls.append(url)
        if self.raise_exc:
            raise ConnectionError("boom")
        return _Resp(self.status, self.rows)


def test_ad_body_is_the_text_the_ad_page_shows_with_phones_redacted():
    body = m.ad_body(RAW_4827)
    assert body == SHOWN_4827
    for leak in ("0551234567", "0559876543", "1200007373", "3350141921", "mustqr.sa/qr", "مكتب مستقر", "🟩"):
        assert leak not in body


def test_ad_body_silence_is_none_never_empty_string():
    assert m.ad_body(None) is None
    assert m.ad_body("") is None
    assert m.ad_body("🚦رقم رخصة فال 1200007373\nمباشر\nمكتب مستقر العقاري") is None


def test_blank_description_row_gets_the_ad_text():
    s = _Session(rows=[{"id": 4827, "raw_text": RAW_4827}])
    texts = m.ad_texts(s, "jwt", [4827])
    assert "select=id,raw_text&id=in.(4827)" in s.urls[0]
    p = dict(BASE_ROW, _ad_text=texts[4827])
    row, _ = m.map_listing(p, {})
    assert row["description"] == SHOWN_4827
    assert "0551234567" not in row["description"]


def test_source_description_still_wins_when_present():
    p = dict(BASE_ROW, description="وصف المكتب 0551234567", _ad_text="نص آخر")
    row, _ = m.map_listing(p, {})
    assert row["description"].startswith("وصف المكتب")
    assert "0551234567" not in row["description"]


def test_failed_fetch_leaves_description_null():
    for s in (_Session(status=401, rows={"message": "permission denied"}), _Session(raise_exc=True)):
        assert m.ad_texts(s, "jwt", [4827]) == {}
    row, _ = m.map_listing(dict(BASE_ROW), {})
    assert row["description"] is None


def test_raw_text_stays_out_of_the_bulk_select():
    assert "raw_text" not in m._PROPERTIES_COLUMNS.split(",")
