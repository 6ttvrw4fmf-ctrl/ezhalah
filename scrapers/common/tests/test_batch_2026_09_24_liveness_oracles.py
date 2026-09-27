"""The thirty-five platforms onboarded 2026-09-24 may only deactivate a listing on the SOURCE's word.

The same contract as test_batch_2026_09_21_liveness_oracles.py, scaled to this batch. Every one of
the thirty-five calls db.prune_unseen(..., verify_gone=...) and every oracle routes through the
shared law in scrapers/common/http_liveness.py. This barrier EXECUTES each platform's real signal
(never a copy) against:

  · the shapes the law says can never kill — no answer, 401/403/407/408/429, any 5xx, an empty
    body — fed the platform's own measured death body, so a signal that says 'gone' too eagerly is
    overruled here exactly as it would be in production;
  · the death shape MEASURED live on 2026-09-23/24 (the numbers are in each run.py docstring), most
    importantly the eight that do NOT hard-404: justsa (a 200 not-found sentence), sodasyat (a 302
    onto /search), marksa (a 200 soft-404 shell), eydah (the homepage on a 200), alrifai (a 200
    empty shell), villassa (status "0" in an intact record), flow (a 200 whose page JSON names
    another fid) and albdah (a Django DEBUG 500 — which the law refuses, so its ONLY measured death
    shape is pinned here as no verdict, never a removal: the registry says the same).

Five platforms expose no signal function to call directly — jawher, m3tmd and senan build it inside
jawher's make_verify_gone, yameen wires goldendeal's verify_gone_for, and alrifai implements the law
itself over its catalogue — so those five are driven through their REAL oracle via the probe's fetch
seam (never around the law) instead.

The wiring is pinned from the syntax tree: every prune_unseen call site carries verify_gone,
supersession runs before pruning, and every platform whose death is a SERVED page (never a hard
404) gates each removal on an in-run positive control — the 2026-09-21 rule for 200-death sources.
Four of those (marksa, villassa, flow, eydah) are also driven end-to-end to prove they fail CLOSED.

Deliberately NOT pinned here: the 2026-09-21 rule that writes go through db.upsert_<slug>_*
wrappers. None of the thirty-five has one yet (each docstring: "added centrally later"); every one
still addresses db._wasalt_batch directly.

Run: python -m pytest scrapers/common/tests/test_batch_2026_09_24_liveness_oracles.py -q
"""
from __future__ import annotations

import ast
import importlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.common.http_liveness as L  # noqa: E402

BATCH = ("dwelleo", "aqalemhajer", "sakani", "shatri", "alqasem", "fkralemar", "wadod", "almuteb",
         "aalbarrak", "alrifai", "sodasyat", "hasaad", "aqaralriyadh", "justsa", "snam", "jawher",
         "m3tmd", "senan", "goldendeal", "thousand", "yameen", "ebriza", "eilmalriyada", "daryusuf",
         "albdah", "eydah", "tamyaz", "hazim", "villassa", "marksa", "rightcompound",
         "livingcompound", "azure", "expattrusted", "flow")

# The eight whose measured death is a served page, not a hard 404 (liveness_policies.py header).
SERVED_PAGE_DEATH = ("justsa", "sodasyat", "marksa", "eydah", "alrifai", "villassa", "flow", "albdah")

_LAW_STATUSES = (None, 401, 403, 407, 408, 429, 500, 502, 503, 504)


def _run(platform: str):
    return importlib.import_module(f"scrapers.{platform}.run")


def _src(platform: str) -> str:
    return (ROOT / "scrapers" / platform / "run.py").read_text(encoding="utf-8")


def _verdict(signal, status, body, moved=False):
    got = L.decide(status, body, moved, signal)
    return None if got is None else got[0]


# ── the wiring ───────────────────────────────────────────────────────────────────────────────────
def _prune_sites(platform: str) -> list[set[str]]:
    tree = ast.parse(_src(platform))
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
    src = _src(platform)
    assert src.index("retire_superseded_siblings(") < src.index("db.prune_unseen("), (
        f"{platform}: prune's guards protect a category-flip orphan unless supersession runs first")


def _every_probe_carries_a_canary(platform: str) -> bool:
    src = _src(platform)
    if platform == "alrifai":
        # No LivenessProbe: its own law over the complete catalogue, HELD unless ids THIS run
        # mapped are still listed there (_catalogue_ids_cached) — the same positive control.
        return "_SEEN_THIS_RUN" in src
    probes = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Call)
              and getattr(n.func, "id", None) == "LivenessProbe"]
    return bool(probes) and all(any(k.arg == "canary" for k in p.keywords) for p in probes)


