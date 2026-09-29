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
    def in_(self, col, vals): self._filters[col] = tuple(vals); return self
    def is_(self, *a, **k): return self
    @property
    def not_(self): return self
    def order(self, col, *a, **k): self.sink.orders.append(col); return self
    def limit(self, n): return self
    def update(self, payload): self._payload = payload; return self
    def execute(self):
        if self._payload is not None:
            self.sink.writes.append((self._filters.get("id"), dict(self._payload)))
            return type("R", (), {"data": []})()
        return type("R", (), {"data": list(self._rows)})()


class _Client:
    def __init__(self, rows):
        self.rows, self.writes, self.orders = rows, [], []
    def table(self, name): return _Table(self, name)


def _row(i, strikes=0):
    return {"id": i, "ad_number": f"DA{i}", "listing_url": REQ.format(i),
            "missing_count": strikes, "last_verified_alive_at": None}


HEALTHY = {"live": 1, "live_n": 1, "live_ok": True, "bogus_alive": False}
LOOKED = {"last_liveness_probe_at"}


def _evidence(client):
    """Every write that says something about the listing — i.e. anything beyond "we looked"."""
    return [(i, p) for i, p in client.writes if set(p) - LOOKED]


@pytest.fixture()
def wire(monkeypatch):
    """Neutralise all I/O; return a helper that runs main() against scripted probe responses."""
    run_name: list[str] = []

    def run(rows, responses, argv, sitemap=frozenset(), canary=HEALTHY):
        client = _Client(rows)
        monkeypatch.setattr(R, "_canaries", lambda c, s, budget=None: dict(canary))
        monkeypatch.setattr(R, "sb", lambda: client)
        monkeypatch.setattr(R, "begin_run", lambda name: (run_name.append(name), 1)[1])
        monkeypatch.setattr(R, "end_run", lambda *a, **k: None)
        monkeypatch.setattr(R, "_session", lambda *a, **k: object())
        monkeypatch.setattr(R, "harvest_sitemap_ids", lambda s, budget=None: sitemap)
        # The real probe charges every attempt to the budget; the fake must too, or a budget test
        # would pass by never spending anything.
        def _probe(s, url, budget=None):
            if budget is not None and not budget.spend():
                return None, "", ""
            # Scripted per AD, whichever cache-key variant probe_listing() asks for.
            return responses[url.rstrip("/").replace("/en/", "/ar/")]
        monkeypatch.setattr(R, "probe", _probe)
        monkeypatch.setattr("sys.argv", ["liveness_run", *argv])
        R.main()
        client.run_name = run_name[-1] if run_name else None
        return client
    return run


def test_unknown_writes_absolutely_nothing(wire):
    """A shell response — dealapp's documented behaviour for real AND bogus ids."""
    rows = [_row(1, strikes=2)]                      # already one strike from the grace window
    responses = {REQ.format(1): (200, "<html>ng-state, no schema</html>", REQ.format(1))}
    client = wire(rows, responses, ["--limit", "10", "--apply"])
    assert _evidence(client) == [], "an unreadable 200 must not strike, verify, or deactivate"
    assert [set(p) for _i, p in client.writes] == [LOOKED], \
        "it must still record that we LOOKED, or it sits at the head of the queue forever"


@pytest.mark.parametrize("status", [None, 403, 429, 500, 503])
def test_failed_and_blocked_reads_write_nothing(wire, status):
    rows = [_row(1, strikes=2)]
    responses = {REQ.format(1): (status, "", REQ.format(1))}
    client = wire(rows, responses, ["--limit", "10", "--apply"])
    assert _evidence(client) == []


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
    assert _evidence(client) == []


# ── The bounded proxy experiment ───────────────────────────────────────────────────────────────
# The Saudi residential proxy is ONE capacity-limited pool shared with wasalt (ARCHITECTURE.md §20
# rule 14). Exceeding it does not fail cleanly — requests plateau at a ~204s connect timeout while
# neighbours succeed in seconds, which reads as a per-slug source block and is not one. So the
# proxy path has to be opt-in, hard-capped, and visible to the contention detector.

