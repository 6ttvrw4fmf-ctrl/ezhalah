"""A district is the «حي X» name only: the city the site writes after it is not part of it.

Card parity, 2026-11-09 (alert 13905): Era Pulse writes its location free-hand. Ad 7855827 says
«حي البصر - مدينة البصر» and we stored the district «البصر - مدينة»: the tail strip removed the city
word and left the «- مدينة» that introduced it. The location strings below are the real ones stored in
additional_info.location_text that day.

Run: python scrapers/erapulse/test_district_drops_the_city_tail.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import scrapers.erapulse.run as m  # noqa: E402


def hood(loc):
    return m.parse_location(loc)[2]


# the two real rows
assert hood("حي البصر - مدينة البصر") == "البصر", hood("حي البصر - مدينة البصر")
assert hood("حي الرحاب - بريده") == "الرحاب", hood("حي الرحاب - بريده")
# the shapes the strip already handled keep working
assert hood("حي الروضة بريدة") == "الروضة"
assert hood("حي الروضة - محافظة عنيزة") == "الروضة"
assert hood("حي الروضة مدينة بريدة") == "الروضة"
# a district whose own name is a city word is never wiped
assert hood("حي البصر") == "البصر"
# a name that merely contains «مدينة» mid-way is left alone
assert hood("حي مدينة الملك فهد") == "مدينة الملك فهد", hood("حي مدينة الملك فهد")

print("OK erapulse: the district keeps its name and drops the city tail")
