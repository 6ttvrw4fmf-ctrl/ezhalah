"""The word reader's answers on REAL ads are locked (owner 2026-11-04: «we need it fixed, I never want this to happen ever
again»).

What happened. On 2026-11-04 a live walk found two reader faults that every existing barrier passed:
  1. real unit AC read as nothing — a near word or an entrance in the bullet BEFORE («بلكونة مطلة على لاندسكيب 🔹مكيفات
     راكبة», «مدخلان🔹 مكيفات راكبة») silenced it, and «قابل للتفاوض» (negotiable) read as «can be fitted»;
  2. nearby places read as the ad's own — «Close to shops, restaurants, and markets», «قريبة من جميع الخدمات: مسجد، مطعم»,
     and after the re-read a live check found more: «🌳 على مقربة جدًا من حديقة», «🕌 المسجد على بُعد خطوات».
The selftest (one sentence, one expected fact) and the evidence-phrase barrier (which words may be quoted) cannot see
either: the quoted word was right, the sentence around it was not. Both were found only by reading real ads old-vs-new.

So that reading is now a test. testdata/real_ads_golden.jsonl holds ~630 real ad sentences from aqar, dealapp, haraj,
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


# Text facts the lock also pins (🔬 2026-11-11, backlog 1718): a land's use is a verdict a customer's land group will
# read, so a reader change that moves one must be as loud as a yes/no change.
_LOCKED_TEXT = frozenset({"land_use_ar"})


def _answers(text):
    return {k: v for k, v in W.facts_of(text).items() if isinstance(v, bool) or k in _LOCKED_TEXT}


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
    # since 2026-11-05 «قابل للتفاوض» is held twice: _NEGOTIABLE and the prepared-word scope (_PREP_VERBAL) — undo both
    monkeypatch.setattr(W, "_NEGOTIABLE", ())
    monkeypatch.setattr(W, "_PREP_VERBAL", ())
    assert _diffs(_rows()), "undoing the «قابل للتفاوض» fix changed nothing — the lock cannot see it"


def test_lock_catches_a_distance_read_as_the_ads_own(monkeypatch):
    import re as _re
    monkeypatch.setattr(W, "_DISTANCE_TO", _re.compile(r"(?!x)x"))
    monkeypatch.setattr(W, "_DISTANCE_AFTER", ())
    assert _changed_facts(_diffs(_rows())) & {"mosque", "garden", "all_services"}


def test_lock_catches_a_public_place_near_or_area_read_as_the_ads_own(monkeypatch):
    monkeypatch.setattr(W, "_PURE_PUBLIC_FACTS", frozenset())
    monkeypatch.setattr(W, "_OWN_CUES", tuple(W._OWN_CUES) + tuple(W._n(w) for w in ("من", "عن", "و", "في", "علي")))
    assert _changed_facts(_diffs(_rows())) & {"mosque", "market", "garden"}


def test_lock_catches_the_plots_neighbour_read_as_the_ads_own(monkeypatch):
    monkeypatch.setattr(W, "_BOUNDARY_STEMS", ())
    assert _changed_facts(_diffs(_rows())) & {"mosque", "garden"}


def test_lock_catches_a_prepared_word_that_reaches_the_neighbour(monkeypatch):
    # undo the 2026-11-05 scope: any «تأسيس / يمكن» in the window silences the hit again («مطبخ تأسيس مصعد» loses its kitchen)
    monkeypatch.setattr(W, "_prepared_applies",
                        lambda before, after, hit="": any(W._starts(w, W._PREPARED) for w in before[-2:] + after[:2]))
    assert _changed_facts(_diffs(_rows())) & {"kitchen", "maid_room", "air_conditioner", "elevator"}


def test_lock_catches_a_view_word_silencing_the_homes_own_rooms(monkeypatch):
    monkeypatch.setattr(W, "_UNIT_ROOMS", frozenset())
    assert _changed_facts(_diffs(_rows())) & {"kitchen", "maid_room", "roof", "balcony", "elevator"}


def test_lock_catches_a_near_word_silencing_furniture(monkeypatch):
    # 🔬 2026-11-05: «قريبه من الملك سلمان موثثه بالكامل» (aqar 14856419) — the near word belongs to the place, the
    # furniture to the flat. Undo the fix and the lock must see it.
    monkeypatch.setattr(W, "_NEAR_NEVER_FACTS", frozenset({"air_conditioner"}))
    assert "furnished" in _changed_facts(_diffs(_rows()))


def test_own_district_takes_its_kind_word_with_it(monkeypatch):
    # 🔬 2026-11-05 yearly-rent furnished audit: blanking only the ad's own district name left «في حي          مؤثثه»,
    # and a word right after «حي» reads as a district — so «مؤثثة بالكامل», «مسبح», «مطبخ» after the ad's own
    # «حي الياسمين / بحي الملقا / حي النرجس» answered nothing (aqar 14861704, 14852480, 16198971, 22605359).
    cases = (("شقة فاخرة للايجار في حي الياسمين مؤثثة بالكامل", "حي الياسمين", "furnished"),
             ("فيلا للبيع بحي الملقا مسبح وحديقة", "حي الملقا", "pool"),
             ("شقة للايجار حي النرجس مطبخ راكب مكيفات", "حي النرجس", "kitchen"))
    for text, place, fact in cases:
        assert W.facts_of(W.clean_text(None, text), (place,)).get(fact) is True, text
    assert "water_tank" not in W.facts_of(W.clean_text(None, "ارض للبيع حي الخزان"), ("حي الخزان",))
    monkeypatch.setattr(W, "_PLACE_KIND_WORDS", ())
    lost = [t for t, p, f in cases if W.facts_of(W.clean_text(None, t), (p,)).get(f) is not True]
    assert lost, "undoing the kind-word blank changed nothing — this test cannot see the 2026-11-05 bug"


def test_a_labelled_bathroom_total_is_the_total(monkeypatch):
    # 🔬 2026-11-05 yearly-rent bathroom audit (50,906 homes with no bathroom count): «عدد دورات المياه 3» beside a room's
    # own «مجلس مستقل مع دورة مياه» answered nothing (haraj 18924617), and «الحمامات ٥» was not read (wasalt 481847).
    import re as _re
    cases = (("عامله1 مجلس مستقل مع دورة مياه 1 مطبخ1 عدد دورات المياه 3 عمر العقار اربع سنوات", 3.0),
             ("النوم ٤ من ضمنها غرفة ماستر\nالحمامات ٥\nمجلس ، صالة", 5.0))
    for text, want in cases:
        assert W.facts_of(W.clean_text(None, text)).get("bathrooms") == want, text
    # an unlabelled count beside an unnumbered one stays unstated (the total may be 3 or 4)
    assert "bathrooms" not in W.facts_of(W.clean_text(None, "• مجلس مستقل بدورة مياه • صالة • 3 دورات مياه"))
    monkeypatch.setattr(W, "_BATH_LABEL", _re.compile(r"(?!x)x"))
    assert W.facts_of(W.clean_text(None, cases[0][0])).get("bathrooms") is None, "undoing the labelled-total rule changed nothing"


def test_lock_catches_kitchen_stove_as_fire_pit(monkeypatch):
    # 🔬 2026-11-08: «مطبخ … فرن، موقد، شفاط» is the cooktop; without the rule the lock must go red on fire_pit
    monkeypatch.setattr(W, "_stove_not_fire", lambda *a, **k: False)
    assert "fire_pit" in _changed_facts(_diffs(_rows()))
