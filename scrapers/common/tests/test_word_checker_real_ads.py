"""The word reader's answers on REAL ads are locked (owner 2026-11-04: «we need it fixed, I never want this to happen ever
again»).

What happened. On 2026-11-04 a live walk found two reader faults that every existing barrier passed:
  1. real unit AC read as nothing — a near word or an entrance in the bullet BEFORE («بلكونة مطلة على لاندسكيب 🔹مكيفات
     راكبة», «مدخلان🔹 مكيفات راكبة») silenced it, and «قابل للتفاوض» (negotiable) read as «can be fitted»;
  2. nearby places read as the ad's own — «Close to shops, restaurants, and markets», «قريبة من جميع الخدمات: مسجد، مطعم».
The selftest (one sentence, one expected fact) and the evidence-phrase barrier (which words may be quoted) cannot see
either: the quoted word was right, the sentence around it was not. Both were found only by reading real ads old-vs-new.

So that reading is now a test. testdata/real_ads_golden.jsonl holds 369 real ad sentences from aqar, dealapp, haraj,
muhaysini, gathern, wasalt and rightcompound (PDPL-sanitised by the reader's own clean_text; the only long numbers left are
the public REGA ad-licence numbers), each with every yes / no the reader gives today — answers read by hand on 2026-11-04.
A change to word_checker.py that changes ONE answer on ONE of them fails here and prints the old-vs-new list.

If the change is right: regenerate with
    UPDATE_REAL_AD_ANSWERS=1 python -m pytest scrapers/common/tests/test_word_checker_real_ads.py
and write every changed answer in the PR, with the sentence — that list IS the proof docs/ops/AI_FACTS_READER.md asks for.
Never regenerate to make a red test green without reading each change.

The three mutation tests undo each 2026-11-04 fix in memory and require this lock to turn red.
"""
import json
import os
import pathlib

from scrapers.facts import word_checker as W

GOLD = pathlib.Path(__file__).resolve().parents[2] / "facts" / "testdata" / "real_ads_golden.jsonl"


def _rows():
    return [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]


def _answers(text):
    return {k: v for k, v in W.facts_of(text).items() if isinstance(v, bool)}


def _diffs(rows):
    out = []
    for r in rows:
        got = _answers(r["text"])
        if got != r["facts"]:
            changed = {k: (r["facts"].get(k), got.get(k)) for k in sorted(set(got) | set(r["facts"]))
                       if got.get(k) != r["facts"].get(k)}
            out.append((r["src"], r["id"], changed, r["text"][-180:].replace("\n", " / ")))
    return out


def test_reader_answers_on_real_ads_are_unchanged():
    rows = _rows()
    assert len(rows) >= 300, f"the real-ad set shrank to {len(rows)} — it may only grow"
    if os.environ.get("UPDATE_REAL_AD_ANSWERS") == "1":
        with GOLD.open("w", encoding="utf-8") as f:
            for r in rows:
                r["facts"] = dict(sorted(_answers(r["text"]).items()))
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return
    diffs = _diffs(rows)
    report = "\n".join(f"  {src} {i}: {ch}  | …{text}" for src, i, ch, text in diffs[:40])
    assert not diffs, (
        f"{len(diffs)} real ad(s) now read differently (old, new):\n{report}\n"
        "Read each sentence. If every change is right, regenerate (UPDATE_REAL_AD_ANSWERS=1) and list them in the PR.")


def _changed_facts(diffs):
    return {k for _, _, ch, _ in diffs for k in ch}


def test_lock_catches_ac_silenced_by_a_near_word(monkeypatch):
    monkeypatch.setattr(W, "_NEAR_NEVER_FACTS", frozenset())
    assert "air_conditioner" in _changed_facts(_diffs(_rows()))


def test_lock_catches_a_nearby_list_read_as_the_ads_own(monkeypatch):
    monkeypatch.setattr(W, "_PLACE_WORDS", ())
    assert _changed_facts(_diffs(_rows())) & {"restaurant_cafe", "mosque", "garden"}


def test_lock_catches_negotiable_read_as_can_be_fitted(monkeypatch):
    monkeypatch.setattr(W, "_NEGOTIABLE", ())
    assert _diffs(_rows()), "undoing the «قابل للتفاوض» fix changed nothing — the lock cannot see it"
