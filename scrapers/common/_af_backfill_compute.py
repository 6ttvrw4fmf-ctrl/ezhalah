"""SCRATCH (not for merge): compute tonight's backfill with the PR's own readers, read-only."""
from scrapers.common.db import sb
from scrapers.common import normalize as N
from scrapers.therc.run import description_amenities

COLS = "kitchen,elevator,parking,maid_room,driver_room,air_conditioner,furnished,laundry_room,balcony_terrace,private_entrance,car_entrance,optical_fibers"


def rows(c, table, sel):
    out, lo = [], 0
    while True:
        b = c.table(table).select(sel).eq("active", True).range(lo, lo + 999).execute().data or []
        out += b
        if len(b) < 1000:
            return out
        lo += 1000


def main():
    c = sb()
    n = 0
    for table, fn in (("therc_residential_listings", lambda r: description_amenities(r.get("description"))),
                      ("shomou_residential_listings", lambda r: N.prose_amenities_yes(r.get("description")))):
        for r in rows(c, table, "id,description," + COLS):
            for col, v in fn(r).items():
                if v is True and r.get(col) is None:
                    print(f"BF|{table}|{r['id']}|{col}|t"); n += 1
    for r in rows(c, "arkaan_residential_listings", "id,direction,source_capture,additional_info"):
        if r.get("direction") is not None:
            continue
        ad = ((r.get("source_capture") or {}).get("detail") or {}).get("ad_text")
        raw = (r.get("additional_info") or {}).get("street_width_raw") or ""
        if "×" in raw:
            continue
        d = N.street_from_prose(ad)[1]
        if d:
            print(f"BF|arkaan_residential_listings|{r['id']}|direction|{d}"); n += 1
    print(f"BF_TOTAL {n}")


if __name__ == "__main__":
    main()
