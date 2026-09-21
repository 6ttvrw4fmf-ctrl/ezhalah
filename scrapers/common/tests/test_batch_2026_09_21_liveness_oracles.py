"""The eleven platforms onboarded 2026-09-21 may only deactivate a listing on the SOURCE's word.

Every one of them calls db.prune_unseen(..., verify_gone=...), and every oracle routes through the
shared law in scrapers/common/http_liveness.py. This barrier EXECUTES each platform's real signal
(never a copy) against:

  · the shapes the law says can never kill — no answer, 401/403/407/408/429, any 5xx, an empty
    body — fed the platform's own death body, so a signal that says 'gone' too eagerly is overruled
    here exactly as it would be in production;
  · the death shape MEASURED live on 2026-09-21 for that platform (the numbers are in each
    scraper's LIVENESS block) — most importantly the three that do NOT 404: ialqarawi answers an
    unknown id with its homepage, sakan 301s to the listings index, gomenassat serves a 200 soft-404;
  · the live shape, a closed-in-place shape (a still-served «تم البيع» page must not self-heal a row
    the crawl refuses to publish), and a page for ANOTHER listing, which may not certify this one.

And it pins the wiring from the syntax tree: every prune_unseen call site in the eleven carries
verify_gone, supersession runs before pruning, and the three 200-death platforms fail CLOSED when
their in-run positive control is missing or not served.

The fixtures are the minimal markup each scraper's OWN parser reads (parse_detail / parse_page /
the REST record); the parsers themselves are pinned by the per-platform test files.

Run: python -m pytest scrapers/common/tests/test_batch_2026_09_21_liveness_oracles.py -q
"""
from __future__ import annotations

import ast
import hashlib
import importlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.common.http_liveness as L  # noqa: E402

BATCH = ("alsidra", "moftah", "masar", "gomenassat", "sakan", "bossbih", "alshawaf",
         "ialqarawi", "aljassim", "almotmkenah", "nufouth")


def _run(platform: str):
    return importlib.import_module(f"scrapers.{platform}.run")


def _verdict(signal, status, body, moved=False):
    got = L.decide(status, body, moved, signal)
    return None if got is None else got[0]


# ── the wiring ───────────────────────────────────────────────────────────────────────────────────
def _prune_sites(platform: str) -> list[set[str]]:
    tree = ast.parse((ROOT / "scrapers" / platform / "run.py").read_text(encoding="utf-8"))
    return [{k.arg for k in node.keywords if k.arg} for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "prune_unseen"]


@pytest.mark.parametrize("platform", BATCH)
def test_every_prune_site_hands_the_source_a_vote(platform):
    sites = _prune_sites(platform)
    assert sites, f"{platform} never prunes — a sold ad would stay searchable forever"
    assert all("verify_gone" in kw for kw in sites), (
        f"{platform}: a prune_unseen call without verify_gone deactivates on ABSENCE alone")


@pytest.mark.parametrize("platform", BATCH)
def test_supersession_runs_before_the_prune(platform):
    src = (ROOT / "scrapers" / platform / "run.py").read_text(encoding="utf-8")
    assert src.index("retire_superseded_siblings(") < src.index("db.prune_unseen("), (
        f"{platform}: prune's guards protect a category-flip orphan unless supersession runs first")


@pytest.mark.parametrize("platform", BATCH)
def test_writes_go_through_the_platforms_own_public_wrappers(platform):
    src = (ROOT / "scrapers" / platform / "run.py").read_text(encoding="utf-8")
    assert "_wasalt_batch(" not in src, f"{platform} still addresses the private batch writer"
    for kind in ("residential", "commercial"):
        assert f"db.upsert_{platform}_{kind}_batch(" in src


# ── the signals, measured shape by measured shape ────────────────────────────────────────────────
def _bossbih(nid, title="منزل للبيع في الفيصلية"):
    return (f'<article data-history-node-id="{nid}" role="article">'
            f'<h1 class="page-title">{title}</h1></article>')