def test_proxy_is_opt_in_and_never_the_default(wire, monkeypatch):
    """The secret being present in the environment must not be enough. A scheduled run that
    silently started consuming the shared pool is precisely the un-tuned new consumer that
    ARCHITECTURE.md §20 rule 14 exists to prevent."""
    monkeypatch.setenv("WASALT_PROXY_URL", "http://should-not-be-used.example")
    client = wire([_row(1)], {REQ.format(1): (200, SCHEMA.format(1), REQ.format(1))}, ["--limit", "1"])
    assert client.run_name == R.RUN_NAME_CI, \
        "without --proxy the run must use CI egress and log under the CI label"


def test_a_proxy_run_records_itself_under_a_name_the_contention_detector_can_see(monkeypatch):
    """A proxy consumer the contention detector cannot count is the blind spot its own text warns
    about. The two egress paths therefore log under different platform labels."""
    assert R.RUN_NAME_PROXY != R.RUN_NAME_CI
    assert R.RUN_NAME_PROXY == "dealapp_liveness_proxy"


def test_proxy_without_the_secret_fails_loudly_instead_of_falling_back(monkeypatch, capsys):
    """Silently using CI egress and reporting it as a proxy result would make the experiment
    unreadable — the whole point is comparing the two."""
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)
    monkeypatch.setattr("sys.argv", ["liveness_run", "--proxy"])
    assert R.main() == 2


def test_the_budget_caps_total_requests_including_retries():
    b = R.RequestBudget(3)
    assert [b.spend() for _ in range(5)] == [True, True, True, False, False]
    assert b.used == 3 and b.exhausted


def test_an_unset_budget_is_unlimited():
    b = R.RequestBudget(0)
    assert all(b.spend() for _ in range(1000))
    assert not b.exhausted


def test_the_budget_stops_the_sweep_and_writes_nothing_extra(wire):
    """A bounded run is a PARTIAL run, not a broken one: it stops on the boundary, and the rows it
    never reached are simply not evidence about anything."""
    rows = [_row(i, strikes=2) for i in range(1, 41)]
    responses = {REQ.format(i): (404, "", REQ.format(i)) for i in range(1, 41)}
    client = wire(rows, responses, ["--limit", "40", "--apply", "--max-requests", "5"])
    assert all(p.get("active") is not False for _i, p in client.writes), \
        "a budget-truncated run must not deactivate — it verified almost nothing, so it is quarantined"


def test_running_out_of_budget_reads_as_UNKNOWN_never_as_death():
    """The one that matters: a request we could not afford is a request we did not make."""
    b = R.RequestBudget(1)
    b.spend()
    assert R.probe(object(), "https://dealapp.sa/ar/ad-details/1", b) == (None, "", "")


# ── The rotation, the probe order, and the canaries (2026-09-28) ────────────────────────────────
# 2026-09-21..28: 312 rows were probed on all 8 runs, 159 on 7 — every one UNKNOWN. The worklist was
# ordered by last_verified_alive_at, which a shell never moves, so the head could never clear.

def test_the_worklist_rotates_on_last_liveness_probe_at(wire):
    client = wire([_row(1)], {REQ.format(1): (200, "<html>shell</html>", REQ.format(1))},
                  ["--limit", "1", "--apply"])
    assert client.orders and client.orders[0] == "last_liveness_probe_at", \
        "ordering on a column UNKNOWN never moves re-reads the same unresolvable rows every run"


def test_sitemap_present_rows_are_probed_first(wire):
    rows = [_row(1), _row(2)]                         # 1 is absent from the sitemap, 2 is present
    seen: list[str] = []
    responses = {REQ.format(i): (200, SCHEMA.format(i), REQ.format(i)) for i in (1, 2)}
    orig = dict(responses)

    class _Spy(dict):
        def __getitem__(self, k):
            seen.append(k)
            return orig[k]
    wire(rows, _Spy(responses), ["--limit", "1"], sitemap=frozenset({"2"}))
    assert seen == [REQ.format(2)]


# ── CloudFront (2026-09-28): a days-old cached shell was being read as the source's answer ──────

class _Resp:
    def __init__(self, status, text, url, age=None):
        self.status_code, self.text, self.url = status, text, url
        self.headers = {} if age is None else {"age": str(age)}


class _Sess:
    def __init__(self, by_url):
        self.by_url, self.asked = by_url, []
    def get(self, url, **k):
        self.asked.append(url)
        return self.by_url[url]


