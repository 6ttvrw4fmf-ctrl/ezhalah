"""--sites «table:id» re-scores exactly those ads (backlog #583, 2026-10-26)."""
from scrapers.common.new_listings_score import explicit_picks


def test_table_id_tokens_are_explicit_picks():
    assert explicit_picks(["abaad_residential_listings:17954821", "aljassim_residential_listings:17947950"]) == [
        ("abaad_residential_listings", 17954821), ("aljassim_residential_listings", 17947950)]


def test_plain_site_names_are_not_picks():
    assert explicit_picks(["abaad", "aljassim"]) == []
    assert explicit_picks(["abaad:", ":12", "x:abc"]) == []