def _alshawaf(nid, title="منزل بيت للبيع في المروج", aqar="منزل بيت للبيع"):
    return (f'<article data-history-node-id="{nid}"></article><h1><span>{title}</span></h1>'
            '<div id="block-edux-views-block-duplicate-of-node-block-1"><table>'
            f'<tr><th>التاريخ</th><td><a href="https://wa.me/?text=https://alshawaf.com.sa/{nid}">'
            f'2026-09-20</a></td></tr><tr><th>العقار</th><td>{aqar}</td></tr></table></div>')


def _aljassim(nid, title="أرض للبيع في المحدود"):
    return (f'<article data-history-node-id="{nid}"><span property="schema:name" content="{title}">'
            '</span><div class="text-right">المساحة 500 م</div><ul class="links inline"></ul>'
            '</article>')


def _ialqarawi(lid, cat="فلل", title="للبيع فيلا بحي الوفاء بعنيزة"):
    return (f'<h3>{title}</h3><dl>'
            f'<dd class="col-sm-3"><strong>رقم العقار</strong></dd><dd class="col-sm-9">{lid}</dd>'
            f'<dd class="col-sm-3"><strong>القسم</strong></dd><dd class="col-sm-9">{cat}</dd></dl>')


_IALQARAWI_HOME = '<div id="myCarousel" class="carousel slide"></div>' + "<p>بطاقات</p>" * 20


def _sakan(aid, status="فعال", desc="شقة واسعة"):
    return (f'<link rel="canonical" href="https://sa.sakan.co/ar/property/details/{aid}-شقة" />'
            '<script type="application/ld+json">{"@type": "SingleFamilyResidence"}</script>'
            f'<span class="fn fn--gray">الحالة</span> <span class="fn fn--b">{status}</span>'
            f'<div id="accordion_div">{desc}</div>')


_SAKAN_INDEX = ('<link rel="canonical" href="https://sa.sakan.co/ar/properties/buy" />'
                + "<div>عقارات للبيع</div>" * 20)


def _gomenassat(purpose):
    return ('<div class="offer-header-info"><div class="container"><div class="row">'
            f'<div class="property-badge">{purpose}</div></div></div></div>'
            '<h3>عروض أخرى قريبة</h3><div class="property-badge">للبيع</div>')


_GOMENASSAT_SOFT_404 = "<h1>نأسف! هذه الصفحة غير متوفرة</h1>"


def _almotmkenah(ad_id, archived=False):
    banner = '<p class="bg-danger text-danger">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>' if archived else ""
    return (f'<div class="annonce_header_info"><h1>أرض للبيع</h1>{banner}</div>'
            f'<input type="hidden" name="d" value="{ad_id}" />')
_UNIT = "معرض 1"
_UNIT_KEY = hashlib.sha1(_UNIT.encode("utf-8")).hexdigest()[:8]


def _nufouth(code="N4990", ad_name="AD-00012", status="نشط", units=(_UNIT,), with_ads=True):
    ads = [{"ad": {"name": ad_name, "status": status},
            "units": [{"name": u} for u in units]}] if with_ads else []
    return json.dumps({"message": {"property": {"code": code}, "ads": ads}}, ensure_ascii=False)


def _wp(pid, status="publish", title="أرض للبيع", content="<p>أرض سكنية</p>", **extra):
    return json.dumps({"id": pid, "status": status, "title": {"rendered": title},
                       "content": {"rendered": content}, **extra}, ensure_ascii=False)


def _woo(pid, name="أرض للبيع في حي النرجس"):
    return json.dumps({"id": pid, "name": name, "description": "<p>أرض</p>",
                       "short_description": "", "attributes": []}, ensure_ascii=False)


_WP_INVALID = json.dumps({"code": "rest_post_invalid_id", "message": "Invalid post ID."})
_WOO_INVALID = json.dumps({"code": "woocommerce_rest_product_invalid_id", "message": "Invalid ID."})
_SIDRA_TERMS = {5: "للبيع", 6: "مزاد"}

