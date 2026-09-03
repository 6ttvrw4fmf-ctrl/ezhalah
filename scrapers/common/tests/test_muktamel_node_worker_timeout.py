"""Regression test for scrapers/muktamel/run.py:_NodeWorker (2026-09-03).

The bug: a single persistent `node worker.js` process parses every NUXT payload behind ONE shared
lock across all 8 fetch threads (scrapers/muktamel/run.py `_get_worker()`/`_node_singleton`). The
read/write calls to that subprocess (`_read_line`, `_read_exact`, `_write_all`) had NO timeout — if
the node process ever hung (stuck inside `eval()` on a pathological payload, or the pipe wedged),
every future `.parse()` call blocked FOREVER waiting for `self.lock`, and the crawl produced zero
rows for its entire run. This is the confirmed root cause of "muktamel never completes a single
full-range crawl, zero progress-log lines printed" (paused 2026-07-15, see
scrapers/RETIRED_PLATFORMS.txt and docs/ARCHITECTURE.md) — reproduced live 2026-09-03: a
GitHub Actions dispatch scoped to just 21 ids (min-id 24000, max-id 24020) ran for 57 minutes,
upserted 0 rows, and had to be cancelled by hand. 21 pages cannot take 57 minutes on a normal
fetch; the run was not slow, it was deadlocked.

Fix: NODE_PARSE_TIMEOUT bounds a single parse() exchange with a watchdog `threading.Timer` that
kills the specific stuck process object (not whatever self.proc happens to be by the time the
timer fires) if it hasn't answered in time. The killed process's pipe closing unblocks the pending
read/write with an OS-level EOF/BrokenPipeError, `parse()` returns None for that one listing (same
contract as any other unparseable payload), and the worker respawns cleanly on the next call — so
one bad payload costs at most ~2×NODE_PARSE_TIMEOUT, never the rest of the crawl.

This test drives the REAL `_NodeWorker` class (not a reimplementation) against a throwaway JS
helper that implements the same length-prefixed stdin/stdout protocol as the production
`_NODE_WORKER_JS`, but deliberately never answers a payload of "HANG" — reproducing the exact
subprocess-hang shape without needing a live muktamel.com page.

Run: python -m pytest scrapers/common/tests/test_muktamel_node_worker_timeout.py -v
"""
import os
import sys
import tempfile
import threading
import time

sys.path.insert(0, ".")

from scrapers.muktamel import run as muktamel_run  # noqa: E402

# Same length-prefixed protocol as production's _NODE_WORKER_JS, but the body under test: a
# payload of literally "HANG" is never answered (simulates a node process wedged in an infinite
# loop / eval() that never returns); anything else is echoed back as {"echo": <payload>}.
_FAKE_WORKER_JS = r"""
const fs = require('fs');
function readN(n){
  const buf = Buffer.alloc(n); let off = 0;
  while (off < n){
    let r;
    try { r = fs.readSync(0, buf, off, n - off, null); }
    catch (e){ if (e.code === 'EAGAIN') { continue; } if (e.code === 'EOF') return null; throw e; }
    if (r === 0) return null;
    off += r;
  }
  return buf;
}
function readLine(){
  const bytes = [];
  while (true){
    const b = readN(1);
    if (b === null) return null;
    if (b[0] === 10) break;
    bytes.push(b[0]);
  }
  return Buffer.from(bytes).toString('utf8');
}
function emit(s){
  const ob = Buffer.from(s, 'utf8');
  process.stdout.write(ob.length + "\n");
  if (ob.length) process.stdout.write(ob);
}
while (true){
  const header = readLine();
  if (header === null) break;
  const len = parseInt(header, 10);
  if (!(len > 0)){ emit(""); continue; }
  const body = readN(len);
  if (body === null) break;
  const src = body.toString('utf8');
  if (src === 'HANG') {
    // Simulate a wedged worker: read the payload, then never respond, ever.
    while (true) { require('child_process').execSync('sleep 3600'); }
  }
  emit(JSON.stringify({ echo: src }));
}
"""


def _write_fake_helper() -> str:
    fd, path = tempfile.mkstemp(suffix=".js", prefix="muktamel_fake_worker_")
    with os.fdopen(fd, "w") as f:
        f.write(_FAKE_WORKER_JS)
    return path


def test_hung_node_process_is_killed_within_bounded_time_not_forever(monkeypatch):
    # Small timeout so the test itself stays fast — production uses 20s, the mechanism is identical.
    # raising=False: pre-fix code has no NODE_PARSE_TIMEOUT attribute at all (no watchdog exists),
    # which is exactly the state this test must also fail loudly against, by hanging.
    monkeypatch.setattr(muktamel_run, "NODE_PARSE_TIMEOUT", 1.0, raising=False)
    helper = _write_fake_helper()
    worker = muktamel_run._NodeWorker(helper)
    try:
        t0 = time.monotonic()
        result = worker.parse("HANG")
        elapsed = time.monotonic() - t0

        # The old code (no watchdog) would block here forever — this test would hang the CI job
        # itself if the fix regressed, which is the strongest possible regression signal. The
        # bounded assertion is what actually proves the fix: two attempts (parse()'s own retry
        # loop) at NODE_PARSE_TIMEOUT=1.0s each must finish in well under, say, 10s.
        assert elapsed < 10.0, (
            f"parse() on a hung worker took {elapsed:.1f}s — the watchdog did not bound it "
            "(this is the exact deadlock that stalled every muktamel crawl to zero rows)"
        )
        assert result is None  # a hung payload must be skipped, never fabricated as data
    finally:
        worker.close()
        os.unlink(helper)


def test_worker_respawns_and_serves_the_next_call_after_a_kill(monkeypatch):
    monkeypatch.setattr(muktamel_run, "NODE_PARSE_TIMEOUT", 1.0, raising=False)
    helper = _write_fake_helper()
    worker = muktamel_run._NodeWorker(helper)
    try:
        hung = worker.parse("HANG")
        assert hung is None

        # The worker must self-heal: a normal payload right after a kill must succeed, not stay
        # broken because self.proc was left pointing at a dead process.
        ok = worker.parse("hello")
        assert ok == {"echo": "hello"}
    finally:
        worker.close()
        os.unlink(helper)


def test_one_stuck_call_does_not_permanently_block_other_threads(monkeypatch):
    # Two threads share ONE _NodeWorker (matching production's single _node_singleton). A hang in
    # one thread's call must not permanently starve a concurrent thread waiting on the same lock —
    # it must be released (via the kill) within NODE_PARSE_TIMEOUT, not held forever.
    monkeypatch.setattr(muktamel_run, "NODE_PARSE_TIMEOUT", 1.0, raising=False)
    helper = _write_fake_helper()
    worker = muktamel_run._NodeWorker(helper)
    results: dict = {}

    def hang_caller():
        results["hang"] = worker.parse("HANG")

    def normal_caller():
        # Give the hang call a head start so it holds the lock first.
        time.sleep(0.2)
        results["normal"] = worker.parse("world")

    try:
        t1 = threading.Thread(target=hang_caller)
        t2 = threading.Thread(target=normal_caller)
        t0 = time.monotonic()
        t1.start()
        t2.start()
        t1.join(timeout=15)
        t2.join(timeout=15)
        elapsed = time.monotonic() - t0

        assert not t1.is_alive() and not t2.is_alive(), "a thread never returned — still deadlocked"
        assert elapsed < 15.0
        assert results.get("hang") is None
        assert results.get("normal") == {"echo": "world"}
    finally:
        worker.close()
        os.unlink(helper)
