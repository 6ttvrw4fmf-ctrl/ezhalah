"""Wiring proof for the dealapp liveness runner.

classify_dealapp(), decide(), environment_is_trustworthy() and verification_patch() are each proven
elsewhere. What this file proves is that the RUNNER actually calls them — and, more importantly,
that it writes nothing in the cases where they say nothing may be written. A runner can import a
perfect contract and still deactivate on an UNKNOWN because someone wrote the update outside the
branch that checks it; no unit test of the contract would notice.

Every write goes through a fake client that records it, so "nothing was written" is asserted as
data rather than assumed.
"""
from __future__ import annotations

import pytest

import scrapers.dealapp.liveness_run as R

REQ = "https://dealapp.sa/ar/ad-details/{}"
SCHEMA = '{{"@id":"real-estate-listing-schema-{}"}}'


class _Table:
    def __init__(self, sink, name):
        self.sink, self.name, self._payload, self._filters = sink, name, None, {}
        self._rows = sink.rows
    def select(self, *a, **k): return self
    def eq(self, col, val): self._filters[col] = val; return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    def update(self, payload): self._payload = payload; return self
    def execute(self):
        if self._payload is not None:
            self.sink.writes.append((self._filters.get("id"), dict(self._payload)))
            return type("R", (), {"data": []})()
        return type("R", (), {"data": list(self._rows)})()


class _Client:
    def __init__(self, rows):
        self.rows, self.writes = rows, []
    def table(self, name): return _Table(self, name)


def _row(i, strikes=0):
    return {"id": i, "ad_number": f"DA{i}", "listing_url": REQ.format(i),
            "missing_count": strikes, "last_verified_alive_at": None}


@pytest.fixture()
def wire(monkeypatch):
    """Neutralise all I/O; return a helper that runs main() against scripted probe responses."""
    def run(rows, responses, argv, sitemap=frozenset()):
        client = _Client(rows)
        monkeypatch.setattr(R, "sb", lambda: client)
        monkeypatch.setattr(R, "begin_run", lambda name: 1)
        monkeypatch.setattr(R, "end_run", lambda *a, **k: None)
        monkeypatch.setattr(R, "_session", lambda: object())
        monkeypatch.setattr(R, "harvest_sitemap_ids", lambda s: sitemap)
        monkeypatch.setattr(R, "probe", lambda s, url: responses[url])
        monkeypatch.setattr("sys.argv", ["liveness_run", *argv])
        R.main()
        return client
    return run


def test_unknown_writes_absolutely_nothing(wire):
    """A shell response — dealapp's documented behaviour for real AND bogus ids."""
    rows = [_row(1, strikes=2)]                      # already one strike from the grace window
    responses = {REQ.format(1): (200, "<html>ng-state, no schema</html>", REQ.format(1))}
    client = wire(rows, responses, ["--limit", "10", "--apply"])
    assert client.writes == [], "an unreadable 200 must not strike, verify, or deactivate"


@pytest.mark.parametrize("status", [None, 403, 429, 500, 503])
def test_failed_and_blocked_reads_write_nothing(wire, status):
    rows = [_row(1, strikes=2)]
    responses = {REQ.format(1): (status, "", REQ.format(1))}
    client = wire(rows, responses, ["--limit", "10", "--apply"])
    assert client.writes == []


def test_alive_stamps_verification_and_clears_strikes(wire):
    rows = [_row(1, strikes=2)]
    responses = {REQ.format(1): (200, SCHEMA.format(1), REQ.format(1))}
    client = wire(rows, responses, ["--limit", "10", "--apply"])
    assert len(client.writes) == 1
    _id, patch = client.writes[0]
    assert patch["missing_count"] == 0
    assert "last_verified_alive_at" in patch, "a proven-alive row must record WHEN it was proven"


def test_dry_run_writes_nothing_even_on_a_clear_death(wire):
    rows = [_row(i, strikes=2) for i in range(1, 40)]
    responses = {REQ.format(i): (404, "", REQ.format(i)) for i in range(1, 40)}
    client = wire(rows, responses, ["--limit", "40"])          # no --apply
    assert client.writes == []


def test_dry_run_writes_nothing_on_the_ALIVE_path_either(wire):
    """The death path and the verification path are gated by DIFFERENT branches. An earlier draft
    of this file only exercised 404s, so a mutation that let a dry run stamp
    last_verified_alive_at survived every test — a report-only run writing to production."""
    rows = [_row(i, strikes=2) for i in range(1, 40)]
    responses = {REQ.format(i): (200, SCHEMA.format(i), REQ.format(i)) for i in range(1, 40)}
    client = wire(rows, responses, ["--limit", "40"])          # no --apply
    assert client.writes == [], "a dry run must not stamp verification either"


def test_a_shelled_run_quarantines_and_deactivates_nothing(wire):
    """0 verified out of 40 probes ⇒ we are being served shells ⇒ the 404s are not evidence.
    This is the failure that would otherwise mass-kill live inventory."""
    rows = [_row(i, strikes=2) for i in range(1, 41)]
    responses = {REQ.format(i): (404, "", REQ.format(i)) for i in range(1, 41)}
    client = wire(rows, responses, ["--limit", "40", "--apply"])
    assert all("active" not in p for _i, p in client.writes), \
        "no row may be deactivated by a run that verified nothing"


def test_a_trusted_run_does_deactivate_at_the_grace_boundary(wire):
    """The other direction: with a healthy verified rate, a confirmed death at full grace must
    actually leave search — otherwise dead inventory just accumulates differently."""
    alive = {i: _row(i, strikes=0) for i in range(1, 36)}      # 35 alive → trusted
    dead = {i: _row(i, strikes=2) for i in range(36, 41)}      # 5 at grace-1 → deactivate
    rows = [*alive.values(), *dead.values()]
    responses = {REQ.format(i): (200, SCHEMA.format(i), REQ.format(i)) for i in alive}
    responses.update({REQ.format(i): (404, "", REQ.format(i)) for i in dead})
    client = wire(rows, responses, ["--limit", "40", "--apply"])
    deactivations = [(i, p) for i, p in client.writes if p.get("active") is False]
    assert len(deactivations) == 5
    assert all(p["missing_count"] == 3 for _i, p in deactivations)


def test_sitemap_absence_alone_never_deactivates(wire):
    """3,244 active rows are absent from dealapp's sitemap. Absence orders probing; it is the
    DIRECT verdict that decides, and here every direct verdict is UNKNOWN."""
    rows = [_row(i, strikes=2) for i in range(1, 41)]
    responses = {REQ.format(i): (200, "<html>shell</html>", REQ.format(i)) for i in range(1, 41)}
    client = wire(rows, responses, ["--limit", "40", "--apply"], sitemap=frozenset())
    assert client.writes == []