# platform → (signal factory, [(label, status, body, moved, expected verdict)], the death body)
CASES = {
    "bossbih": (lambda R: R._signal_for("9989"), [
        ("deleted node: Drupal's themed 404", 404, "<html>الصفحة غير موجودة</html>", False, "gone"),
        ("this node", 200, _bossbih(9989), False, "live"),
        ("retired in place", 200, _bossbih(9989, "تم البيع منزل في الفيصلية"), False, "gone"),
        ("another node", 200, _bossbih(1111), False, None),
    ], (404, "<html>الصفحة غير موجودة</html>")),
    "alshawaf": (lambda R: R._signal_for("22273"), [
        ("deleted node: Drupal's themed 404", 404, "<html>الصفحة غير موجودة</html>", False, "gone"),
        ("this node, proven", 200, _alshawaf(22273), False, "live"),
        ("closed in place", 200, _alshawaf(22273, aqar="منزل تم البيع"), False, "gone"),
        ("another node's block", 200, _alshawaf(21635), False, None),
    ], (404, "<html>الصفحة غير موجودة</html>")),
    "aljassim": (lambda R: R._signal_for("4034"), [
        ("deleted node: Drupal's themed 404", 404, "<html>الصفحة غير موجودة</html>", False, "gone"),
        ("this node, proven", 200, _aljassim(4034), False, "live"),
        ("closed in place", 200, _aljassim(4034, "أرض تم بيعها مباعة"), False, "gone"),
        ("another node", 200, _aljassim(5263), False, None),
    ], (404, "<html>الصفحة غير موجودة</html>")),
    "ialqarawi": (lambda R: R._signal_for("2362"), [
        ("unknown id: the homepage on a 200", 200, _IALQARAWI_HOME, False, "gone"),
        ("taken out of every category", 200, _ialqarawi(2362, cat=""), False, "gone"),
        ("this id, categorised", 200, _ialqarawi(2362), False, "live"),
        ("sold per its own title", 200, _ialqarawi(2362, title="تم البيع فيلا بعنيزة"), False,
         "gone"),
        ("another id's page", 200, _ialqarawi(1065), False, None),
        ("neither homepage nor listing", 200, "<html>صيانة</html>", False, None),
    ], (200, _IALQARAWI_HOME)),
    "sakan": (lambda R: R._signal_for("85869"), [
        ("removed: 301 to the listings index", 200, _SAKAN_INDEX, True, "gone"),
        ("the index WITHOUT a redirect proves nothing", 200, _SAKAN_INDEX, False, None),
        ("this id, فعال", 200, _sakan(85869), False, "live"),
        ("this id, status left فعال", 200, _sakan(85869, status="مباع"), False, "gone"),
        ("this id, transacted in its own words", 200, _sakan(85869, desc="تم البيع"), False, "gone"),
        ("another id's page", 200, _sakan(99224), True, None),
    ], (200, _SAKAN_INDEX)),
    "gomenassat": (lambda R: R._signal, [
        ("deleted offer: soft-404 on a 200", 200, _GOMENASSAT_SOFT_404, False, "gone"),
        ("its own badge: للبيع", 200, _gomenassat("للبيع"), False, "live"),
        ("its own badge: للإيجار", 200, _gomenassat("للإيجار"), False, "live"),
        ("its own badge: تم البيع", 200, _gomenassat("تم البيع"), False, "gone"),
        ("its own badge: تم الإيجار", 200, _gomenassat("تم الإيجار"), False, "gone"),
    ], (200, _GOMENASSAT_SOFT_404)),
    "nufouth": (lambda R: R._signal_for("N4990", "00012", _UNIT_KEY), [
        ("the ad and unit are in the record", 200, _nufouth(), False, "live"),
        ("the ad left نشط", 200, _nufouth(status="منتهي"), False, "gone"),
        ("the ad is gone from the record", 200, _nufouth(ad_name="AD-00099"), False, "gone"),
        ("the unit is gone from the ad", 200, _nufouth(units=("معرض 2",)), False, "gone"),
        ("the property has no ads at all", 200, _nufouth(with_ads=False), False, "gone"),
        ("another property's record", 200, _nufouth(code="N1630"), False, None),
    ], (200, _nufouth(with_ads=False))),
    "almotmkenah": (lambda R: R._signal_for("MTM409"), [
        ("a slug the site does not have: 404", 404, "<html>الصفحة غير موجودة</html>", False, "gone"),
        ("this ad, no archive banner", 200, _almotmkenah(409), False, "live"),
        ("this ad, archived by the site", 200, _almotmkenah(409, archived=True), False, "gone"),
        ("another ad's page", 200, _almotmkenah(408), False, None),
        ("not an ad page", 200, "<html>صيانة</html>", False, None),
    ], (404, "<html>الصفحة غير موجودة</html>")),
    "alsidra": (lambda R: R._signal_for(21257, _SIDRA_TERMS), [
        ("deleted: rest_post_invalid_id", 404, _WP_INVALID, False, "gone"),
        ("a 404 WITHOUT that code", 404, json.dumps({"code": "rest_no_route"}), False, None),
        ("this post, published", 200, _wp(21257, property_status=[5]), False, "live"),
        ("turned auction", 200, _wp(21257, property_status=[6]), False, "gone"),
        ("closed in its own words", 200, _wp(21257, content="<p>تم البيع</p>"), False, "gone"),
        ("not published", 200, _wp(21257, status="draft"), False, "gone"),
        ("another post", 200, _wp(99), False, None),
    ], (404, _WP_INVALID)),
    "masar": (lambda R: R._signal_for(2935), [
        ("deleted: rest_post_invalid_id", 404, _WP_INVALID, False, "gone"),
        ("this post, published", 200, _wp(2935, title="فيلا للبيع"), False, "live"),
        ("closed in its own words", 200, _wp(2935, content="<p>تم التأجير</p>"), False, "gone"),
        ("the hcdn challenge on a 200", 200,
         "<title>Checking your browser before accessing</title>", False, None),
        ("another post", 200, _wp(2693), False, None),
    ], (404, _WP_INVALID)),
    "moftah": (lambda R: R._signal_for(30274), [
        ("deleted: woocommerce_rest_product_invalid_id", 404, _WOO_INVALID, False, "gone"),
        ("this product", 200, _woo(30274), False, "live"),
        ("closed in its own words", 200, _woo(30274, name="أرض تم البيع"), False, "gone"),
        ("another product", 200, _woo(30082), False, None),
    ], (404, _WOO_INVALID)),
}

