"""cleanup re-reads a nowaisiry ad by its OWN post id, never by a re-used slug (♻️ 2026-11-10).

NW4349's stored slug answers 200 for post 4513; /?p=4349 answers 404. The cleanup read the slug and
revived the ad prune had hidden on its own-id 404 (11-07 → revived 11-10 06:14, alert
false_resurrection), so a dead ad went back on screen and opened another ad's page.
"""
from scrapers.common import cleanup

REG = cleanup.PLATFORMS["nowaisiry"]
ROW = {"id": 646429, "ad_number": "NW4349"}
SLUG = "https://alnowaisiry.com/lands/some-reused-slug/"


def _site(pages):
    seen = []

    def probe(url):
        seen.append(url)
        return pages.get(url, (404, "<body class='error404'>"))
    return probe, seen


def test_reused_slug_200_for_another_post_is_not_a_revival():
    probe, seen = _site({SLUG: (200, "<body class='postid-4513'>farm</body>"),
                         "https://alnowaisiry.com/?p=4349": (404, "<body class='error404'>")})
    v, why, status, _b, read = cleanup.own_page_verdict(REG, ROW, SLUG, probe=probe)
    assert seen == ["https://alnowaisiry.com/?p=4349"]
    assert (v, status, read) == ("dead", 404, "https://alnowaisiry.com/?p=4349")


def test_own_id_page_naming_this_post_is_live():
    probe, _ = _site({"https://alnowaisiry.com/?p=4349": (200, "<body class='single postid-4349'>")})
    assert cleanup.own_page_verdict(REG, ROW, SLUG, probe=probe)[0] == "live"


def test_200_naming_another_post_is_unknown_not_live():
    probe, _ = _site({"https://alnowaisiry.com/?p=4349": (200, "<body class='postid-4513'>")})
    v, why, *_ = cleanup.own_page_verdict(REG, ROW, SLUG, probe=probe)
    assert v == "unknown" and "own post id" in why


def test_block_stays_unknown():
    probe, _ = _site({"https://alnowaisiry.com/?p=4349": (403, "")})
    assert cleanup.own_page_verdict(REG, ROW, SLUG, probe=probe)[0] == "unknown"


def test_sites_without_own_id_read_the_stored_url_unchanged():
    probe, seen = _site({"https://jazwtn.com/x": (200, "ok")})
    v, *_ = cleanup.own_page_verdict(cleanup.PLATFORMS["jazwtn"], {"id": 1, "ad_number": "J1"},
                                     "https://jazwtn.com/x", probe=probe)
    assert v == "live" and seen == ["https://jazwtn.com/x"]


def test_non_nw_ad_number_falls_back_to_stored_url():
    probe, seen = _site({SLUG: (200, "x")})
    cleanup.own_page_verdict(REG, {"id": 2, "ad_number": "ABC"}, SLUG, probe=probe)
    assert seen == [SLUG]