@pytest.mark.parametrize("platform", SERVED_PAGE_DEATH)
def test_a_death_that_is_a_served_page_is_gated_on_an_in_run_positive_control(platform):
    """A source that answers a removed listing with a served page can answer EVERY listing that
    way when it degrades (gathern's own-404 blocking, dealapp's listing-less shells). The
    2026-09-21 rule: such a platform may remove nothing unless a row this run mapped still reads
    live — LivenessProbe(canary=...) fails CLOSED without it."""
    assert _every_probe_carries_a_canary(platform), (
        f"{platform}: its measured death is a served page, but its LivenessProbe carries no "
        f"canary= — a site-wide degradation would read as a removal of every candidate at grace")


# ── the signals, measured shape by measured shape ────────────────────────────────────────────────
_WP_INVALID = json.dumps({"code": "rest_post_invalid_id", "message": "Invalid post ID."})
_HTML_404 = "<html>الصفحة غير موجودة</html>"
_NUZUL_404 = '{"message":"No query results for model"}'
_EY_URL = "https://eydah.com/offers/EY-1001.html"
_EY_HOME = ('<script type="application/ld+json">{"@graph":[{"@type":"RealEstateAgent"}]}</script>'
            "<p>RealEstateListing</p>")
_MAR_SHELL = "<html><head><title>مار العقاريه - الصفحة الرئيسية</title></head><body></body></html>"


def _eydah_page(url: str) -> str:
    return ('<script type="application/ld+json">'
            + json.dumps({"@type": "RealEstateListing", "url": url}) + "</script>")