_ROWS = [(p, *case) for p, (_, cases, _) in CASES.items() for case in cases]


@pytest.mark.parametrize("platform,label,status,body,moved,expected", _ROWS,
                         ids=[f"{r[0]}:{r[1]}" for r in _ROWS])
def test_each_measured_shape_reads_as_measured(platform, label, status, body, moved, expected):
    signal = CASES[platform][0](_run(platform))
    assert _verdict(signal, status, body, moved) == expected, f"{platform}: {label}"


_LAW = [(p, s) for p in CASES for s in (None, 401, 403, 407, 408, 429, 500, 502, 503, 504)]


@pytest.mark.parametrize("platform,status", _LAW, ids=[f"{p}:{s}" for p, s in _LAW])
def test_the_law_overrules_a_death_read_off_a_read_that_cannot_bear_one(platform, status):
    """The platform's own death body, delivered with a status that is about US — never a kill."""
    signal = CASES[platform][0](_run(platform))
    _, gone_body = CASES[platform][2]
    assert _verdict(signal, status, gone_body) != "gone"


@pytest.mark.parametrize("platform", list(CASES))
def test_an_empty_body_never_kills(platform):
    signal = CASES[platform][0](_run(platform))
    gone_status, _ = CASES[platform][2]
    assert _verdict(signal, gone_status, "") != "gone"


# ── the three that die on a 200 fail CLOSED without their positive control ───────────────────────
CANARY_GATED = {
    # platform → (ad under test, its death shape, a control row, the control's live shape)
    "ialqarawi": ("QRW1592", (200, _IALQARAWI_HOME, False),
                  {"ad_number": "QRW2362", "listing_url": "https://ctrl/2362"},
                  (200, _ialqarawi(2362), False)),
    "sakan": ("SKN98874", (200, _SAKAN_INDEX, True),
              {"ad_number": "SKN85869", "listing_url": "https://ctrl/85869"},
              (200, _sakan(85869), False)),
    "gomenassat": ("MNS152", (200, _GOMENASSAT_SOFT_404, False),
                   {"ad_number": "MNS800"}, (200, _gomenassat("للبيع"), False)),
}


