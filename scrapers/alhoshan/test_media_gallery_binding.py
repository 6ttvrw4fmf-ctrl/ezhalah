"""Al Hoshan's full gallery comes from /media, bound to the PARENT listing's own GUID.

The list item exposes only primaryImageUrl, so 7/33 listings with 2-27 source photos were stored
with exactly 1 (verified live 2026-09-05 on 1003 + 1021: /media's data[].cdnUrl matches the detail
page's rendered gallery in content and order; first element == primaryImageUrl). This pins the
traps around that fix:
  • PARENT BINDING — fetch_media may only ever request the GUID it was handed; the URL is the
    binding, so a related-listings block can never contaminate a gallery.
  • SOURCE ORDER — the cdnUrl list is kept exactly as returned (no sort, no set-dedupe reorder);
    the first URL is the card thumbnail.
  • DEGRADE, NEVER INVENT — a failed fetch (None) falls back to primaryImageUrl; a source-empty
    gallery ([], the 3 imageless listings) stays [] even though it is falsy.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))
# to_catalog hits the DB catalog — stub it: this test is about images, not location IDs.
_al = types.ModuleType("scrapers.common.arabic_location")
_al.to_catalog = lambda *a, **k: (None, None)
sys.modules.setdefault("scrapers.common.arabic_location", _al)

from scrapers.alhoshan.run import MEDIA, fetch_media, map_listing  # noqa: E402

GUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload

    def json(self):
        return self._payload


class _Session:
    """Stub session: records every URL requested and replays a canned /media payload."""

    def __init__(self, status=200, payload=None):
        self.urls, self._resp = [], _Resp(status, payload)

    def get(self, url, timeout=None):
        self.urls.append(url)
        return self._resp


# 1. PARENT BINDING: the only URL ever requested embeds the parent's own GUID — nothing else.
gallery = [{"cdnUrl": f"https://cdn.alhoshan.sa/property-images/{GUID}/{i}.jpg"} for i in (2, 0, 1)]
s = _Session(payload={"data": gallery})
urls = fetch_media(s, GUID)
assert s.urls == [MEDIA.format(guid=GUID)], "fetch_media must hit exactly the parent's own /media"

# 2. SOURCE ORDER preserved verbatim — 2,0,1 stays 2,0,1 (first = thumbnail), no sort/dedupe.
assert urls == [g["cdnUrl"] for g in gallery], "gallery order is the site's own — never reorder"

# 3. Junk entries are dropped, real ones kept in place; a relative/videoish non-http value never leaks.
s = _Session(payload={"data": [{"cdnUrl": "https://x/a.jpg"}, {"cdnUrl": "/rel.jpg"},
                              {"videoUrl": "https://x/v.mp4"}, "junk", {"cdnUrl": None},
                              {"cdnUrl": "https://x/b.jpg"}]})
assert fetch_media(s, GUID) == ["https://x/a.jpg", "https://x/b.jpg"]

# 4. Failure shapes → None (degrade signal), source-empty → [] (a real answer, kept distinct).
assert fetch_media(_Session(status=500, payload={}), GUID) is None
assert fetch_media(_Session(payload=None), GUID) == []  # 200 with a null body: nothing published
assert fetch_media(_Session(payload={"data": []}), GUID) == []
assert fetch_media(_Session(payload={}), GUID) == []
assert fetch_media(_Session(payload={"data": gallery}), None) is None, "no GUID → no request"

# 5. map_listing wiring: gallery wins; None degrades to primaryImageUrl; [] stays [].
item = {"publicId": 1003, "id": GUID, "purpose": "sale", "currentPrice": 1,
        "specs": {"propertyType": "villa", "city": "الرياض"},
        "primaryImageUrl": "https://x/primary.jpg"}
row, _ = map_listing(item, ["https://x/1.jpg", "https://x/2.jpg"])
assert row["photo_urls"] == ["https://x/1.jpg", "https://x/2.jpg"]
row, _ = map_listing(item, None)
assert row["photo_urls"] == ["https://x/primary.jpg"], "failed fetch degrades to primaryImageUrl"
imageless = dict(item, primaryImageUrl=None)
row, _ = map_listing(imageless, [])
assert row["photo_urls"] == [], "a source with no photos keeps an EMPTY list — never invented"

print("ok: alhoshan /media gallery is parent-bound, source-ordered, and degrades to fewer never wrong")