def _flow_page(pp: dict) -> str:
    return ('<html><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": pp}}) + "</script></html>")


def _mar_page(title: str = "مشروع الزاهد ( شقق )") -> str:
    return (f"<html><head><title>مار العقاريه - {title}</title></head><body>"
            '<div class="realestate-features"><div class="items"><span class="icon">'
            '<img src="https://mar-ksa.com/assets/theme/images/icons/beds.svg" alt=""></span>'
            "<p>5 غرف</p></div></div></body></html>")


def _vls(ad_id: int, status: str) -> str:
    return json.dumps({"data": {"main": {"id": ad_id, "status": status}}})


def _nuzul(ad_id: int, status: str = "available") -> str:
    return json.dumps({"data": {"id": ad_id, "availability_status": status}})


# platform → (its signal, the measured death shape (status, body, moved), what the law lets that
# shape become). Every shape is the one the platform's own docstring measured.
CASES = {
    "dwelleo": (lambda R: R._signal_for(9), (422, '{"message":"The selected id is invalid."}', False), "gone"),
    "aqalemhajer": (lambda R: R._signal_for("9"), (404, _HTML_404, False), "gone"),
    "sakani": (lambda R: R._signal, (404, '{"message":"Not Found"}', False), "gone"),
    "shatri": (lambda R: R._signal_for(9, {}), (404, _WP_INVALID, False), "gone"),
    "alqasem": (lambda R: R._signal_for(9), (404, f"<title>{_run('alqasem').NOT_FOUND_TITLE}</title>", False), "gone"),
    "fkralemar": (lambda R: R._signal_for("deadbeef01", {}), (404, f"<title>{_run('fkralemar').NOT_FOUND_TITLE}</title>", False), "gone"),
    "wadod": (lambda R: R._signal, (404, f"<h1>{_run('wadod').NOT_FOUND}</h1>", False), "gone"),
    "almuteb": (lambda R: R._signal_for(9, {}), (404, _WP_INVALID, False), "gone"),
    "aalbarrak": (lambda R: R._signal_for(9, {}), (404, _WP_INVALID, False), "gone"),
    "sodasyat": (lambda R: R._signal, (200, "<title>سداسيات - جميع العقارات</title>", True), "gone"),
    "hasaad": (lambda R: R._signal_for("1", "2"), (404, '<body class="error404">', False), "gone"),
    "aqaralriyadh": (lambda R: R._signal, (404, _WP_INVALID, False), "gone"),
    "justsa": (lambda R: R._signal, (200, _run("justsa")._NOT_FOUND, False), "gone"),
    "snam": (lambda R: R._signal_for(2), (404, f"<p>{_run('snam')._NOT_FOUND}</p>", False), "gone"),
    "goldendeal": (lambda R: R._signal_for(9), (404, _NUZUL_404, False), "gone"),
    "thousand": (lambda R: R._signal_for("9"), (404, _HTML_404, False), "gone"),
    "ebriza": (lambda R: R._signal_for(9), (404, '{"error":"No property found"}', False), "gone"),
    "eilmalriyada": (lambda R: R._signal_for(9), (404, '{"message":"العقار غير موجود"}', False), "gone"),
    "daryusuf": (lambda R: R._signal_for(9), (404, _WP_INVALID, False), "gone"),
    # albdah's only measured death is a Django DEBUG 500: the law holds every 5xx as «the source is
    # broken», so this shape can never become a removal in production (liveness_policies.py).
    "albdah": (lambda R: R._signal, (500, "DoesNotExist at /property/9/details/", False), None),
    "eydah": (lambda R: R._make_signal(_EY_URL), (200, _EY_HOME, False), "gone"),
    "tamyaz": (lambda R: R._make_signal("9"), (404, "غير موجود", False), "gone"),
    "hazim": (lambda R: R._make_signal("b" * 24), (404, "not found", False), "gone"),
    "villassa": (lambda R: R._signal_for(9), (200, _vls(9, "0"), False), "gone"),
    "marksa": (lambda R: R._signal, (200, _MAR_SHELL, False), "gone"),
    "rightcompound": (lambda R: R._unit_signal("9"), (404, _HTML_404, False), "gone"),
    "livingcompound": (lambda R: R._post_signal("9"), (404, _HTML_404, False), "gone"),
    "azure": (lambda R: R._unit_signal(("villa-9",)), (404, _HTML_404, False), "gone"),
    "expattrusted": (lambda R: R._signal_for("9"), (404, _HTML_404, False), "gone"),
    "flow": (lambda R: R._signal_for("DEAD9"), (200, _flow_page({"externalRefId": None}), False), "gone"),
}


@pytest.mark.parametrize("platform", list(CASES))
def test_the_measured_death_shape_reads_as_the_law_allows(platform):
    signal, death, expected = CASES[platform]
    assert _verdict(signal(_run(platform)), *death) == expected


_LAW = [(p, s) for p in CASES for s in _LAW_STATUSES]


@pytest.mark.parametrize("platform,status", _LAW, ids=[f"{p}:{s}" for p, s in _LAW])
def test_the_law_overrules_a_death_read_off_a_read_that_cannot_bear_one(platform, status):
    """The platform's own death body, delivered with a status that is about US — never a kill."""
    signal, (_, gone_body, moved), _ = CASES[platform]
    assert _verdict(signal(_run(platform)), status, gone_body, moved) != "gone"


@pytest.mark.parametrize("platform", list(CASES))
def test_an_empty_body_never_kills(platform):
    signal, (gone_status, _, moved), _ = CASES[platform]
    assert _verdict(signal(_run(platform)), gone_status, "", moved) != "gone"


# ── the five without a callable signal: their REAL oracle, driven through the fetch seam ─────────
def _serve(monkeypatch, R, platform: str, responder):
    """Serve canned reads through each oracle's documented seam, never around the law."""
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    if platform == "alrifai":
        monkeypatch.setattr(R, "fetch", lambda s, url: responder(url)[:2])
    else:
        monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: responder(url))


def _nuzul_engine(R):
    return R.make_verify_gone(R.BASE, R.PREFIX, R.SLUG, {"ad_number": f"{R.PREFIX}7"})


# platform → (build the real verify_gone, the dead ad, its death shape, the control's live shape,
#             the URL that is the control's own)
SEAM = {
    "jawher": (_nuzul_engine, "JWH9", (404, _NUZUL_404, False), (200, _nuzul(7), False), lambda u: u.endswith("/7")),
    "m3tmd": (_nuzul_engine, "MQR9", (404, _NUZUL_404, False), (200, _nuzul(7), False), lambda u: u.endswith("/7")),
    "senan": (_nuzul_engine, "SNN9", (404, _NUZUL_404, False), (200, _nuzul(7), False), lambda u: u.endswith("/7")),
    "yameen": (lambda R: R.verify_gone_for(R.TENANT, lambda: (True, "control served")),
               "YMN9", (404, _NUZUL_404, False), None, lambda u: False),
    "alrifai": (lambda R: (lambda ad: R.verify_gone(ad, s=object())),
                "RFI9", (200, "<html><h2></h2></html>", False), None, lambda u: False),
}


