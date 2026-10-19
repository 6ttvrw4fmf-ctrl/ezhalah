"""The aqar price probe must SURVIVE an authoritative NULL, and must keep it distinguishable.

WHY THIS EXISTS (2026-09-22). `scrapers/aqar/probe_price.py` is the repo's designated instrument for
settling a price dispute against source — `mon_detect_field_integrity`'s own guidance points at it,
and `ops_price_source_verified` is populated from what it shows. Dispatched against two extreme
price-per-m² rows it died in 21 seconds:

    TypeError: Object of type _AuthoritativeNull is not JSON serializable

`enrich_residential` emits `db.AUTHORITATIVE_NULL` — not None — when aqar ITSELF states a listing has
no price («طلب تسويق», `published:false`). Those are exactly the listings a price dispute is about,
so the instrument was broken precisely where it was needed, and the failure was invisible until
someone pointed it at such a row.

The second assertion matters as much as the first. Encoding the sentinel as a plain `null` would fix
the crash and destroy the evidence: a reader could no longer tell "the source says there is no
price" from "we could not read one", which is the single distinction this probe exists to report and
the one the owner's SOURCE IS TRUTH rule turns on. So it must serialise to something VISIBLY its own,
and any other unencodable object must still raise rather than be quietly stringified into evidence.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common import db  # noqa: E402

PROBE = ROOT / "scrapers" / "aqar" / "probe_price.py"


def _probe_module():
    """Load probe_price without running it (it imports db + enrich_residential at module scope)."""
    spec = importlib.util.spec_from_file_location("aqar_probe_price", PROBE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_dumping_a_probe_result_carrying_the_sentinel_does_not_crash():
    """The exact shape that killed run 35699272532."""
    mod = _probe_module()
    res = {
        "ad": "6708117",
        "parser": {"price_annual": db.AUTHORITATIVE_NULL, "price_total": None,
                   "price_per_meter": 650, "rent_period": None, "area_m2": 5},
        "db": {"price_annual": None, "price_total": 25000000,
               "price_per_meter": None, "rent_period": None, "area_m2": 5},
    }
    out = mod._dump(res)                       # must not raise
    assert json.loads(out)["parser"]["price_annual"] == mod.AUTHORITATIVE_NULL_JSON


def test_an_authoritative_null_is_never_rendered_as_a_plain_null():
    """A source that STATES there is no price must not read like a field we failed to parse."""
    mod = _probe_module()
    decoded = json.loads(mod._dump({"stated": db.AUTHORITATIVE_NULL, "unread": None}))
    assert decoded["unread"] is None
    assert decoded["stated"] is not None, (
        "the sentinel collapsed into null — an authoritative absence and a failed read became "
        "indistinguishable, which is the one thing this probe must never do")
    assert decoded["stated"] != decoded["unread"]


def test_any_other_unencodable_object_still_raises():
    """Fail loudly. A blanket str() default would turn unknown objects into plausible evidence."""
    mod = _probe_module()

    class Weird:
        pass

    with pytest.raises(TypeError):
        mod._dump({"x": Weird()})


def test_the_disagreement_summary_treats_a_stated_absence_and_a_stored_null_as_agreeing():
    """Both mean "this listing has no price", so counting them as a disagreement cries wolf."""
    mod = _probe_module()
    agreeing = {"parser": {"price_annual": db.AUTHORITATIVE_NULL, "rent_period": None},
                "db": {"price_annual": None, "rent_period": None}}
    assert not mod._differs(agreeing, "price_annual"), (
        "aqar stating there is no price, and our database holding no price, is agreement")

    # A real disagreement must still be reported.
    real = {"parser": {"price_annual": db.AUTHORITATIVE_NULL},
            "db": {"price_annual": 60000}}
    assert mod._differs(real, "price_annual"), (
        "aqar states there is no price while we serve 60,000 — that is the defect this probe hunts")


def test_probe_price_no_longer_dumps_through_a_bare_json_dumps():
    """A future edit that goes back to json.dumps() reintroduces the crash silently."""
    import ast
    tree = ast.parse(PROBE.read_text())
    bare = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "dumps"
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "json"):
            if not any(kw.arg == "default" for kw in node.keywords):
                bare.append(node.lineno)
    assert not bare, (f"json.dumps without default= at line(s) {bare} — an authoritative NULL "
                      "reaching it crashes the probe")
