"""A derived `image_count: 0` must never be readable as a source-published zero.

WHY THIS EXISTS (2026-09-13, routine #3 data-integrity run).

`source_capture["image_count"]` is written by `_ensure_capture` as `len(row["photo_urls"])`.
It is a restatement of what WE stored. It has always LOOKED like capture evidence, and that is
the problem: `image_count: 0` is exactly as consistent with "the source published no photos" as
with "the images key moved / the response was a shell / the parser missed it".
A FAILED FETCH IS NOT AN EMPTY ANSWER (AGENTS.md, permanent).

Measured cost of the gap: `scripts/verify-image-coverage-ratchet-live.ts` asks one question —
"scraper regression or source change; investigate, never lower the floor" — and wasalt sat below
its 90% floor for four consecutive runs (89.4%, 5,733 rows, ops_incident #231) with no stored
field able to answer it. Row-by-row the pipeline was provably faithful, so nothing was lost;
what was missing was any record of what the source's image container actually held.

These tests EXECUTE `_ensure_capture` against real row shapes rather than reading the source
text of the functions they guard. That distinction is the whole point: every one of the five
defects of 2026-09-04 had a source-TEXT tripwire over the exact line, and every one of those
tripwires stayed green for as long as the defect was live.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from common.db import _ensure_capture  # noqa: E402

# Imported HARD, never via importorskip. curl_cffi (wasalt/run.py's only exotic dependency) is
# pinned in scrapers/requirements.txt and installed by common-location-tests.yml, so an
# ImportError here is a real breakage. A skip would make this barrier go dark exactly when the
# platform it guards stopped being importable — the failure shape AGENTS.md keeps warning about.
from wasalt import run as wasalt_run  # noqa: E402


def _cap(row: dict) -> dict:
    _ensure_capture(row)
    return row["source_capture"]


def test_a_scraper_that_looked_gets_its_observation_preserved_verbatim():
    """The whole point: a real observation survives into the capture unchanged."""
    observed = {"observed": True, "container_present": True, "key_present": True, "count": 0}
    cap = _cap({
        "listing_url": "https://example.test/p/1",
        "photo_urls": [],
        "images_evidence": dict(observed),
        "source_capture": {"schema": "wasalt.list.v1"},
    })
    assert cap["images_evidence"] == observed, (
        "a source-observed zero — the source really did publish an ad with no photos — must "
        "reach the capture intact; it is the only thing that can clear an image-coverage floor"
    )
    # ...and it is distinguishable from the derived zero below, which is the entire contract.
    assert cap["images_evidence"] != {
        "observed": None, "unverified": True, "reason": "adapter_emitted_no_evidence"}


def test_a_scraper_that_did_not_look_is_labelled_unverified_not_zero():
    """The defect this file exists for: silence must not read as a source-published zero."""
    cap = _cap({
        "listing_url": "https://example.test/p/2",
        "photo_urls": [],
        "source_capture": {"schema": "some.platform.v1"},
    })
    assert cap["image_count"] == 0, "the derived count still gets written; it is useful, just not evidence"
    assert cap["images_evidence"] == {
        "observed": None, "unverified": True, "reason": "adapter_emitted_no_evidence"}, (
        "a platform whose adapter never inspected the source's image container must say so. "
        "Without this the ratchet reads len(photo_urls)==0 as if the source had spoken."
    )


def test_the_evidence_never_becomes_a_column():
    """`images_evidence` is folded into the capture and dropped — a stray key would break the upsert."""
    row = {
        "listing_url": "https://example.test/p/3",
        "photo_urls": ["https://img.test/a.jpg"],
        "images_evidence": {"observed": True, "container_present": True, "key_present": True, "count": 1},
        "source_capture": {"schema": "wasalt.list.v1"},
    }
    _ensure_capture(row)
    assert "images_evidence" not in row, "must be popped off the row; it is not a table column"
    assert row["source_capture"]["images_evidence"]["count"] == 1


def test_evidence_is_a_witness_and_never_edits_what_we_stored():
    """Source truth is absolute: evidence records, it does not correct."""
    row = {
        "listing_url": "https://example.test/p/4",
        "photo_urls": ["https://img.test/a.jpg", "https://img.test/b.jpg"],
        # The source's container held 5; we only kept 2 (e.g. the 30-image cap, or a filter).
        "images_evidence": {"observed": True, "container_present": True, "key_present": True, "count": 5},
        "source_capture": {"schema": "wasalt.list.v1"},
    }
    _ensure_capture(row)
    assert row["photo_urls"] == ["https://img.test/a.jpg", "https://img.test/b.jpg"]
    assert row["source_capture"]["image_count"] == 2, "image_count stays OUR count"
    assert row["source_capture"]["images_evidence"]["count"] == 5, "evidence stays the SOURCE's count"


def test_the_auto_fallback_capture_is_covered_too():
    """A platform that builds no capture of its own still gets the honest label.

    This is the branch most platforms take, so a fix that only covered scraper-built captures
    would leave the majority of the fleet exactly as unadjudicable as before.
    """
    cap = _cap({"listing_url": "https://example.test/p/5", "photo_urls": [], "title": "شقة"})
    assert cap["schema"] == "auto.v1-fallback"
    assert cap["images_evidence"]["unverified"] is True


def _wasalt_prop(files) -> dict:
    """Smallest payload wasalt's real map_property() accepts (it needs only id + slug)."""
    return {"id": 5905597, "propertyInfo": {"slug": "apartment-204-sqm-5905597"},
            **({"propertyFiles": files} if files is not None else {})}


