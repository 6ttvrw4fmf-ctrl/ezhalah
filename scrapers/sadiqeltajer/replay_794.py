"""PROBE ONLY (backlog 794): replay the description-box reader over every ACTIVE sadiqeltajer row. Writes nothing.
Prints, per row the new reader changes, the field gained and the clause that states it (no names, no phones)."""
from __future__ import annotations

import re
import time
from collections import Counter

from scrapers.common import db, normalize
import scrapers.sadiqeltajer.run as S

FIELDS = ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room", "private_entrance",
          "furnished", "balcony", "laundry_room", "pool")


def main() -> int:
    sb = db.sb()
    rows = []
    for t in (S.RES_TABLE, S.COM_TABLE):
        off = 0
        while True:
            d = sb.table(t).select("id,listing_url,property_type").eq("active", True).range(off, off + 999).execute().data or []
            rows += [(t, r) for r in d]
            if len(d) < 1000:
                break
            off += 1000
    print(f"replay: {len(rows)} active rows", flush=True)
    s = S.session()
    gained, unread, land, same = Counter(), 0, 0, 0
    for i, (t, r) in enumerate(rows, 1):
        if r["property_type"] in S._NOT_A_UNIT:
            land += 1
            continue
        try:
            resp = s.get(r["listing_url"], timeout=40)
        except Exception:
            unread += 1
            continue
        if resp.status_code != 200:
            unread += 1
            continue
        old_row, _c, _w = S.map_listing(r["listing_url"], resp.text)
        if not old_row:
            unread += 1
            continue
        txt = S.unit_description_text(resp.text, old_row["property_type"])
        new = normalize.prose_amenities_yes(txt)
        old = normalize.prose_amenities_yes(old_row["additional_info"].get("components"))
        add = {k for k in new if k not in old}
        if not add:
            same += 1
            continue
        for k in sorted(add):
            gained[k] += 1
            kw = {"air_conditioner": "مكيف|تكييف|مكيفات", "kitchen": "مطبخ", "parking": "موقف|مواقف|كراج|مظلة",
                  "elevator": "مصعد", "furnished": "مفروش|مؤثث|اثاث|أثاث", "maid_room": "خادم", "driver_room": "سائق"}.get(k, k)
            ev = [c for c in (txt or "").split("\n") if re.search(kw, c)][:2]
            print(f"  GAIN {t}:{r['id']} {old_row['property_type']} {k} <- {ev}", flush=True)
        time.sleep(0.3)
    print(f"replay done: units with a gain {sum(1 for _ in gained)} kinds, gains {dict(gained)}, unchanged {same}, "
          f"land skipped {land}, unreadable {unread}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
