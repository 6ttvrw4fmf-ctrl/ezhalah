"""The four things that make wasalt readable again — each one alone breaks it.

wasalt.sa tightened Cloudflare bot protection on 2026-08-17 and NOTHING read it for a month
(GitHub issue #1019). The working combination was found on 2026-09-18 and needed all four of:

  1. a REAL browser              — the challenge is JavaScript; no http client can pass it
  2. headless=False              — headless Chromium is detected and the challenge never clears
  3. the residential proxy       — Cloudflare also refuses the runner's datacenter IP
  4. HTTP/1.1 (no h2, no QUIC)   — ★ the one nobody had tried

Measured, in this order, each step changing exactly one thing:

  headless, laptop IP, no proxy        -> 403, challenge never clears (waited 24s)
  HEADED,   laptop IP, no proxy        -> 200 in 4.7s, 32 listings          <- browser matters
  HEADED,   RUNNER IP, no proxy        -> 403, challenge never clears       <- IP matters
  HEADED,   RUNNER IP, proxy, h2 on    -> net::ERR_TIMED_OUT every slice    <- protocol matters
  HEADED,   RUNNER IP, proxy, HTTP/1.1 -> "✓ apartment/sale: 89 upserted"   <- WORKS

(4) is why a month of work missed it: every earlier attempt varied the client or the IP, and the
actual discriminator was the HTTP version. Issue #1019's own conclusion — "not something a proxy
swap or a concurrency tweak can fix" — was right about those two and stopped one variable short.

This file pins each of the four so a later tidy-up cannot quietly undo them. They look like style
choices and are not: `headless=True` is the obvious "cleanup", and `--disable-http2` looks like a
stale workaround.

Run: python -m pytest scrapers/common/tests/test_wasalt_browser_cloudflare_path.py -v
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.wasalt import browser as B  # noqa: E402

_SRC = inspect.getsource(B)


def _code_only(src: str) -> str:
    """Strip comment lines. The module DOCUMENTS why headless=True is wrong, so a naive substring
    check over the raw source fails on its own explanation — a comment is not a code path, and it
    must not be able to fail (or satisfy) a code assertion either."""
    return "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))


_ENSURE = _code_only(inspect.getsource(B.BrowserFetcher._ensure))


# ── 1-2-4. the launch shape, asserted on the EXECUTABLE launch call ──────────────────────────────
def test_headless_is_false():
    # The single change that turns a working scraper back into a 403.
    assert "headless=False" in _ENSURE, (
        "headless=False is load-bearing: headless Chromium is detected by Cloudflare and the "
        "challenge never clears. Measured 2026-09-18 — headless 403, headed 200.")
    assert "headless=True" not in _ENSURE, (
        "the LAUNCH CALL must not be headless (the docstring may discuss it; the code may not)")


@pytest.mark.parametrize("flag", ["--disable-http2", "--disable-quic"])
def test_http1_1_is_forced(flag):
    assert flag in _ENSURE, (
        f"{flag} is load-bearing. With HTTP/2 the residential proxy silently null-routes the "
        f"browser and every navigation dies at net::ERR_TIMED_OUT; forcing HTTP/1.1 is what "
        f"produced the first successful sweep in a month.")


def test_automation_flag_is_disabled():
    assert "--disable-blink-features=AutomationControlled" in _ENSURE


# ── 3. the proxy, in the shape CHROMIUM wants (not the shape every other client wants) ───────────
def test_proxy_credentials_are_split_out(monkeypatch):
    """Chromium rejects inline credentials with ERR_INVALID_AUTH_CREDENTIALS, which reads exactly
    like a Cloudflare block. curl_cffi/requests/httpx all accept the inline form, so this is the
    easy mistake — it cost a CI round on 2026-09-18."""
    monkeypatch.setattr(B, "_STICKY", False)   # port rewriting is tested separately below
    got = B._playwright_proxy("http://user123:p%40ss@gw.example.com:823")
    assert got == {"server": "http://gw.example.com:823",
                   "username": "user123",
                   "password": "p@ss"}, got
    # the URL-encoded password must be decoded, or auth fails against a password containing @ or :
    assert got["password"] == "p@ss"


def test_proxy_accepts_a_bare_host_and_empty(monkeypatch):
    monkeypatch.setattr(B, "_STICKY", False)
    assert B._playwright_proxy("gw.example.com:823") == {"server": "http://gw.example.com:823"}
    assert B._playwright_proxy("") is None
    assert B._playwright_proxy("   ") is None


# ── sticky sessions: one exit IP for every sub-request of a page ────────────────────────────────
def test_the_rotating_port_is_swapped_for_a_sticky_one():
    """A browser issues many sub-requests per page. On the rotating gateway each lands on a
    different exit, Cloudflare sees a session hopping between IPs and drops it — measured as
    net::ERR_TIMED_OUT on 15 of 20 slices even WITH a retry ladder. One sticky port == one stable
    exit, which is what a real browser looks like."""
    got = B._playwright_proxy(f"http://u:p@gw.example.com:{B._ROTATING_PORT}")
    port = int(got["server"].rsplit(":", 1)[1])
    assert port != B._ROTATING_PORT, "the rotating gateway port must not survive"
    assert B._STICKY_LO <= port <= B._STICKY_HI, f"{port} is outside the plan's sticky range"


def test_an_already_sticky_port_is_left_alone():
    fixed = B._STICKY_LO + 500
    got = B._playwright_proxy(f"http://u:p@gw.example.com:{fixed}")
    assert got["server"].endswith(f":{fixed}")


def test_each_session_gets_its_own_sticky_exit():
    """Retries recycle the context, and a retry that reused the same dead exit would spend the
    ladder for nothing — so successive calls must be able to differ."""
    ports = {int(B._playwright_proxy(f"http://u:p@gw.example.com:{B._ROTATING_PORT}")
                 ["server"].rsplit(":", 1)[1]) for _ in range(40)}
    assert len(ports) > 1, "every session drew the same sticky port — that is not a fresh exit"


def test_proxy_server_never_carries_the_credentials():
    # If the secret leaked into `server` it would be printed by any caller that logs the proxy.
    got = B._playwright_proxy("http://leaky:secret@gw.example.com:823")
    assert "leaky" not in got["server"] and "secret" not in got["server"]


# ── the retry ladder: a flaky residential exit is not a verdict ──────────────────────────────────
def test_there_is_a_retry_ladder_that_rotates_the_exit():
    assert B._ATTEMPTS >= 2, "one attempt against a rotating residential pool is not a ladder"
    src = inspect.getsource(B.BrowserFetcher.next_data)
    assert "_recycle" in src, (
        "each retry must tear the context down so it lands on a NEW proxy exit — retrying on the "
        "same dead exit spends the ladder for nothing. This is the browser's s.rotate().")
    assert "_next_data_once" in src


def test_recycle_clears_the_context_so_a_new_exit_is_taken():
    src = inspect.getsource(B.BrowserFetcher._recycle)
    assert "self._ctx = self._browser = None" in src, (
        "_recycle must null the context/browser or _ensure() will reuse the same dead exit")


# ── the failure contract: None is NOT an empty result ────────────────────────────────────────────
def test_a_failure_returns_none_and_is_never_an_empty_page():
    """None means "no parseable answer" and maps to fetch_page()'s valid=False. If a failure ever
    returned an empty dict instead, a Cloudflare shell would be indistinguishable from a genuinely
    empty category and the fail-visibly guard would read a block as "this slug has no listings"."""
    f = BrokenFetcher()
    assert f.next_data("https://wasalt.sa/whatever") is None


class BrokenFetcher(B.BrowserFetcher):
    """Every attempt fails — the ladder must exhaust and return None, not raise and not {}."""

    def _next_data_once(self, url: str):  # type: ignore[override]
        return None

    def _recycle(self) -> None:  # no real browser to tear down
        pass


def test_the_module_never_imports_playwright_at_module_scope():
    """Importing scrapers.wasalt.run must not require playwright — the http path still has to work
    on a machine (or a test run) that has no browser installed."""
    assert "from playwright" not in _SRC.split("def _ensure")[0], (
        "playwright must be imported lazily inside _ensure(), not at module scope")


def test_images_and_fonts_are_blocked_but_scripts_are_not():
    """Bandwidth: the scraper only ever reads __NEXT_DATA__. But the challenge IS JavaScript, so
    blocking scripts would break the very thing this module exists to do."""
    assert "script" not in B._BLOCKED_RESOURCE_TYPES, (
        "blocking scripts would make the Cloudflare challenge unsolvable")
    assert {"image", "font", "media"} <= B._BLOCKED_RESOURCE_TYPES


# ── 6. the driver starts ONCE per process — EXECUTED against a stub playwright ────────────────────
#
# _recycle() drops the browser+context to get a new proxy exit but KEEPS the driver. _ensure() used
# to call sync_playwright().start() unconditionally, so the first recycle started a SECOND driver in
# the same thread and Playwright refused it:
#     "It looks like you are using Playwright Sync API inside the asyncio loop."
# Chromium then never launched, so every slice reported "no __NEXT_DATA__" and the failure was
# indistinguishable from a Cloudflare block. Measured in CI as recycling increased: 9/20 -> 6/20 ->
# 3/20 slices. This test executes the real _ensure/_recycle against a stub driver and counts starts.

class _StubPage:
    def close(self): pass


class _StubCtx:
    def add_init_script(self, *a, **k): pass
    def route(self, *a, **k): pass
    def new_page(self): return _StubPage()
    def close(self): pass


class _StubBrowser:
    def new_context(self, **k): return _StubCtx()
    def close(self): pass


class _StubChromium:
    def launch(self, **k): return _StubBrowser()


class _StubDriver:
    def __init__(self): self.chromium = _StubChromium()
    def stop(self): pass


def test_recycling_does_not_start_a_second_playwright_driver(monkeypatch):
    starts = []

    class _Factory:
        def start(self):
            starts.append(1)
            return _StubDriver()

    import playwright.sync_api as _sa
    monkeypatch.setattr(_sa, "sync_playwright", lambda: _Factory())
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)

    f = B.BrowserFetcher()
    f._ensure()
    for _ in range(5):          # what _ensure_warm does while hunting a live exit
        f._recycle()
        f._ensure()

    assert starts == [1], (
        f"sync_playwright().start() ran {len(starts)}x — a second driver in one thread raises "
        f"'Playwright Sync API inside the asyncio loop' and Chromium never launches"
    )


def test_close_still_stops_the_driver(monkeypatch):
    # The guard must not turn into a leak: the ONE driver still has to be stopped at the end.
    stopped = []

    class _D(_StubDriver):
        def stop(self): stopped.append(1)

    import playwright.sync_api as _sa
    monkeypatch.setattr(_sa, "sync_playwright", lambda: type("F", (), {"start": lambda s: _D()})())
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)

    f = B.BrowserFetcher()
    f._ensure()
    f.close()
    assert stopped == [1], "close() must stop the driver it started"
    assert f._pw is None, "close() must clear the driver so a later _ensure can start a fresh one"
