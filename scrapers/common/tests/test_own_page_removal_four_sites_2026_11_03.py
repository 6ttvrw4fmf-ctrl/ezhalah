"""Four sites whose removed ads read ALIVE to the default 404-only reader (measured live 2026-11-03).

jurash      /property/68 → 200, «هذا العقار تم بيعه», [pt_sold] => 1     (live ones: [pt_sold] => 0)
vmksa       /ar/ads/668  → 200, {"digest":"NEXT_NOT_FOUND"}, no ad object (live: own ad object)
amlakalahsa permalink 301s to ANOTHER post; /?p=19625 → 404            (live /?p=: postid-<id>)
mobasher    removed page → 200, bare-site <title>, no record = made-up slug   (live: "status":"ACTIVE")

Each test also pins the direction that must NOT remove: a throttled shell, a redirect, a block.
"""
import pytest

from scrapers.amlakalahsa import run as amlak
from scrapers.common import http_liveness as hl
from scrapers.jurash import run as jurash
from scrapers.mobasher import run as mobasher
from scrapers.vmksa import run as vmksa


# ── jurash ──────────────────────────────────────────────────────────────────────────────────────
def jpage(pid, sold, status="للبيع "):
    return ("<html>" + "x" * 3000 + f"<pre>[pt_id] => {pid}\n[status] => {status}\n[pt_sold] => {sold}\n</pre>")


def test_jurash_sold_page_is_gone_and_live_page_is_live():
    sig = jurash._own_signal("68")
    assert sig(200, jpage("68", "1"), False) == "gone"
    assert sig(200, jpage("68", "0", "تم البيع"), False) == "gone"
    assert sig(200, jpage("68", "0"), False) == "live"


def test_jurash_never_removes_on_another_page_a_redirect_or_a_block():
    sig = jurash._own_signal("68")
    assert sig(200, jpage("84", "1"), False) is None       # not this ad's dump
    assert sig(200, jpage("68", "1"), True) is None        # landed somewhere else
    assert sig(403, jpage("68", "1"), False) is None
    assert sig(404, "", False) == "gone"


def test_jurash_crawl_and_oracle_share_one_predicate():
    f = jurash._dump_fields(jpage("68", "1"))
    assert jurash._sold_or_rented(f) is True


# ── vmksa ───────────────────────────────────────────────────────────────────────────────────────
def vflight(payload):
    import json
    return f'<script>self.__next_f.push([1,{json.dumps(payload)}])</script>'


def test_vmksa_not_found_marker_is_gone_and_own_ad_object_is_live(monkeypatch):
    sig = vmksa._own_signal(668)
    nf = vflight('a:E{"digest":"NEXT_NOT_FOUND"}\n')
    assert sig(200, nf, False) == "gone"
    monkeypatch.setattr(vmksa, "main_ad", lambda raw, ad_id: {"id": ad_id, "price_without_format": "1"})
    assert sig(200, nf, False) == "live"                    # its own object wins over any marker


def test_vmksa_throttled_shell_without_marker_stays_unknown():
    sig = vmksa._own_signal(668)
    assert sig(200, vflight("1:I[]\n"), False) is None
    assert sig(200, vflight('a:E{"digest":"NEXT_NOT_FOUND"}\n'), True) is None
    assert sig(500, "NEXT_NOT_FOUND", False) is None


# ── amlakalahsa ─────────────────────────────────────────────────────────────────────────────────
def test_amlakalahsa_own_id_404_is_gone_and_postid_page_is_live():
    sig = amlak._own_signal("19625")
    assert sig(404, "<title>الصفحة غير موجودة</title>", False) == "gone"
    assert sig(200, '<body class="land-template postid-19625">', True) == "live"


def test_amlakalahsa_closest_slug_guess_is_never_this_ad():
    sig = amlak._own_signal("19625")
    assert sig(200, '<body class="postid-19721">', True) is None   # WordPress guessed another post
    assert sig(403, "", False) is None
    assert sig(404, "x", True) is None                             # a 404 after a redirect is not ours


# ── mobasher ────────────────────────────────────────────────────────────────────────────────────
LIVE = r'x\"allowOffer\":true,\"status\":\"ACTIVE\",\"paymentStatus\":\"UNPAID\",\"enSlug\":\"a\"'
SHELL = "<head><title>مباشر | Mobasher</title></head><body>…</body>"


def test_mobasher_record_status_decides():
    assert mobasher._own_signal(200, LIVE, False) == "live"
    assert mobasher._own_signal(200, LIVE.replace("ACTIVE", "SOLD"), False) == "gone"
    assert mobasher._own_signal(200, LIVE.replace("ACTIVE", "PENDING_REVIEW"), False) is None


def test_mobasher_empty_shell_is_gone_but_an_unreadable_record_is_not():
    assert mobasher._own_signal(200, SHELL, False) == "gone"
    assert mobasher._own_signal(200, SHELL + r'\"enSlug\":\"x\"', False) is None
    assert mobasher._own_signal(200, SHELL, True) is None
    assert mobasher._own_signal(200, "<title>شراء فوري - البحث | مباشر</title>", False) is None  # search page
    assert mobasher._own_signal(403, SHELL, False) is None
    assert mobasher._ar_url("https://mobasher.sa/direct/realestate/abc-1") == \
        "https://mobasher.sa/ar/direct/realestate/abc-1"
    assert mobasher._ar_url("https://example.com/x") is None


