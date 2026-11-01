"""shatri went red 2026-10-02 on a WP REST 403 to the runner IP, on a single pinned browser profile with
no proxy. It now opens its session through retry_smarter_session (3 profiles DIRECT, then the
residential proxy)."""
import importlib

import pytest


@pytest.mark.parametrize("mod,probe", [("scrapers.shatri.run", "/wp-json/wp/v2/property_type")])
def test_main_opens_its_session_through_the_profile_and_proxy_probe(monkeypatch, mod, probe):
    R = importlib.import_module(mod)
    seen = {}

    class _Stop(Exception):
        pass

    def fake_probe(url, **kw):
        seen["url"], seen["headers"] = url, kw.get("headers")
        raise _Stop

    monkeypatch.setattr(R, "retry_smarter_session", fake_probe)
    monkeypatch.setattr("sys.argv", ["run", "--dry-run"])
    with pytest.raises(_Stop):
        R.main()
    assert probe in seen["url"] and seen["headers"] == R.HEADERS

