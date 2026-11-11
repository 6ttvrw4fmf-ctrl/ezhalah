"""Harness for verify-relative-posting-date-is-a-floor.ts — runs the REAL code, decides nothing itself.

`sweep()` plays a site: for thousands of true ages it writes the «منذ …» text the way a site may count (floored or
rounded, 30-day or calendar months, 365-day years), hands that text to the real `posted_no_earlier_than()`, and
reports every case where the floor came out AFTER the true posting time — i.e. where an ad would be called newer
than it is. `ialqarawi()` runs the real ialqarawi mapper over one page and reports what it would store. Both take
an optional mutated copy of the module under test, built the way scripts/lib/pythonMutant.ts builds one.
"""
import importlib
import json
import sys
import types
from datetime import datetime, timedelta, timezone

try:  # a scraper-runtime dependency; only its name is needed here, the mapper makes no request
    import curl_cffi  # noqa: F401
except ImportError:
    _cc = types.ModuleType("curl_cffi.requests")
    _cc.Session = type("Session", (), {})
    _parent = types.ModuleType("curl_cffi")
    _parent.requests = _cc
    sys.modules["curl_cffi"] = _parent
    sys.modules["curl_cffi.requests"] = _cc

READ_AT = datetime(2026, 11, 11, 9, 30, tzinfo=timezone.utc)


def _module(name, mutated_source=None):
    real = importlib.import_module(name)
    if not mutated_source:
        return real
    mod = types.ModuleType("mutant")
    mod.__dict__.update({k: v for k, v in real.__dict__.items() if not k.startswith("__")})
    mod.__dict__["__file__"] = real.__file__
    mod.__dict__["__name__"] = "mutant"
    exec(compile(mutated_source, "mutant.py", "exec"), mod.__dict__)
    return mod


def _site_texts(age):
    """Every «N unit» a site could print for an ad `age` old, one per way of counting."""
    d = age / timedelta(days=1)
    h = age / timedelta(hours=1)
    out = []
    if d < 1:
        out += [f"{int(h)} ساعة", f"منذ {int(h)} ساعات"]
    if d < 30:
        out += [f"{int(d)} يوم", f"مضاف منذ {int(d)} يوم", f"{round(d)} يوم" if round(d) < 30 else None]
    if 30 <= d < 400:
        out += [f"{int(d // 30)} شهر", f"{int(d // 30.4375)} شهر", f"{max(1, round(d / 30))} شهر"]
    if 7 <= d < 30:
        out += [f"{int(d // 7)} أسبوع"]
    if d >= 365:
        out += [f"{int(d // 365.25)} سنة", f"{int(d // 365)} سنة", f"{round(d / 365)} سنة"]
    return [t for t in out if t and not t.startswith("0 ")]


def sweep(mutated_source=None):
    pd = _module("scrapers.common.posting_date", mutated_source)
    ages = ([timedelta(hours=h) for h in range(1, 72)]
            + [timedelta(hours=6 * i) for i in range(12, 1700)]
            + [timedelta(days=d) for d in range(420, 3700)])
    bad, read = [], 0
    for age in ages:
        posted = READ_AT - age
        for text in _site_texts(age):
            floor = pd.posted_no_earlier_than(text, READ_AT)
            if floor is None:
                continue
            read += 1
            if datetime.fromisoformat(floor) > posted:
                bad.append({"text": text, "true_age_days": round(age / timedelta(days=1), 2), "floor": floor})
    return {"read": read, "bad": bad[:5], "bad_count": len(bad)}


def floors(texts, mutated_source=None):
    pd = _module("scrapers.common.posting_date", mutated_source)
    return [pd.posted_no_earlier_than(t, READ_AT) for t in texts]


def ialqarawi(added_ago, mutated_source=None):
    from scrapers.common import arabic_location as al
    if not al._CITY:  # a non-empty map short-circuits _load(): no database
        al._CITY[al.norm_ar("الرياض")] = [(1, 1)]
    mod = _module("scrapers.ialqarawi.run", mutated_source)
    card = {"id": 4538, "catid": 1, "type": 1, "title": "فيلا للبيع في حي النرجس بالرياض",
            "url": "https://ialqarawi.com/in/4538"}
    fields = {"رقم العقار": "4538", "سعر السوم": "1.500.000"}
    if added_ago is not None:
        fields["مضاف منذ"] = added_ago
    before = datetime.now(timezone.utc)
    row, _cat, why = mod.map_listing(card, {"title": card["title"], "fields": fields, "desc": ""})
    after = datetime.now(timezone.utc)
    row = row or {}
    return {"why": why, "mapped": bool(row), "floor": row.get("posted_earliest_at"),
            "date_added": row.get("date_added"), "before": before.isoformat(), "after": after.isoformat()}


if __name__ == "__main__":
    sys.path.insert(0, sys.argv[1])
    payload = json.loads(sys.stdin.read())
    print(json.dumps(globals()[payload["fn"]](*payload["args"], mutated_source=payload.get("mutated_source")),
                     ensure_ascii=False, default=str))
