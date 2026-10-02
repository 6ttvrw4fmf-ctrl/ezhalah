"""Owner, 2026-10-02: «just because you didn't see something doesn't mean it's dead … check the page
to confirm, and if it is removed, remove it». Until that day sadiqeltajer and ksaaqar had no removal
step at all (neither crawler called prune_unseen). Each now re-reads a missing ad's OWN page and
hides it only on that page's affirmative answer. Shapes below were measured live 2026-10-02."""
import re
from pathlib import Path

from scrapers.ksaaqar import run as KS
from scrapers.sadiqeltajer import run as SQ

SIMILAR = SQ._SIMILAR


def _sq(code=True, call=True, unavailable=False, neighbour=""):
    return (f"<html><body><h1>ارض بحي الروابي</h1>{'كود الاعلان : 5667 300 م²' if code else ''}"
            f"{'<button class=\"call-btn dropdown-toggle\">اتصال</button>' if call else ''}"
            f"{'<span>غير متاح</span>' if unavailable else ''}"
            f"<h2>{SIMILAR}</h2>{neighbour}</body></html>")


def test_sadiqeltajer_a_dropped_ad_keeps_its_page_and_code_and_is_still_gone():
    # 10 of 10 ads the sitemap had dropped: full page, code present, «غير متاح», no call button.
    assert SQ._signal(200, _sq(call=False, unavailable=True), False) == "gone"
    assert SQ._signal(200, "<html>غير موجود</html>", False) == "gone"      # the never-existed shell


def test_sadiqeltajer_an_offered_ad_is_live_and_a_neighbours_card_cannot_change_that():
    assert SQ._signal(200, _sq(), False) == "live"
    assert SQ._signal(200, _sq(neighbour="<span>غير متاح</span>"), False) == "live"
    dropped_beside_live = _sq(call=False, unavailable=True, neighbour='<button class="call-btn">اتصال</button>')
    assert SQ._signal(200, dropped_beside_live, False) == "gone"


def test_sadiqeltajer_anything_unclear_is_unknown_never_gone():
    assert SQ._signal(404, "", False) is None                 # this source does not 404 a removed ad
    assert SQ._signal(403, _sq(call=False, unavailable=True), False) is None
    assert SQ._signal(200, _sq(call=False), False) is None    # no button, but the page does not say why
    assert SQ._signal(200, _sq(call=True, unavailable=True), False) is None
    assert SQ._signal(200, _sq(call=False, unavailable=True), True) is None       # landed elsewhere


def test_ksaaqar_a_404_is_gone_and_a_page_that_still_renders_is_live():
    live = "<html><body><ul><li>النوع: شقة</li></ul></body></html>"
    assert KS._signal(404, "<html>الصفحة غير موجودة</html>", False) == "gone"
    assert KS._signal(200, live, False) == "live"     # incl. an ad the crawler skips: it is not gone
    assert KS._signal(200, "<html>shell</html>", False) is None
    assert KS._signal(503, live, False) is None and KS._signal(200, live, True) is None


def test_no_removal_without_a_known_live_control_from_the_same_run(monkeypatch):
    for R, gone in ((SQ, (200, _sq(call=False, unavailable=True))), (KS, (404, "x"))):
        monkeypatch.setattr(R, "session", lambda: object())
        monkeypatch.setattr(R, "stored_listing_url", lambda tables: (lambda ad: f"https://x/{ad}"))
        import scrapers.common.http_liveness as HL
        monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url, g=gone: (g[0], g[1], False))
        assert R._make_verify_gone(None)("A1")[0] == "unknown", "no control → no removal is believed"
        # a control that itself reads gone means the SOURCE is not answering truthfully
        assert R._make_verify_gone({"ad_number": "C1"})("A1")[0] == "unknown"


def test_both_crawlers_hand_the_oracle_to_prune_and_skip_it_on_a_partial_walk():
    for mod in ("sadiqeltajer", "ksaaqar"):
        src = (Path(__file__).resolve().parents[2] / mod / "run.py").read_text()
        code = re.sub(r'"""[\s\S]*?"""', "", src)
        code = re.sub(r"#[^\n]*", "", code)
        assert re.search(r"db\.prune_unseen\([^)]*verify_gone=verify_gone", code, re.S), mod
        assert re.search(r"if INCOMPLETE:\s*\n\s*print", code), mod
