"""An Arabic-slug probe that lands on its own (percent-encoded) URL is NOT a redirect (2026-11-03).

mizlaj MZ29 answered 404 on its own page, but the client reported the landing percent-encoded,
`_path_of` compared bytes, `path_changed` came back True and mizlaj's signal gave no opinion, so
the row was held UNKNOWN at full strikes while customers could still open its card.
"""
from urllib.parse import quote

from scrapers.common import http_liveness

SLUG = "فيلا-مع-شقه-للبيع-مليون-و-٢٥٠"
RAW = "https://mizlaj.com.sa/guest/listings/" + SLUG
ENC = "https://mizlaj.com.sa/guest/listings/" + quote(SLUG)


def test_raw_and_encoded_are_the_same_path():
    assert http_liveness._path_of(RAW) == http_liveness._path_of(ENC)


def test_a_real_redirect_still_differs():
    assert http_liveness._path_of(RAW) != http_liveness._path_of("https://mizlaj.com.sa/")
    assert http_liveness._path_of(ENC) != http_liveness._path_of(
        "https://mizlaj.com.sa/guest/listings/" + quote("شقة-اخرى"))


class _Resp:
    def __init__(self, status, url, text):
        self.status_code, self.url, self.text = status, url, text


class _Sess:
    def __init__(self, resp):
        self.resp = resp

    def get(self, url, **_kw):
        return self.resp


def _signal(status, body, path_changed):
    if path_changed:
        return None
    return "gone" if status in (404, 410) else None


def test_arabic_slug_404_on_its_own_page_is_gone():
    body = "<html>" + "x" * 2200 + "</html>"
    probe = http_liveness.LivenessProbe(
        platform="mizlaj", signal=_signal,
        session=lambda: _Sess(_Resp(404, ENC, body)),
        url_for=lambda ad: RAW, attempts=1, backoff=0)
    verdict = probe.verify_gone("MZ29")
    assert verdict[0] == "gone", verdict


def test_arabic_slug_redirected_home_stays_unknown():
    body = "<html>" + "x" * 2200 + "</html>"
    probe = http_liveness.LivenessProbe(
        platform="mizlaj", signal=_signal,
        session=lambda: _Sess(_Resp(404, "https://mizlaj.com.sa/", body)),
        url_for=lambda ad: RAW, attempts=1, backoff=0)
    assert probe.verify_gone("MZ29")[0] == "unknown"


def test_lowercase_and_uppercase_percent_escapes_are_the_same_path():
    # nowaisiry / suwar store the link with lowercase escapes; servers report uppercase.
    stored = "https://alnowaisiry.com/lands/%f0%9f%8c%b1-%d9%84%d9%84%d8%a8%d9%8a%d8%b9/"
    landed = "https://alnowaisiry.com/lands/%F0%9F%8C%B1-%D9%84%D9%84%D8%A8%D9%8A%D8%B9/"
    assert http_liveness._path_of(stored) == http_liveness._path_of(landed)
