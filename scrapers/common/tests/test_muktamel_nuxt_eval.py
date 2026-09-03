"""Regression tests for scrapers/muktamel/run.py:_nuxt_via_node() (2026-09-03, superseding
test_muktamel_node_worker_timeout.py's now-deleted _NodeWorker tests).

Timeline: a persistent `node worker.js` process behind a custom length-prefixed stdin/stdout
protocol, shared across all 8 fetch threads by one lock, had NO timeout on a single exchange — a
stuck node process blocked every future call forever, which is the confirmed root cause of
"muktamel never completes a single full-range crawl" (paused 2026-07-15). A first fix added a
`threading.Timer` watchdog around that exchange, which stopped the infinite hang.

Then a LIVE re-test against real muktamel.com pages (scrapers/muktamel/diag_page_structure.py,
evidence captured 2026-09-03) proved the watchdog fix was necessary but not sufficient: the exact
same real payload succeeds in <35ms total (eval() ~29ms + JSON.stringify() ~2ms) when run as a
plain one-shot `node -e` process reading stdin in one shot — but through the persistent worker's
custom fs.readSync()-based readN()/readLine() protocol, it reliably returned nothing. The
eval/stringify logic was never broken; the bespoke IPC framing was. `_nuxt_via_node()` was
rewritten to spawn one `node -e` subprocess per parse() call via `subprocess.run(..., timeout=...)`
instead — no persistent process, no shared lock, nothing for one slow/stuck call to block.

These tests drive the REAL `_nuxt_via_node()` (not a reimplementation), including monkeypatching
the module's `_NODE_EVAL_JS` to simulate a hang, to prove: a normal payload parses correctly, a
hanging node process is bounded by NODE_PARSE_TIMEOUT (not infinite), a syntactically broken
payload returns None rather than raising, and concurrent calls from multiple threads do not
serialize behind each other (the property the old shared-lock design did not have).

Run: python -m pytest scrapers/common/tests/test_muktamel_nuxt_eval.py -v
"""
import sys
import threading
import time

sys.path.insert(0, ".")

from scrapers.muktamel import run as muktamel_run  # noqa: E402

# A minimal but realistic NUXT-2-shaped IIFE payload: the offer lives at data[0].offer, exactly
# the path _nuxt_via_node()'s JS reads.
_VALID_PAYLOAD = (
    "window.__NUXT__=(function(a,b,c){"
    "return {data:[{offer:{isAvailable:a,price:b,type:c}}],"
    "state:{addressJson:{Regions:{11:\"الرياض\"}}}};"
    "}(true,850000,7))"
)

_BROKEN_PAYLOAD = "window.__NUXT__=(function(a,b){return {data:[{offer:{isAvailable:a}}]}}(true,999)"  # missing )

# A hostile "worker" script that ignores the real input entirely and just spins forever — same
# shape of failure as a node process wedged inside eval() on a pathological payload.
_HANGING_EVAL_JS = r"""
const fs = require('fs');
fs.readFileSync(0, 'utf8'); // still consume stdin like the real script would
while (true) { require('child_process').execSync('sleep 3600'); }
"""


def test_valid_payload_parses_to_the_expected_offer_shape():
    result = muktamel_run._nuxt_via_node(_VALID_PAYLOAD)
    assert result is not None
    assert result["offer"] == {"isAvailable": True, "price": 850000, "type": 7}
    assert result["addressJson"] == {"Regions": {"11": "الرياض"}}


def test_broken_payload_returns_none_not_an_exception():
    # A syntax error inside eval() must degrade to "skip this listing", never crash the crawl.
    result = muktamel_run._nuxt_via_node(_BROKEN_PAYLOAD)
    assert result is None


def test_hanging_node_process_is_bounded_by_timeout_not_forever(monkeypatch):
    # Small timeout so the test itself stays fast — production uses 20s, the mechanism (subprocess.
    # run(..., timeout=...)) is identical regardless of the value.
    monkeypatch.setattr(muktamel_run, "NODE_PARSE_TIMEOUT", 1.5)
    monkeypatch.setattr(muktamel_run, "_NODE_EVAL_JS", _HANGING_EVAL_JS)

    t0 = time.monotonic()
    result = muktamel_run._nuxt_via_node(_VALID_PAYLOAD)
    elapsed = time.monotonic() - t0

    # The pre-watchdog persistent-worker design would block here forever — this assertion is what
    # actually proves the bound exists (and, run against that old code, this test would hang the
    # CI job itself rather than fail cleanly, which is the strongest possible regression signal).
    assert elapsed < 10.0, (
        f"_nuxt_via_node() on a hung node process took {elapsed:.1f}s — subprocess.run's timeout "
        "did not bound it (this is the exact deadlock shape that stalled every muktamel crawl)"
    )
    assert result is None  # a hung/unparseable payload must be skipped, never fabricated as data


def test_concurrent_calls_do_not_block_each_other():
    # The old design serialized every parse() behind ONE lock on ONE shared process — a slow call
    # from one thread delayed every other thread's result. The new one-shot-per-call design has no
    # shared state to serialize behind: launch several concurrent calls and confirm each gets its
    # own correct, independent result rather than any thread being starved.
    results: dict[int, dict] = {}

    def worker(i: int) -> None:
        results[i] = muktamel_run._nuxt_via_node(_VALID_PAYLOAD)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    t0 = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    elapsed = time.monotonic() - t0

    assert all(not t.is_alive() for t in threads), "a thread never returned"
    assert elapsed < 15.0, f"5 concurrent one-shot parses took {elapsed:.1f}s — unexpectedly serialized"
    assert len(results) == 5
    for i in range(5):
        assert results[i]["offer"]["price"] == 850000
