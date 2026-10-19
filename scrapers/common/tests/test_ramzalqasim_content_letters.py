"""ramzalqasim: the marker's `content` letters are its «المحتويات» chip list (🔬 AF engineer, 2026-10-14, backlog 248).

Live 10-14: /x/264 content M,N,K,L,J,G,H,I,F,E,A,C renders «توفير صرف صحي، صالة، توفير الماء، توفير الكهرباء، غرفة
خادمة، حوش، سطح، درج داخلي، مدخل سيارة، ملحق، مجلس رجال، مطبخ»; kitchen was 0 of 153 stored.
"""
import scrapers.ramzalqasim.run as R


def test_the_letters_render_as_the_page_chips():
    assert R.content_labels('["M","N","K","L","J","G","H","I","F","E","A","C"]') == [
        "توفير صرف صحي", "صالة", "توفير الماء", "توفير الكهرباء", "غرفة خادمة", "حوش", "سطح", "درج داخلي",
        "مدخل سيارة", "ملحق", "مجلس رجال", "مطبخ"]


def test_kitchen_and_maid_room_answer_yes_and_silence_stays_unknown():
    assert R.content_answers(R.content_labels('["C","J","F"]')) == {"kitchen": True, "maid_room": True}
    assert R.content_answers(R.content_labels('["M","L","K","G"]')) == {}
    assert R.content_labels(None) == [] and R.content_labels("not json") == []
