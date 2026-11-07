"""akariyoun: the REGA ad licence on the ad's own page reaches the card (🔧 2026-11-07).

Card parity (card_parity_card_missing:akariyoun:licence) found «رقم رخصة الإعلان» on akariyoun's page and on 0 of
298 cards. The cell, as served on 11-07 by /properties/ard-llbyaa-fy-hy-alkhlyg, is pinned below. Runs the REAL
parser. CI runs this file as a script.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.akariyoun.run import parse_ad_licence  # noqa: E402

CELL = ('<tr> <td class="p-2" style="width:25%" > <div class="small" style="color: rgb(33, 107, 194)">'
        'رقم رخصة الإعلان</div> <div>7201006705</div> </td>')
assert parse_ad_licence(CELL) == "7201006705", "the page's licence cell was not read"
assert parse_ad_licence(CELL.replace("7201006705", "٧٢٠١٠٠٦٧٠٥")) == "7201006705", "Arabic-Indic digits"
for bad in ("", "<div>رقم رخصة الإعلان</div> <div>12345</div>", "<div>رقم الترخيص</div> <div>7201006705</div>",
            "<div>رقم رخصة الإعلان</div> <div>72010067051</div>"):
    assert parse_ad_licence(bad) is None, bad
print("✓ akariyoun: the ad licence cell reaches the card")