def test_an_old_cached_copy_is_not_an_answer(monkeypatch):
    monkeypatch.setattr(R, "_ORIGIN", R.OriginBudget(per_min=10_000))
    u = REQ.format(5) + "/"
    stale = _Sess({u: _Resp(200, SCHEMA.format(5), u, age=130553)})
    assert R.probe(stale, u) == (None, "", ""), "a 36-hour-old CDN copy says nothing about now"
    fresh = _Sess({u: _Resp(200, SCHEMA.format(5), u, age=40)})
    assert R.probe(fresh, u)[0] == 200


def test_a_stale_copy_on_one_cache_key_falls_through_to_a_fresh_render(monkeypatch):
    monkeypatch.setattr(R, "_ORIGIN", R.OriginBudget(per_min=10_000))
    slash, en = REQ.format(5) + "/", "https://dealapp.sa/en/ad-details/5/"
    sess = _Sess({slash: _Resp(200, "<html>wall</html>", slash, age=130553),
                  en: _Resp(200, SCHEMA.format(5), en)})
    assert R.probe_listing(sess, REQ.format(5)) == (R.ALIVE, 200)
    assert sess.asked == [slash, en], "the bare URL is the stale cache key — never ask it"


def test_a_fresh_shell_is_final_and_unknown_never_dead(monkeypatch):
    monkeypatch.setattr(R, "_ORIGIN", R.OriginBudget(per_min=10_000))
    keys = [REQ.format(9) + "/", "https://dealapp.sa/en/ad-details/9/", "https://dealapp.sa/en/ad-details/9"]
    sess = _Sess({k: _Resp(200, "<html>shell</html>", k) for k in keys})
    assert R.probe_listing(sess, REQ.format(9))[0] == R.UNKNOWN
    assert sess.asked == keys[:1], "a FRESH render is final — another key is another quota render"


def test_a_slash_stripping_redirect_is_not_read_as_moved_off_the_ad(monkeypatch):
    monkeypatch.setattr(R, "_ORIGIN", R.OriginBudget(per_min=10_000))
    slash = REQ.format(5) + "/"
    sess = _Sess({slash: _Resp(200, SCHEMA.format(5), REQ.format(5))})   # served at the bare URL
    assert R.probe_listing(sess, REQ.format(5))[0] == R.ALIVE


def test_a_bogus_id_reading_alive_blocks_every_write(wire):
    rows = [_row(i, strikes=2) for i in range(1, 41)]
    responses = {REQ.format(i): (200, SCHEMA.format(i), REQ.format(i)) for i in range(1, 41)}
    client = wire(rows, responses, ["--limit", "40", "--apply"],
                  canary={**HEALTHY, "bogus_alive": True})
    assert client.writes == [], "a page that cannot exist read ALIVE — nothing this run saw is evidence"


def test_a_failed_live_canary_quarantines_deaths_but_keeps_verifications(wire):
    alive = {i: _row(i) for i in range(1, 36)}
    dead = {i: _row(i, strikes=2) for i in range(36, 41)}
    responses = {REQ.format(i): (200, SCHEMA.format(i), REQ.format(i)) for i in alive}
    responses.update({REQ.format(i): (404, "", REQ.format(i)) for i in dead})
    client = wire([*alive.values(), *dead.values()], responses, ["--limit", "40", "--apply"],
                  canary={**HEALTHY, "live": 0, "live_ok": False})
    assert not [p for _i, p in client.writes if p.get("active") is False]
    assert len([p for _i, p in client.writes if "last_verified_alive_at" in p]) == 35


def test_canaries_probe_a_recent_alive_row_and_the_bogus_id(monkeypatch):
    urls: list[str] = []
    recent = [{"listing_url": REQ.format(7), "last_verified_alive_at": "2026-09-28"}]
    monkeypatch.setattr(R, "probe", lambda s, url, budget=None: (
        urls.append(url), (200, SCHEMA.format(7), url) if "/7" in url else
        (200, "<html>shell</html>", url))[1])
    c = R._canaries(_Client(recent), object(), None)
    assert urls[0] == REQ.format(7) + "/" and REQ.format(R.BOGUS_ADID) + "/" in urls
    assert c == {"live": 1, "live_n": 1, "live_ok": True, "bogus_alive": False}