def test_mobasher_stored_url_already_in_ar_shape_is_asked_not_skipped(monkeypatch):
    # alert_event 13910 (2026-11-10): a row stored as /ar/direct/… was answered «no stored URL» and
    # held UNKNOWN at 5 strikes. Both stored shapes must reach the same page.
    ar = "https://mobasher.sa/ar/direct/realestate/%D8%B7%D8%A7%D8%A8%D9%82-1787486370520"
    assert mobasher._ar_url(ar) == ar
    assert mobasher._ar_url("https://mobasher.sa/ar/direct/realestate/") is None
    assert mobasher._ar_url("https://mobasher.sa/direct/realestate/") is None
    assert mobasher._ar_url("https://mobasher.sa/ar/other/abc") is None
    asked = []

    class P:
        def __init__(self, **kw):
            self.kw = kw

        def verify_gone(self, ad):
            asked.append(self.kw["url_for"](ad))
            return "gone", "x"

    monkeypatch.setattr(mobasher, "LivenessProbe", P)
    monkeypatch.setattr(mobasher, "_stored_url", lambda ad: ar)
    assert mobasher._make_verify_gone(object(), ar)("MBSx")[0] == "gone"
    assert asked == [ar]


# ── the positive control gates every removal ────────────────────────────────────────────────────
@pytest.mark.parametrize("mod,ad,ctrl", [
    (jurash, "JR68", "JR84"), (vmksa, "VMK668", "VMK886"), (amlak, "AMH19625", "AMH19774")])
def test_no_removal_when_the_control_does_not_read_live(monkeypatch, mod, ad, ctrl):
    monkeypatch.setattr(hl.time, "sleep", lambda *_: None)
    if mod is vmksa:
        monkeypatch.setattr(vmksa.cc, "Session", lambda **k: object())
    else:
        monkeypatch.setattr(mod, "session", lambda: object())
    gone_body = {jurash: jpage("68", "1"), vmksa: vflight('a:E{"digest":"NEXT_NOT_FOUND"}\n'),
                 amlak: "not found"}[mod]
    gone_status = 404 if mod is amlak else 200

    def fetch(self, url):
        if any(k in url for k in ("/68", "/668", "19625")):
            return gone_status, gone_body, False
        return 403, "blocked", False                     # the control is blocked this run

    monkeypatch.setattr(hl.LivenessProbe, "fetch", fetch)
    verdict, why = mod._make_verify_gone(ctrl)(ad)
    assert verdict == "unknown" and "removal withheld" in why

    def fetch_ok(self, url):
        if any(k in url for k in ("/68", "/668", "19625")):
            return gone_status, gone_body, False
        live = {jurash: jpage("84", "0"), amlak: '<body class="postid-19774">'}.get(mod, "<html>ad 886</html>")
        return 200, live, mod is amlak

    monkeypatch.setattr(hl.LivenessProbe, "fetch", fetch_ok)
    if mod is vmksa:
        monkeypatch.setattr(vmksa, "main_ad", lambda raw, ad_id: {"id": 1} if ad_id == 886 else None)
    assert mod._make_verify_gone(ctrl)(ad)[0] == "gone"


def test_mobasher_no_removal_without_a_live_control(monkeypatch):
    monkeypatch.setattr(hl.time, "sleep", lambda *_: None)
    monkeypatch.setattr(mobasher, "_stored_url", lambda ad: "https://mobasher.sa/direct/realestate/gone-1")
    ctrl = "https://mobasher.sa/ar/direct/realestate/live-2"
    monkeypatch.setattr(hl.LivenessProbe, "fetch",
                        lambda self, url: (200, SHELL, False))           # control renders a shell too
    verdict, why = mobasher._make_verify_gone(object(), ctrl)("MBSx")
    assert verdict == "unknown" and "removal withheld" in why
    monkeypatch.setattr(hl.LivenessProbe, "fetch",
                        lambda self, url: (200, LIVE if url == ctrl else SHELL, False))
    assert mobasher._make_verify_gone(object(), ctrl)("MBSx")[0] == "gone"


# ── abralosol (owner «Yes, hide them», 2026-11-03) ──────────────────────────────────────────────
def test_abralosol_403_with_its_own_cannot_open_page_is_gone_only_with_a_live_control(monkeypatch):
    from scrapers.abralosol import run as abr
    monkeypatch.setattr(hl.time, "sleep", lambda *_: None)
    monkeypatch.setattr(abr, "_session", lambda: object())
    cannot = "<h1>لايمكن فتح هذة الصفحة</h1> يرجى العودة للصفحة الرئيسية للبحث"
    live = '<article class="node" data-history-node-id="8175">x</article>'
    pages = {"https://abralosol.com/8047": (403, cannot, False),
             "https://abralosol.com/8175": (200, live, False)}
    monkeypatch.setattr(hl.LivenessProbe, "fetch", lambda self, url: pages[url])
    assert abr._make_verify_gone({"ad_number": "ABR8175"})("ABR8047")[0] == "gone"
    # the control is blocked → nothing is removed
    pages["https://abralosol.com/8175"] = (403, "blocked", False)
    assert abr._make_verify_gone({"ad_number": "ABR8175"})("ABR8047")[0] == "unknown"
    # a 403 WITHOUT the site's own text (a WAF) is never a removal, even with a live control
    pages["https://abralosol.com/8175"] = (200, live, False)
    pages["https://abralosol.com/8047"] = (403, "Access denied", False)
    assert abr._make_verify_gone({"ad_number": "ABR8175"})("ABR8047")[0] == "unknown"
    # no control row this run → nothing is removed
    pages["https://abralosol.com/8047"] = (403, cannot, False)
    assert abr._make_verify_gone(None)("ABR8047")[0] == "unknown"


def test_body_must_is_optional_and_strict():
    import re
    seq = iter([(403, "x", False), (403, "x", False), (200, "ok", False)])
    got = hl.removal_by_owner_approved_status("abralosol", lambda u: next(seq), "u", "c",
                                              lambda st, b, m: "live", pause=0, body_must=re.compile("لايمكن"))
    assert got is None
