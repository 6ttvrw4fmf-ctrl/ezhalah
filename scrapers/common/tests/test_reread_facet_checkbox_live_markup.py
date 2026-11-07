"""A search-facet checkbox is not the ad, in the markup the site really prints (🔬 2026-11-06).

Pasted unchanged from the live re-read of eaqartabuk ad 598690 (net.http_get, 2026-11-06). The 11-05 rule
(FACET_CHECKBOX) was proven on hand-written markup with no tag between the box and the count, so this real shape —
<label> around the text, <small> around the count — survived, and the 11-06 score read «مسبح» as pool we_miss 10 of 10.
"""
import sys

sys.path.insert(0, ".")

from scrapers.common.source_reread import page_evidence  # noqa: E402

LIVE_598690 = '''<div class="option-bar">
                        <input type="checkbox" id="feature-pool" name="features[]" value="pool"  />
                        <label for="feature-pool">مسبح                            <small>(0)</small></label>
                    </div>'''


def _text(body):
    ev = page_evidence("<html><body><h1>ملحق للإيجار حي الحمراء</h1>" + body + "</body></html>")
    return " ".join([ev.get("text_head") or ""] + list(ev.get("evidence_lines") or []))


def test_the_live_facet_is_dropped():
    assert "مسبح" not in _text(LIVE_598690)


def test_a_ticked_feature_is_kept():
    assert "مسبح" in _text('<div><input type="checkbox" checked /> <label>مسبح</label></div>')
    assert "مسبح" in _text('<div><input type="checkbox" checked /> <label>مسبح <small>(0)</small></label></div>')


def test_the_old_shape_is_still_dropped():
    assert "مدخل خاص" not in _text('<input type="checkbox" id="feature-private-entrance" name="features[]" '
                                     'value="private-entrance" /> مدخل خاص (19)')
