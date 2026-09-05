"""Map the stored REAL aqarcity page through the REAL map_listing(), for the barrier.

Kept as a tiny module rather than inlined in the barrier so the fixture path and the
AUTHORITATIVE_NULL check live next to each other and cannot drift apart.
"""
import gzip
import os

from scrapers.common import db
from scrapers.aqarcity.run import map_listing

_FIXTURE = os.path.join(os.path.dirname(__file__), "..", "fixtures", "aqarcity-30260.html.gz")
_URL = "https://www.aqarcity.net/property/30260"


def map_fixture() -> dict:
    with gzip.open(_FIXTURE, "rb") as fh:
        body = fh.read().decode("utf-8", "replace")
    row, _ = map_listing(body, _URL)
    row = dict(row or {})
    # The barrier crosses a JSON boundary, where a sentinel object would flatten to a string. Answer
    # the question that actually matters — is this the AUTHORITATIVE null? — on the Python side.
    row["rent_period_is_authoritative_null"] = isinstance(
        row.get("rent_period"), type(db.AUTHORITATIVE_NULL)
    )
    row["rent_period"] = str(row.get("rent_period"))
    return row
