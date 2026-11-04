"""The fleet check gives the residential proxy to every site whose crawl needs it (2026-11-03).

sakani's crawl rides the proxy (`proxy: true` in small-sources-sync.yml) because GitHub's address is
walled; fleet-liveness.yml gave the proxy to ialqarawi only, so every sakani run read its controls
0/5 («no answer from the source») and 54 served rows at full strikes were never read. The first fix
added sakani to a typed list in fleet-liveness.yml's env — and fleet-liveness-recheck.yml, which runs
every site in ONE process, still had no proxy at all, so sakani's twice-daily recheck kept reading 0/5
(15:42 UTC that day). The list now lives once, in fleet_liveness.PROXY_SITES, and site_proxy_env()
hands the secret to that site's module only while it runs. These tests EXECUTE that.
"""
import os
import pathlib

from scrapers.common import fleet_liveness as fl

ROOT = pathlib.Path(__file__).resolve().parents[3]


def test_sakani_and_ialqarawi_are_proxy_sites():
    assert {"sakani", "ialqarawi"} <= fl.PROXY_SITES


def test_proxy_reaches_only_a_proxy_site_and_is_restored(monkeypatch):
    monkeypatch.setenv("FLEET_PROXY_URL", "http://proxy.example:1")
    monkeypatch.setenv("WASALT_PROXY_URL", "http://leaked:2")
    with fl.site_proxy_env("sakani"):
        assert os.environ["WASALT_PROXY_URL"] == "http://proxy.example:1"
    with fl.site_proxy_env("raghdan"):
        assert "WASALT_PROXY_URL" not in os.environ        # metered: never inherited by another site
    assert os.environ["WASALT_PROXY_URL"] == "http://leaked:2"


def test_no_secret_means_no_proxy(monkeypatch):
    monkeypatch.delenv("FLEET_PROXY_URL", raising=False)
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)
    with fl.site_proxy_env("sakani"):
        assert "WASALT_PROXY_URL" not in os.environ


def test_main_runs_every_site_inside_its_proxy_env(monkeypatch):
    seen = {}
    monkeypatch.setenv("FLEET_PROXY_URL", "http://proxy.example:1")
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)
    monkeypatch.setattr(fl, "recheck_order", lambda _c, sites: sites)
    monkeypatch.setattr(fl, "sb", lambda: None)
    monkeypatch.setattr(fl, "run_site", lambda site, **_k: seen.__setitem__(site, os.environ.get("WASALT_PROXY_URL")))
    monkeypatch.setattr("sys.argv", ["fleet_liveness", "--struck-only", "--site", "sakani", "--site", "raghdan"])
    assert fl.main() == 0
    assert seen == {"sakani": "http://proxy.example:1", "raghdan": None}


def test_both_workflows_pass_the_secret_and_type_no_site_list():
    for wf in ("fleet-liveness.yml", "fleet-liveness-recheck.yml"):
        text = (ROOT / ".github/workflows" / wf).read_text()
        assert "FLEET_PROXY_URL: ${{ secrets.WASALT_PROXY_URL }}" in text, wf
        assert "matrix.site) && secrets.WASALT_PROXY_URL" not in text, wf


# Deliberately NOT «every site whose crawl rides the proxy»: measured 2026-11-03, 19 fleet sites
# carry `proxy: true` on their crawl, and over two days only sakani's fleet controls failed on
# transport (5 of 6 runs «no answer»); the others read direct. The proxy is paid (rule 8), so a site
# joins PROXY_SITES on a measured transport failure, not by inheritance.
