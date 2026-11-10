"""A catch-all subType never becomes «Apartment» while the office's own title names the property.

🦅 Falcon 2026-11-10: Era Pulse sends subType «OTHER_RESIDENTIAL» for anything its form does not list, and
map_listing turned it into «Apartment». Of the 24 live rows stored as Apartment that day, 21 were not:
lands, villas, chalets and a warehouse. A customer searching «شقة» in بريدة got land plots; one searching
«فيلا» lost 8 villas. The titles below are the real stored titles of those rows (ids in comments).

Run: python scrapers/erapulse/test_catch_all_subtype_reads_the_title.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import scrapers.erapulse.run as m  # noqa: E402

BASE = json.loads((Path(__file__).parent / "testdata" / "REF-MVSCCSNQ-2JJTS.list-item.json").read_text())


def typed(title, subtype="OTHER_RESIDENTIAL", top="RESIDENTIAL"):
    p = {**BASE, "title": title, "subType": subtype, "type": top}
    row, cat = m.map_listing(p)
    return (row or {}).get("property_type"), cat, ((row or {}).get("additional_info") or {}).get("type_source")


CASES = [
    ("فله مودرن -حي الربوة للبيع", "Villa", "residential"),               # 648074
    ("للبيع فلة بحي الإسكان", "Villa", "residential"),                     # 648075
    ("فيلا للبيع بحي النهضة", "Villa", "residential"),                     # 648070
    ("ارض للبيع - حي الواحه", "Residential Land", "residential"),          # 646391
    ("أرض سكنية حي الفايزية قريب من الامارة", "Residential Land", "residential"),  # 646393
    ("ارض سكنيه حي الشقة – بريدة", "Residential Land", "residential"),    # 3961979: «حي الشقة» is a district, not a flat
    ("شاليه بحي التوفيق", "Chalet", "residential"),                        # 648063
    ("استراحة فاخرة للبيع | شاليه مودرن | فيلا مع مسبح وحديقة | على شارعين ✨", "Rest House", "residential"),  # 648065
    ("مستودع / حوش بمحافظة الشماسية", "Warehouse", "commercial"),          # 2203407
    ("دور ارضي بحي البصر 3", "Floor", "residential"),                      # 7855826
    ("للبيع شقة دور أرضي – شارع عثمان بن عفان | بريدة", "Floor", "residential"),  # 648058: longest token «دور أرضي»
    ("شقة فاخرة حي الروضة", "Apartment", "residential"),                   # 3961981 stays a flat
    ("للبيع شالية بحي السلمان", "Chalet", "residential"),                  # 21673925: the ة spelling
    ("صالات تجارية للإيجار - مجمع روفان التجاري بريدة", "Shop", "commercial"),  # 26359507: plural commercial halls
]
bad = []
for title, want, cat in CASES:
    got = typed(title)
    if got[:2] != (want, cat) or got[2] != "title":
        bad.append((title, want, cat, got))

# a title that names nothing keeps the site's own coarse type, labelled as such (never dropped)
got = typed("حي ضراس")
if got != ("Apartment", "residential", "top_level_type"):
    bad.append(("حي ضراس", "Apartment/top_level_type", "", got))
# a SPECIFIC subType still wins over the title (the site's structured word for this property)
got = typed("فيلا للبيع", subtype="APARTMENT")
if got[:2] != ("Apartment", "residential") or got[2] != "subtype":
    bad.append(("APARTMENT subtype", "Apartment/subtype", "", got))

# MUTATION: the old mapping (catch-all → Apartment, title ignored) must fail this test
orig = m.CATCH_ALL_SUBTYPES
m.CATCH_ALL_SUBTYPES = set()
mutant = typed("فله مودرن -حي الربوة للبيع")
m.CATCH_ALL_SUBTYPES = orig
if mutant[0] == "Villa":
    bad.append(("MUTATION", "the old catch-all mapping must read Apartment", "", mutant))

if bad:
    for b in bad:
        print("FAIL", b)
    sys.exit(1)
print(f"PASS {len(CASES) + 2} cases + 1 mutation: a catch-all subType reads the office's title")
