"""tamyaz (⚡ 2026-11-10, backlog 1643): 7 of 17 served cards had no photo.

Probe run 42762143257: every record saved since ~2026-10-07 writes its gallery as the full address
(«http://www.tamyaz-sa.com/uploads/u-1791904013725-aee4ae1f.jpg»); the old «starts with /» test dropped them all.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.tamyaz import run as R  # noqa: E402


def test_full_address_on_the_sites_own_host_is_a_photo():
    assert R.gallery_url("http://www.tamyaz-sa.com/uploads/u-1791904013725-aee4ae1f.jpg") == \
        "https://www.tamyaz-sa.com/uploads/u-1791904013725-aee4ae1f.jpg"
    assert R.gallery_url("https://tamyaz-sa.com/uploads/a b.jpg") == "https://www.tamyaz-sa.com/uploads/a%20b.jpg"


def test_relative_path_still_works_and_other_hosts_never_do():
    assert R.gallery_url("/images/villa.jpg") == "https://www.tamyaz-sa.com/images/villa.jpg"
    assert R.gallery_url("https://cdn.example.com/x.jpg") is None
    assert R.gallery_url("//evil.example/x.jpg") is None
    assert R.gallery_url("") is None and R.gallery_url(None) is None