@pytest.mark.parametrize(
    "files, container, key, count",
    [
        ({"images": ["a", "b"]}, True, True, 2),   # normal
        ({"images": []}, True, True, 0),           # THE SOURCE SPOKE: genuinely no photos
        ({}, True, False, 0),                      # container there, key gone — a SHAPE CHANGE
        (None, False, False, 0),                   # no container — likely a shell response
        ({"images": None}, True, True, 0),         # key present but null
    ],
)
def test_wasalt_distinguishes_the_five_shapes_a_derived_zero_conflates(files, container, key, count):
    """EXECUTES wasalt's real map_property() — because "0 photos" has five different causes.

    A derived `image_count: 0` collapses cases 2-5 into one indistinguishable value. Only case 2
    is a source-published zero and may legitimately sit under an image-coverage floor; cases 3
    and 4 are the shapes that mean "stop, something moved". Reading the five apart is the whole
    reason this evidence exists.

    This calls the shipped function against synthetic payloads rather than asserting on its
    source text, so deleting the evidence from wasalt/run.py turns this RED.
    """
    row = wasalt_run.map_property(_wasalt_prop(files), "sale")
    assert row is not None, "the synthetic payload must still map, or this guard proves nothing"
    ev = row.get("images_evidence")
    assert ev is not None, (
        "wasalt must emit images_evidence on every row; without it _fold_images_evidence "
        "silently downgrades the whole platform to 'adapter_emitted_no_evidence'"
    )
    assert (ev["observed"], ev["container_present"], ev["key_present"], ev["count"]) \
        == (True, container, key, count)
    assert len(row["photo_urls"]) == count, "photo_urls and the observation must agree"


def test_wasalt_evidence_survives_the_real_capture_fold():
    """End to end: wasalt's observation reaches source_capture through _ensure_capture untouched."""
    row = wasalt_run.map_property(_wasalt_prop({"images": []}), "sale")
    _ensure_capture(row)
    assert row["source_capture"]["images_evidence"]["observed"] is True, (
        "a wasalt row must land as source-observed, not as the unverified default — that "
        "difference is what makes the image-coverage floor adjudicable at all"
    )
    assert row["source_capture"]["image_count"] == 0
    assert "images_evidence" not in row