def test_the_two_halves_cover_the_whole_batch():
    assert set(CASES) | set(SEAM) == set(BATCH) and not set(CASES) & set(SEAM)


@pytest.mark.parametrize("platform", list(SEAM))
def test_the_measured_death_shape_is_a_removal_through_the_real_oracle(platform, monkeypatch):
    R = _run(platform)
    build, dead_ad, death, live, is_control = SEAM[platform]
    _serve(monkeypatch, R, platform, lambda url: live if is_control(url) else death)
    assert build(R)(dead_ad)[0] == "gone"


_SEAM_LAW = [(p, s) for p in SEAM for s in _LAW_STATUSES]


@pytest.mark.parametrize("platform,status", _SEAM_LAW, ids=[f"{p}:{s}" for p, s in _SEAM_LAW])
def test_the_law_overrules_through_the_real_oracle(platform, status, monkeypatch):
    R = _run(platform)
    build, dead_ad, (_, gone_body, moved), _, _ = SEAM[platform]
    _serve(monkeypatch, R, platform, lambda url: (status, gone_body, moved))
    assert build(R)(dead_ad)[0] == "unknown"


@pytest.mark.parametrize("platform", list(SEAM))
def test_an_empty_body_never_kills_through_the_real_oracle(platform, monkeypatch):
    R = _run(platform)
    build, dead_ad, (gone_status, _, moved), _, _ = SEAM[platform]
    _serve(monkeypatch, R, platform, lambda url: (gone_status, "", moved))
    assert build(R)(dead_ad)[0] != "gone"


# ── the 200-death platforms with a canary fail CLOSED without their positive control ─────────────
def _ctrl_row(ctrl):
    return {"ad_number": ctrl} if ctrl else None


CANARY_GATED = {
    # platform → (ad under test, control ad, build verify_gone(R, control ad or None),
    #             is this URL the control's own, the control's live shape, the death shape)
    "marksa": ("MAR9", "MAR7", lambda R, c: R._make_verify_gone(_ctrl_row(c)),
               lambda u: u.endswith("/showitem/7"), (200, _mar_page(), False), (200, _MAR_SHELL, False)),
    "villassa": ("VLS9", "VLS7", lambda R, c: R._make_verify_gone(_ctrl_row(c)),
                 lambda u: u.endswith("/7"), (200, _vls(7, "1"), False), (200, _vls(9, "0"), False)),
    "flow": ("FLW-riyadh-granada-fid-DEAD9", "FLW-riyadh-granada-fid-CTRL7",
             lambda R, c: R._make_verify_gone(_ctrl_row(c)), lambda u: u.endswith("/fid/CTRL7"),
             (200, _flow_page({"externalRefId": "CTRL7"}), False),
             (200, _flow_page({"externalRefId": None}), False)),
    "eydah": ("EYDEY-9999", "EYDEY-1001",
              lambda R, c: R._make_verify_gone(c, {"EYDEY-1001": _EY_URL,
                                                   "EYDEY-9999": "https://eydah.com/offers/EY-9999.html"}),
              lambda u: u == _EY_URL, (200, _eydah_page(_EY_URL), False), (200, _EY_HOME, False)),
}


@pytest.mark.parametrize("platform", list(CANARY_GATED))
def test_a_200_death_is_withheld_without_a_positive_control(platform, monkeypatch):
    R = _run(platform)
    ad, _ctrl, build, _is_ctrl, _live, dead = CANARY_GATED[platform]
    _serve(monkeypatch, R, platform, lambda url: dead)
    verdict, why = build(R, None)(ad)
    assert verdict == "unknown" and "withheld" in why, why


@pytest.mark.parametrize("platform", list(CANARY_GATED))
def test_a_200_death_is_withheld_when_the_control_is_not_served(platform, monkeypatch):
    R = _run(platform)
    ad, ctrl, build, _is_ctrl, _live, dead = CANARY_GATED[platform]
    _serve(monkeypatch, R, platform, lambda url: dead)          # the control answers dead too
    verdict, why = build(R, ctrl)(ad)
    assert verdict == "unknown" and "withheld" in why, why


@pytest.mark.parametrize("platform", list(CANARY_GATED))
def test_a_200_death_lands_when_the_control_is_still_served(platform, monkeypatch):
    R = _run(platform)
    ad, ctrl, build, is_ctrl, live, dead = CANARY_GATED[platform]
    _serve(monkeypatch, R, platform, lambda url: live if is_ctrl(url) else dead)
    verdict, why = build(R, ctrl)(ad)
    assert verdict == "gone", why
