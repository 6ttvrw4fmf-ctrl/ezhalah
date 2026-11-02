"""Gathern sweep 2026-10-27 09:37 UTC: one 200-row alive update hit statement_timeout (57014)
and killed the run (readings lost, lock held 2 h, the 10:37 sweep skipped). An alive stamp must
split and retry on 57014, leave a row that still fails unstamped, and never raise."""
from scrapers.gathern import liveness as lv


class _Q:
    def __init__(self, client, patch):
        self.client, self.patch, self.ids = client, patch, None

    def in_(self, col, ids):
        self.ids = list(ids)
        return self

    def execute(self):
        self.client.calls.append(list(self.ids))
        if len(self.ids) > self.client.max_ok or any(i in self.client.poison for i in self.ids):
            raise Exception({"code": "57014", "message": "canceling statement due to statement timeout"})
        self.client.stamped.extend(self.ids)
        return self


class _T:
    def __init__(self, client):
        self.client = client

    def update(self, patch):
        return _Q(self.client, patch)


class _Client:
    def __init__(self, max_ok, poison=()):
        self.max_ok, self.poison = max_ok, set(poison)
        self.calls, self.stamped = [], []

    def table(self, name):
        assert name == lv.TABLE
        return _T(self)


def test_timeout_splits_and_stamps_every_row():
    c = _Client(max_ok=12)
    ids = list(range(50))
    assert lv._stamp_alive_chunk(c, ids, {"missing_count": 0}) == 50
    assert sorted(c.stamped) == ids


def test_a_row_that_always_times_out_is_left_unstamped_and_never_raises():
    c = _Client(max_ok=50, poison={7})
    ids = list(range(20))
    assert lv._stamp_alive_chunk(c, ids, {"missing_count": 0}) == 19
    assert 7 not in c.stamped and len(c.stamped) == 19


def test_other_errors_still_raise():
    class Boom(_Client):
        def table(self, name):
            raise RuntimeError("PGRST301 jwt expired")
    try:
        lv._stamp_alive_chunk(Boom(50), [1, 2], {})
    except RuntimeError:
        return
    raise AssertionError("a non-timeout error must not be swallowed")


def test_chunk_is_small():
    assert lv.ALIVE_WRITE_CHUNK <= 50
