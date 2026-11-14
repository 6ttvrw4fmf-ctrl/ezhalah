"""A SHADOW site that reads ads dead must raise, not sit silent (♻️ 2026-11-14).

sanadak, opensooq and sakan read 44 shown ads dead at every pass for days and hid none; the only
trace was `would_hide=` in a run note. fleet_liveness.shadow_alarm turns that into a P2 for the
lifecycle lane and resolves it on a clean daily shadow pass."""
from scrapers.common import fleet_liveness as fl


class _Call:
    def __init__(self, log, name, args):
        self.log, self.name, self.args = log, name, args

    def execute(self):
        self.log.append((self.name, self.args))
        return type("R", (), {"data": 1})()


class _Client:
    def __init__(self):
        self.log = []

    def rpc(self, name, args):
        return _Call(self.log, name, args)


def test_would_hide_raises_a_p2_for_the_site():
    c = _Client()
    assert fl.shadow_alarm(c, "sanadak", ["sanadak_residential_listings:22719417 https://x — gone"]) == 1
    (name, args), = c.log
    assert name == "mon_raise" and args["p_kind"] == fl.SHADOW_KIND and args["p_platform"] == "sanadak"
    assert args["p_dedup"] == f"{fl.SHADOW_KIND}:sanadak" and args["p_detail"]["would_hide"] == 1


def test_clean_daily_shadow_pass_resolves():
    c = _Client()
    fl.shadow_alarm(c, "remal", [])
    assert c.log == [("mon_resolve_key", {"p_kind": fl.SHADOW_KIND, "p_dedup": f"{fl.SHADOW_KIND}:remal"})]


def test_clean_recheck_does_not_resolve():
    c = _Client()
    fl.shadow_alarm(c, "remal", [], struck_only=True)
    assert c.log == []


def test_alarm_failure_never_raises_out_of_the_run():
    class Boom:
        def rpc(self, *a):
            raise RuntimeError("network")
    assert fl.shadow_alarm(Boom(), "sanadak", ["x"]) == 0


def test_run_site_calls_the_alarm_only_for_sites_outside_apply():
    import inspect
    src = inspect.getsource(fl.run_site)
    assert "if site not in APPLY and not st[\"quarantined\"]:" in src and "shadow_alarm(client, site" in src
    assert "sanadak" in fl.APPLY and "opensooq" in fl.APPLY
