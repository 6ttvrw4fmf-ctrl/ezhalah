"""af_score's served-answer findability asks EVERY website (🔬 2026-11-05, owner: «we need this 100»).

On 2026-11-05 the page-stated findability tried 87 of 142 websites — muhaysini (11,028 served yeses), wasalt
(8,990), dwelleo (3,730), sakani (1,309) were never asked, because the score's page reader saw no answer on their
pages. served_findability() needs no page: an ad that carries a served Advanced Filter yes is asked for through the
public anon RPC with ONE of those answers, the way a customer taps one chip.
"""
import random
import sys

sys.path.insert(0, ".")

from scrapers.common import af_score as S  # noqa: E402


class Q:
    """The supabase-py builder chain the function uses; every row read returns the one stored ad."""

    def __init__(self, row, total):
        self.row, self.total, self.filters = row, total, []

    def __getattr__(self, name):
        if name == "not_":
            return self
        def f(*a, **k):
            self.filters.append((name, a))
            return self
        return f

    def execute(self):
        class R:
            pass
        r = R()
        r.count, r.data = self.total, ([self.row] if self.row else [])
        return r


class Client:
    def __init__(self, row, total=1):
        self.row, self.total, self.made = row, total, []

    def table(self, name):
        assert name == "search_listings_ar"
        q = Q(self.row, self.total)
        self.made.append(q)
        return q


class Anon:
    def __init__(self, rows):
        self.rows, self.sent = rows, []

    def rpc(self, name, params):
        self.sent.append((name, params))
        rows = self.rows

        class X:
            def execute(self):
                if rows is Exception:
                    raise RuntimeError("timeout")
                class R:
                    data = rows
                return R()
        return X()


AD = {"source_table": "muhaysini_residential_listings", "listing_id": 7, "deal_ar": "بيع", "city_ar": "الرياض",
      "district_ar": "الملقا", "type_ar": "شقة", "rent_period_ar": None, "elevator": True, "parking": None}


def run(row, anon, total=1):
    return S.served_findability(Client(row, total), anon, "muhaysini", random.Random(1), pace=0)


def test_the_ad_comes_back_for_the_answer_it_carries():
    anon = Anon([{"source_table": AD["source_table"], "listing_id": 7}])
    out = run(AD, anon)
    assert out == {"served_tried": 1, "served_found": 1, "served_missed_ids": []}
    name, params = anon.sent[0]
    assert name == "location_search_candidates_ar"
    # the customer's request: the ad's own scope plus the ONE answer it carries (an English slug, trap 3)
    assert params["p_amenities"] == ["elevator"] and params["p_districts"] == ["الملقا"]
    assert params["p_types"] == ["شقة"] and params["p_deal"] == "بيع"


def test_a_served_yes_the_customer_cannot_reach_is_a_miss_named_by_key():
    out = run(AD, Anon([{"source_table": AD["source_table"], "listing_id": 8}]))
    assert out == {"served_tried": 1, "served_found": 0, "served_missed_ids": ["muhaysini_residential_listings:7"]}


def test_a_failed_request_is_unknown_never_a_miss():
    assert run(AD, Anon(Exception)) == {"served_tried": 0, "served_found": 0, "served_missed_ids": []}


def test_monthly_furnished_is_never_asked_because_the_screen_never_offers_it():
    monthly = {**AD, "deal_ar": "إيجار", "rent_period_ar": "شهري", "elevator": None, "furnished": True}
    anon = Anon([])
    assert run(monthly, anon)["served_tried"] == 0 and anon.sent == []


def test_the_sample_only_reads_ads_that_carry_a_served_yes_and_no_land():
    c = Client(AD)
    S.served_findability(c, Anon([]), "muhaysini", random.Random(1), pace=0)
    names = [f for f, _ in c.made[0].filters]
    ors = [a[0] for f, a in c.made[0].filters if f == "or_"]
    assert "like" in names and ors and "elevator.is.true" in ors[0] and "furnished.is.true" in ors[0]


def test_no_anon_key_measures_nothing_rather_than_zero_found():
    assert S.served_findability(Client(AD), None, "x", random.Random(1)) == {
        "served_tried": 0, "served_found": 0, "served_missed_ids": []}


def test_the_row_writer_sends_the_served_columns():
    sent = []

    class T:
        def upsert(self, payload, on_conflict):
            sent.extend(payload)
            return self

        def execute(self):
            return None

    class C:
        def table(self, n):
            return T()
    row = {**S.new_row("2026-11-05", "x"), "served_tried": 3, "served_found": 2, "served_missed_ids": ["t:1"]}
    S.write_rows(C(), [row])
    assert sent[0]["served_tried"] == 3 and sent[0]["served_found"] == 2 and sent[0]["served_missed_ids"] == ["t:1"]


# sakan 95709 (sakan_residential_listings:12610753), re-read live 2026-11-05: the REGA deed's border rows as two
# spans. «مصعد» here is what the unit's southern border touches, not a lift the ad offers.
SAKAN_DEED = '''<div class="tr">
                            <span class="f14">نوع الحد الجنوبي</span>
                            <span class="f16 f16-700">:</span>
                        </div>
                                                                                                        <div class="tr">
                            <span class="f14">وصف الحد الجنوبي</span>
                            <span class="f16 f16-700"> مصعد  و ارتدادات 1  و درج  و ارتدادات 3 ثم شارع عرض 20 م </span>
                        </div>'''


def test_sakan_deed_border_row_is_not_the_ad():
    line = "مصعد و ارتدادات 1 و درج و ارتدادات 3 ثم شارع عرض 20 م"
    page = {"evidence_lines": [line, "قريب من الخدمات"], "text_head": line + " | قريب من الخدمات"}
    out = S.strip_boundary(page, SAKAN_DEED)
    assert out["evidence_lines"] == ["قريب من الخدمات"]
    assert "مصعد" not in out["text_head"]
