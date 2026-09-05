"""aqargate gallery extraction — pins the media-endpoint path and its ONE dangerous edge.

The defect this pins, found live 2026-09-05: the Houzez gallery is not in the properties payload,
so the scraper stored only `thumbnail` — every multi-photo gallery capped to 1 image, and rows
whose thumbnail is false (57251, 34 live photos) stored with 0. The fix reads
/wp-json/wp/v2/media?parent=<post id>.

The trap specific to this platform: ~27% of listings upload their media UNATTACHED (post:null —
live 2026-09-05: 55102, 51336, 52193, 53809), so an EMPTY-but-successful parent query must fall
back to the thumbnail, never store []. Also pinned: featured-first source order, non-image
mime exclusion, and genuinely-imageless rows staying [].
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.common import arabic_location  # noqa: E402

arabic_location._CITY.setdefault("_stub", [])  # short-circuit _load(); no catalog DB in tests

from scrapers.aqargate.run import map_listing  # noqa: E402

THUMB = "https://aqargate.com/wp-content/uploads/thumb.jpg"


class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload


class _Session:
    """One canned media response per instance; raising=True simulates a network failure."""
    def __init__(self, status=200, payload=None, raising=False):
        self._resp, self._raising = _Resp(status, payload or []), raising

    def get(self, url, timeout=None):
        if self._raising:
            raise RuntimeError("boom")
        return self._resp


def _prop(thumb=THUMB, featured=0):
    return {"id": 57251, "featured_media": featured, "thumbnail": thumb,
            "link": "https://aqargate.com/property/x/", "title": {"rendered": "شقة"},
            "property_type_text": ["شقة"], "property_status_text": ["بيع"],
            "property_meta": {"fave_property_id": ["AG-1"]}}


def _att(i, mime="image/jpeg"):
    return {"id": i, "mime_type": mime, "source_url": f"https://aqargate.com/wp-content/uploads/{i}.jpg"}


def _photos(session, **kw):
    row, _ = map_listing(_prop(**kw), session)
    return row["photo_urls"]


# 1. Multi-photo gallery: ALL attachments captured, featured moved first, rest keep asc-id order.
got = _photos(_Session(payload=[_att(10), _att(11), _att(12)]), featured=11)
assert [u.rsplit("/", 1)[1] for u in got] == ["11.jpg", "10.jpg", "12.jpg"], got

# 2. featured_media absent/0 → pure ascending-id source order, nothing invented at the front.
got = _photos(_Session(payload=[_att(12), _att(10)]), featured=0)
assert [u.rsplit("/", 1)[1] for u in got] == ["10.jpg", "12.jpg"], got

# 3. Non-image attachments (video, pdf) are never photo_urls — mime gate, not extension guess.
got = _photos(_Session(payload=[_att(1, "video/mp4"), _att(2), _att(3, "application/pdf")]))
assert got == [_att(2)["source_url"]], got

# 4. THE TRAP: empty-but-SUCCESSFUL parent query (unattached media, ~27% of catalog) → thumbnail
#    fallback, never [] over a live source-published photo.
assert _photos(_Session(payload=[])) == [THUMB]

# 5. Failure degrades to FEWER images, never none-when-source-has-one: network error and non-200
#    both keep the thumbnail.
assert _photos(_Session(raising=True)) == [THUMB]
assert _photos(_Session(status=500)) == [THUMB]

# 6. Genuinely imageless (thumbnail=false, no attachments — live 53151) stays EMPTY: no
#    placeholder, no substitute.
assert _photos(_Session(payload=[]), thumb=False) == []
assert _photos(_Session(raising=True), thumb=False) == []

# 7. All-non-image attachments count as "no gallery" → same fallback rules as empty.
assert _photos(_Session(payload=[_att(1, "video/mp4")])) == [THUMB]

# 8. No session (dry contexts) → old thumbnail behavior, no crash.
row, _ = map_listing(_prop(), None)
assert row["photo_urls"] == [THUMB]

print("ok: aqargate gallery = media parent query, featured-first source order, "
      "empty/failed query falls back to thumbnail, imageless stays empty")
