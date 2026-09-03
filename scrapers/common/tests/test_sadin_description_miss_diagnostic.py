"""A dead sadin description selector must REPORT the live markup, not fail silently.

The 2026-08-14 → 2026-09-03 outage lasted three weeks because this parse failing is silent, and it
then cost a second, failed fix because the markup could not be read from the audit container (its
egress policy 403s sadin.com.sa) and a dt/dd shape was inferred instead. `_report_description_miss`
makes the crawler — which runs where the source IS reachable — print the shape.

These tests pin the properties that make it safe to leave in permanently: it is bounded, it is
structural, and it does not leak PII into a CI log.
"""
import re

from scrapers.sadin import run as sadin


def _reset():
    sadin._DESC_MISS_REPORTS = 0


def test_reports_dt_labels_and_tag_skeleton_when_label_is_present(capsys):
    _reset()
    html = ('<dl><dt>المساحة</dt><dd>500 م²</dd>'
            '<dt>وصف العقار</dt><section class="ad-body"><p>نص الوصف هنا</p></section></dl>')
    sadin._report_description_miss('SDTEST1', html)
    out = capsys.readouterr().out
    assert 'SDTEST1' in out
    assert 'at offset' in out                      # label was located, not reported absent
    assert 'المساحة' in out and 'وصف العقار' in out  # dt labels enumerated
    assert 'class="ad-body"' in out                # the container shape is what we came for
    assert '<p>' in out


def test_reports_candidate_class_tokens_when_the_label_is_gone(capsys):
    """The other real possibility: the label itself changed, so there is nothing to anchor to."""
    _reset()
    html = '<div class="property-desc-block">نص</div><div class="sidebar">x</div>'
    sadin._report_description_miss('SDTEST2', html)
    out = capsys.readouterr().out
    assert 'ABSENT from the page' in out
    assert 'property-desc-block' in out
    assert 'sidebar' not in out                    # only description-ish tokens, not every class


def test_is_bounded_so_a_platform_wide_break_cannot_flood_the_log(capsys):
    _reset()
    html = '<dt>وصف العقار</dt><div class="x">y</div>'
    for i in range(6):
        sadin._report_description_miss(f'SD{i}', html)
    out = capsys.readouterr().out
    assert out.count('[desc-miss] SD') > 0
    reported = {m for m in re.findall(r'\[desc-miss\] (SD\d):', out)}
    assert len(reported) == sadin._DESC_MISS_LIMIT == 2, reported


def test_phone_numbers_are_redacted_out_of_the_text_sample(capsys):
    """This output lands in a CI log, so the one free-text sample goes through _redact (PDPL)."""
    _reset()
    html = '<dt>وصف العقار</dt><div class="t">أرض للبيع للتواصل 0501234567 مع المالك</div>'
    sadin._report_description_miss('SDTEST3', html)
    out = capsys.readouterr().out
    assert '0501234567' not in out
    assert 'text after label' in out


def test_a_present_description_never_triggers_the_diagnostic(capsys):
    """It must fire only on an actual miss — otherwise it is noise on every healthy row."""
    _reset()
    html = '<dt>وصف العقار</dt><dd>أرض تجارية المطلوب 5,000,000 ريال</dd>'
    assert sadin._description(html) is not None
    assert sadin._DESC_MISS_REPORTS == 0
