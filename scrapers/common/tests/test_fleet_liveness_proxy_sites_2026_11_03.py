"""The daily fleet check gives the residential proxy to every site whose crawl needs it (2026-11-03).

sakani's crawl rides the proxy (`proxy: true` in small-sources-sync.yml) because GitHub's address is
walled; fleet-liveness.yml gave the proxy to ialqarawi only, so every sakani run read its controls
0/5 («no answer from the source») and 54 served rows at full strikes were never read.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]


def _proxy_sites() -> set[str]:
    text = (ROOT / ".github/workflows/fleet-liveness.yml").read_text()
    m = re.search(r"WASALT_PROXY_URL: \$\{\{ contains\(fromJSON\('(\[[^\]]*\])'\), matrix\.site\)", text)
    assert m, "fleet-liveness.yml no longer passes WASALT_PROXY_URL by site"
    import json
    return set(json.loads(m.group(1)))


def test_sakani_gets_the_proxy_in_the_fleet_check():
    assert "sakani" in _proxy_sites()


def test_ialqarawi_keeps_the_proxy():
    assert "ialqarawi" in _proxy_sites()


# Deliberately NOT «every site whose crawl rides the proxy»: measured 2026-11-03, 19 fleet sites
# carry `proxy: true` on their crawl, and over two days only sakani's fleet controls failed on
# transport (5 of 6 runs «no answer»); the others read direct. The proxy is paid (rule 8), so a site
# joins this list on a measured transport failure, not by inheritance.
