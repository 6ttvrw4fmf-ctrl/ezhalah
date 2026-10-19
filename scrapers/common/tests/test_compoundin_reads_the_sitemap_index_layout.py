"""compoundin moved to a sitemap INDEX and /compounds/<city>/<slug> on 2026-10-02; the flat sitemap then
held no /rent/show/ url and every crawl failed («sitemap returned no /rent/show/ urls»)."""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

import scrapers.compoundin.run as R  # noqa: E402


def _xml(*locs):
    return "<urlset>" + "".join(f"<url><loc>{u}</loc></url>" for u in locs) + "</urlset>"


class _S:
    PAGES = {
        "https://compoundin.com/sitemap.xml": _xml("https://compoundin.com/sitemap-areas.xml",
                                                   "https://compoundin.com/sitemap-compounds.xml"),
        "https://compoundin.com/sitemap-areas.xml": _xml("https://compoundin.com/compounds/riyadh/al-narjis"),
        "https://compoundin.com/sitemap-compounds.xml": _xml(
            "https://compoundin.com/compounds/riyadh/rotunda-compound",
            "https://compoundin.com/compounds/riyadh/rotunda-compound/villas",
            "https://compoundin.com/compounds/khobar/refad-compound"),
    }

    def get(self, url, timeout=None):
        body = self.PAGES.get(url)
        return types.SimpleNamespace(status_code=200 if body else 404, text=body or "")


def test_compounds_come_from_the_index_child_and_only_compound_pages():
    assert R.fetch_compounds(_S()) == ["https://compoundin.com/compounds/khobar/refad-compound",
                                       "https://compoundin.com/compounds/riyadh/rotunda-compound"]


def test_the_old_flat_layout_still_reads():
    class _Old:
        def get(self, url, timeout=None):
            return types.SimpleNamespace(status_code=200, text=_xml(
                "https://compoundin.com/rent/show/abc/rotunda-compound", "https://compoundin.com/blog/x"))
    assert R.fetch_compounds(_Old()) == ["https://compoundin.com/rent/show/abc/rotunda-compound"]


def test_the_city_is_read_from_the_pages_own_address(monkeypatch):
    monkeypatch.setattr(R, "is_delisted", lambda html: False)
    monkeypatch.setattr(R, "compound_location", lambda html: (None, None))   # the page text names no city
    monkeypatch.setattr(R, "to_catalog", lambda city_ar: (None, None))
    rows, why = R.map_units("https://compoundin.com/compounds/khobar/refad-compound", "<html></html>")
    assert why not in ("no_city", "city_not_mapped")      # «khobar» came from the url and is a known city
    rows, why = R.map_units("https://compoundin.com/compounds/atlantis/x", "<html></html>")
    assert why == "city_not_mapped"                       # an unknown slug is still never guessed