def _patched(monkeypatch, R, responses):
    """Serve canned reads through the probe's documented seam (fetch), never around the law."""
    monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: responses(url))
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    if hasattr(R, "stored_listing_url"):
        monkeypatch.setattr(R, "stored_listing_url", lambda tables: (lambda ad: f"https://row/{ad}"))


@pytest.mark.parametrize("platform", list(CANARY_GATED))
def test_a_200_death_is_withheld_without_a_positive_control(platform, monkeypatch):
    R = _run(platform)
    ad, dead, _control, _live = CANARY_GATED[platform]
    _patched(monkeypatch, R, lambda url: dead)
    verdict, why = R._make_verify_gone(None)(ad)
    assert verdict == "unknown" and "withheld" in why, why


@pytest.mark.parametrize("platform", list(CANARY_GATED))
def test_a_200_death_is_withheld_when_the_control_is_not_served(platform, monkeypatch):
    R = _run(platform)
    ad, dead, control, _live = CANARY_GATED[platform]
    _patched(monkeypatch, R, lambda url: dead)          # the control answers dead too
    verdict, why = R._make_verify_gone(control)(ad)
    assert verdict == "unknown" and "withheld" in why, why


@pytest.mark.parametrize("platform", list(CANARY_GATED))
def test_a_200_death_lands_when_the_control_is_still_served(platform, monkeypatch):
    R = _run(platform)
    ad, dead, control, live = CANARY_GATED[platform]
    ctrl_id = control["ad_number"][3:]
    _patched(monkeypatch, R, lambda url: live if url.endswith(ctrl_id) else dead)
    verdict, why = R._make_verify_gone(control)(ad)
    assert verdict == "gone", why


def test_almotmkenah_an_ad_the_run_never_reached_is_probed_not_held_unknown_forever(monkeypatch):
    """The per-run map answers for ads the crawl READ; an ad the index dropped used to answer
    'unknown' forever (so a deleted ad stayed searchable). It is now probed at its stored URL."""
    R = _run("almotmkenah")
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    monkeypatch.setattr(R, "_STATUS", {"MTM408": ("live", "read this run")})
    monkeypatch.setattr(R, "_stored_url", lambda ad: f"https://row/{ad}")
    fetched = []
    monkeypatch.setattr(L.LivenessProbe, "fetch",
                        lambda self, url: fetched.append(url) or (404, "<html>404</html>", False))
    assert R._verify_gone("MTM408") == ("live", "read this run") and not fetched
    assert R._verify_gone("MTM409")[0] == "gone" and fetched == ["https://row/MTM409"]
    monkeypatch.setattr(R, "_stored_url", lambda ad: None)       # no stored URL → never a kill
    assert R._verify_gone("MTM410")[0] == "unknown"


_NUFOUTH_403 = '{"exc_type":"PermissionError","_server_messages":"[...]"}'
_NUFOUTH_NO_SUCH = '<div class="alert alert-danger">عذرًا، العقار المطلوب غير موجود.</div>'


@pytest.mark.parametrize("gate_status,gate_body,page,expected", [
    (403, _NUFOUTH_403, (200, _NUFOUTH_NO_SUCH, False), "gone"),        # both channels disown it
    (200, _nufouth(code="N2873"), (200, _NUFOUTH_NO_SUCH, False), "unknown"),  # API still has it
    (503, "down", (200, _NUFOUTH_NO_SUCH, False), "unknown"),            # outage never agrees
    (403, _NUFOUTH_403, (500, "<html>full page</html>", False), "unknown"),  # page unreadable
    (403, _NUFOUTH_403, (200, "<html>detailsModal-N2873</html>", False), "unknown"),
])
def test_nufouth_a_deleted_property_retires_only_when_page_and_api_both_disown_it(
        monkeypatch, gate_status, gate_body, page, expected):
    """The API's own 403 never kills (the law). A property deleted outright is retired by its
    public /B/<code> page stating «العقار المطلوب غير موجود», gated on the API disowning the code."""
    R = _run("nufouth")
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: (
        (403, _NUFOUTH_403, False) if "get_property_data" in url else page))

    class _Resp:
        status_code, text = gate_status, gate_body

    monkeypatch.setattr(R, "session", lambda: type("S", (), {"get": lambda *a, **k: _Resp()})())
    assert R._verify_gone("NFZN2873A00012UP")[0] == expected
