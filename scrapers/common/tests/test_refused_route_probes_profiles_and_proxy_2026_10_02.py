"""shatri (WP REST 403) and compoundin (sitemap never read) went red 2026-10-01/02 on a single pinned
browser profile with no proxy. Both now open their session through retry_smarter_session (3 profiles
DIRECT, then the residential proxy). compoundin's refused sitemap is UNKNOWN, never "no urls"."""
import importlib

import pytest


class _Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text = status, text


@pytest.mark.parametrize("mod,probe", [("scrapers.shatri.run", "/wp-json/wp/v2/property_type"),
                                       ("scrapers.compoundin.run", "/sitemap.xml")])
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


def test_compoundin_refused_sitemap_is_unknown_not_empty():
    R = importlib.import_module("scrapers.compoundin.run")

    class _S:
        def get(self, *_a, **_k):
            return _Resp(403, "<html>blocked</html>")

    with pytest.raises(RuntimeError, match="HTTP 403 — UNKNOWN"):
        R.fetch_compounds(_S())
