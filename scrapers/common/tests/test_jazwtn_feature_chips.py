"""jazwtn: the ad's own «المميزات» chip list answers kitchen / parking (🔬 AF engineer, 2026-10-14).

Three live ads re-read 10-14 each print `<ul class="list-inline projServ">` with one <li><p> per feature;
the list varies per ad («موقف خاص» on one of three). jazwtn scored 0 of 4 findable that night with kitchen
missed on 4 of 5, because the scraper never read the list. A chip present → True; absent → unknown.
"""
import scrapers.jazwtn.run as R

LI = '<li><span><img data-src="https://jazwtn.sa/wp-content/uploads/2024/09/{n}.png" class="lazyload"></span><p> {t}</p></li>'
FEATURES = ('<div class="pro_benfities project-single"><div class="title"><h1>المميزات</h1></div>'
            '<ul class="list-inline projServ">'
            + "".join(LI.format(n=i, t=t) for i, t in enumerate(
                ["مجالس ضيافة", "2 غرف", "2 دورات مياة ", "مطبخ", "خزان مستقل", "موقف خاص"]))
            + "</ul></div>")
WARRANTY = '<ul class="list-inline projServ">' + LI.format(n=99, t="ضمان على مصعد") + "</ul>"


def test_the_chip_list_answers_kitchen_and_parking():
    assert R.feature_answers(FEATURES + WARRANTY) == {"kitchen": True, "parking": True}


def test_a_missing_chip_is_unknown_never_no():
    page = FEATURES.replace("<p> موقف خاص</p>", "<p> مستودع</p>")
    assert R.feature_answers(page) == {"kitchen": True}
    assert R.feature_answers("<html>no list</html>") == {}


def test_the_warranty_block_is_not_read():
    assert "elevator" not in R.feature_answers(FEATURES + WARRANTY)
