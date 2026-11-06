"""kellerwilliams' own-record reader (♻️ 2026-11-06, SHADOW: spot check + dead-visible score only).

The ad page is one JS shell for live and removed ads (spot-check 42209305892: 14 list-absent ads read «live»);
the page itself reads GET api.kw-saudiarabia.com/api/listings/property/<uuid> — 200 for a present ad, 404 for a
missing uuid (page-probe 42214711491), and a list-absent ad rendered «Active». Only those two shapes are measured,
so everything else is UNKNOWN with the evidence printed.
"""
from __future__ import annotations

import sys
import types

for name, attrs in (("supabase", {"Client": type("Client", (), {}), "create_client": lambda *a, **k: None}),
                    ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)

from scrapers.kellerwilliams import run as kw  # noqa: E402

U = "https://kwsaudiarabia.com/propertydetails/6707227ff8bc59395742594e"


def test_uuid_of_the_stored_url():
    assert kw.uuid_of(U) == "6707227ff8bc59395742594e"
    assert kw.uuid_of(U + "/") == "6707227ff8bc59395742594e"
    for bad in (None, "", "https://kwsaudiarabia.com/propertydetails/xyz", "https://kwsaudiarabia.com/"):
        assert kw.uuid_of(bad) is None


def test_allowed_is_the_list_and_one_record_only():
    assert kw._allowed(kw.API)
    assert kw._allowed(kw.PROPERTY_API + "6707227ff8bc59395742594e?fields=basic")
    assert not kw._allowed(kw.PROPERTY_API + "../agents")
    assert not kw._allowed("https://api.kw-saudiarabia.com/api/agents/kw/people-data")


def test_the_two_measured_shapes():
    assert kw.record_verdict(404, None)[0] == "gone"
    assert kw.record_verdict(200, {"data": {"list_status": "Active"}})[0] == "live"
    assert kw.record_verdict(200, {"list_status": "Active"})[0] == "live"
    assert kw.record_verdict(200, {"data": {"is_deleted": True, "list_status": "Active"}})[0] == "gone"


def test_everything_else_is_unknown_never_dead():
    for st, body in ((200, {"data": {"list_status": "Sold"}}), (200, {"data": {}}), (200, None), (200, []),
                     (403, None), (429, None), (500, None), (None, None), (410, None)):
        v, why = kw.record_verdict(st, body)
        assert v == "unknown", (st, body, v)


def test_registered_with_the_spot_check_and_score():
    import inspect
    from scrapers.common import lifecycle_spot_check as L
    assert 'platform == "kellerwilliams"' in inspect.getsource(L._reader_for)


def test_the_crawl_prune_still_holds_absence():
    v, why = kw._gone("KW1")
    assert v == "unknown"
