"""nowaisiry / hazim / goldendeal read the item's own Maps link (owner 2026-10-20 night)."""
from pathlib import Path

import scrapers.goldendeal.run as GD

ROOT = Path(__file__).resolve().parents[3]


def test_goldendeal_plain_maps_link_in_the_item_is_the_pin(monkeypatch):
    monkeypatch.setattr(GD, "resolve_redirect", lambda s, u: (_ for _ in ()).throw(AssertionError("no hop needed")))
    L = {"id": 50963, "latitude": None, "description": '<a href="https://maps.google.com/?q=21.76736,39.07099">الموقع</a>'}
    assert GD._short_link_pin(L) == {"latitude": 21.76736, "longitude": 39.07099}


def test_wiring():
    t = lambda p: (ROOT / "scrapers" / p / "run.py").read_text(encoding="utf-8")
    assert "**pin_from_page(json.dumps(p, ensure_ascii=False))," in t("nowaisiry")
    assert "**pin_from_page(json.dumps(p, ensure_ascii=False))," in t("hazim")
