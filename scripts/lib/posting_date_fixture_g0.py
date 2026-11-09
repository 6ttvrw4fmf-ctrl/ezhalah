"""Posting-date fixtures, group 0: wasalt. Contract: scripts/lib/posting_date_fixture_more.py."""
import copy
import json
import os

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


# ── wasalt: the stored real search-list property 5966658 (owner fields removed) ──────────────────
def wasalt_args(published_at, updated_at="2026-11-03T13:04:22.535Z", deal="sale"):
    with open(os.path.join(_ROOT, "scrapers", "wasalt", "testdata", "5966658.search-property.json"),
              encoding="utf-8") as fh:
        prop = json.load(fh)
    prop = copy.deepcopy(prop)
    prop.pop("publishedAt", None)
    if published_at is not None:
        prop["publishedAt"] = published_at
    prop["updatedAt"] = updated_at
    return [prop, deal]


PLATFORMS = {
    "wasalt": ("scrapers.wasalt.run", wasalt_args, lambda m, a: (m.map_property(*a), "")),
}

CASES = {
    "wasalt": [
        [["2026-10-31T10:19:21.069Z"], "2026-10-31T13:19:21+03:00",
         "publishedAt read live on wasalt 5966658 → the same instant in Saudi time"],
        [["2026-11-08T22:30:00.000Z"], "2026-11-09T01:30:00+03:00",
         "a late-evening UTC publish lands on the Saudi day"],
        [[None], None, "no publishedAt → NULL, the ad still maps"],
        [[None, "2026-11-09T08:00:00.000Z"], None,
         "only updatedAt (an edit) is present → NULL, an edit is not a posting"],
    ],
}

MUTATIONS = {
    "wasalt": [
        ["wasalt reading updatedAt (an edit) as the posting date", "scrapers/wasalt/run.py",
         '"date_added": site_posting_date(prop.get("publishedAt")),',
         '"date_added": site_posting_date(prop.get("updatedAt")),',
         [None, "2026-11-09T08:00:00.000Z"]],
        ["wasalt reading the REGA licence date as the posting date", "scrapers/wasalt/run.py",
         '"date_added": site_posting_date(prop.get("publishedAt")),',
         '"date_added": site_posting_date(info.get("regaAdvLicDate") or "2026-01-05"),',
         [None]],
    ],
}
