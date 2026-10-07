/**
 * The 🔬 Advanced Filter score (scrapers/common/af_score.py) must keep telling findability, precision and
 * capture apart, EXECUTED rather than grepped: the module is loaded under Python with its network imports
 * stubbed, its pure decisions are run, and each is mutation-proven (a mutated copy must fail this check).
 * Also pins that the table, the dispatch-only workflow and the 08:00 UTC cron row exist.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const SRC = 'scrapers/common/af_score.py';
const PY = String.raw`
import sys, types, json
for m in ("scrapers.common.cleanup", "scrapers.common.db", "scrapers.common.source_reread"):
    mod = types.ModuleType(m); mod._probe = None; mod.sb = None; mod.page_evidence = None; sys.modules[m] = mod
sys.path.insert(0, ".")
src = sys.stdin.read()
ns = {"__name__": "af_score_under_test"}
exec(compile(src, "af_score.py", "exec"), ns)
out = []
def check(name, ok): out.append((name, bool(ok)))
L = lambda *x: [ns["norm"](s) for s in x]
check("negated amenity is not a yes", not ns["page_says_yes"](L("لا يوجد مصعد"), "elevator"))
check("named amenity is a yes", ns["page_says_yes"](L("مصعد"), "elevator"))
check("a prepared lift shaft is not a lift", not ns["page_says_yes"](L("تأسيس مصعد"), "elevator"))
check("found", ns["findable"]([{"source_table": "t", "listing_id": 5}], "t", 5) is True)
check("absent is a miss", ns["findable"]([{"source_table": "t", "listing_id": 6}], "t", 5) is False)
check("failed request is undecided", ns["findable"](None, "t", 5) is None)
check("row-capped list is undecided", ns["findable"]([{"source_table": "t", "listing_id": 6}] * ns["RPC_LIMIT"], "t", 5) is None)
a = ns["customer_answers"](L("مصعد", "مطبخ"), {"elevator": "we_miss", "kitchen": "match", "parking": "page_silent"})
check("NULL where the ad says yes is still asked for", "elevator" in a and "parking" not in a)
check("never a stored-false answer", ns["customer_answers"](L("مصعد"), {"elevator": "mismatch"}) == [])
p = ns["rpc_params"]({"deal_ar": "بيع", "city_ar": "الرياض", "type_ar": "شقة"}, ["elevator", "furnished"])
check("amenity is an English slug", p["p_amenities"] == ["elevator"] and p["p_furnished"] is True)
check("no city, no request", ns["rpc_params"]({"deal_ar": "بيع", "type_ar": "شقة"}, ["elevator"]) is None)
r = ns["rpc_params"]({"deal_ar": "إيجار", "city_ar": "الرياض", "type_ar": "شقة", "rent_period_ar": "شهري"}, ["elevator"])
check("a rent request carries the rent period the customer picks", r.get("p_rent_period") == "شهري")
check("furnished is never asked on Monthly (no Monthly cohort offers it)",
      ns["offered"](["elevator", "furnished"], {"rent_period_ar": "شهري"}) == ["elevator"]
      and ns["offered"](["furnished"], {"rent_period_ar": "سنوي"}) == ["furnished"])
check("a navigation link is not the ad", ns["page_lines"]({"evidence_lines": ["مواقف سيارات للإيجار", "موقف خاص"]}) == L("موقف خاص"))
check("an empty label is not a yes", not ns["page_says_yes"](ns["page_lines"]({"evidence_lines": ["موقف السيارة :"]}), "parking"))
check("furniture is not furnished", not ns["page_says_yes"](L("شركات الصيانة ونقل المفروشات"), "furnished")
      and ns["page_says_yes"](L("شقة مفروشة"), "furnished"))
nd = {"props": {"pageProps": {"propertyDetailsV3": {"title": "شقة للإيجار", "description": "شقة مع مصعد وموقف خاص",
      "agentInfo": {"name": "X", "phone": "0500000000"}}}}}
wp = ns["wasalt_page"]("https://wasalt.sa/ar/property/1", fetch=lambda u: (nd, 200, 1))
check("a live wasalt page is read, not unreadable", wp is not None and ns["page_says_yes"](L(*wp["evidence_lines"]), "elevator"))
check("wasalt contact fields are never read", wp is not None and not any("0500" in x for x in wp["evidence_lines"]))
check("a wasalt block stays unreadable", ns["wasalt_page"]("u", fetch=lambda u: (None, None, 0)) is None)
class _R:
    def __init__(self, d): self.data = d
    def execute(self): return self
class _Anon:
    def __init__(self, promised, after, fail=False): self.p, self.a, self.f = promised, after, fail
    def rpc(self, name, params):
        if self.f: raise RuntimeError("down")
        return _R([{"cnt_elevator": self.p}] if name == "apartment_guided_counts_ar" else self.a)
PQ = {"p_deal": "بيع", "p_cities": ["الرياض"], "p_types": ["شقة"], "p_amenities": ["elevator"], "p_limit": 5000, "p_offset": 0}
check("parity: the promised option count equals the results after the tap", ns["parity"](_Anon(229, 229), PQ) is True)
check("parity: a promise the tap does not keep is a parity failure", ns["parity"](_Anon(229, 228), PQ) is False)
check("parity: a failed read is undecided, never a pass", ns["parity"](_Anon(1, 1, fail=True), PQ) is None)
check("parity: only one-amenity requests are judged", ns["parity"](_Anon(1, 1), {**PQ, "p_amenities": ["elevator", "kitchen"]}) is None)
SO = ns["structured_only"]
check("a prose «موقف» is not a statement where aqar publishes parking structurally",
      SO("aqar", {"parking": "we_miss"}, {"parking": None}, {"jsonld": []})["parking"] == "page_silent")
check("aqar's own structured «مطبخ» still catches a trapped NULL",
      SO("aqar", {"kitchen": "page_silent"}, {"kitchen": None},
         {"jsonld": [{"amenityFeature": [{"name": "مطبخ", "value": True}]}]})["kitchen"] == "we_miss")
check("aqar's structured «مصعد=false» against a stored yes is a mismatch",
      SO("aqar", {"elevator": "match"}, {"elevator": True},
         {"jsonld": [{"additionalProperty": [{"name": "مصعد", "value": False}]}]})["elevator"] == "mismatch")
check("a site with no structured field keeps its prose answer",
      SO("sakan", {"parking": "we_miss"}, {"parking": None}, {})["parking"] == "we_miss")
T = ns["template_lines"]
menu = L("أجهزة مطبخ", "مكيفات هواء")
check("a line on every page of the site is its template, not the ad",
      T([menu + L("مصعد"), menu + L("شقة"), menu + L("مطبخ راكب")]) == set(menu))
check("two pages that agree are still ads (too few to call a template)", T([L("مطبخ"), L("مطبخ")]) == set())
check("a line missing from one page is not template", T([L("مطبخ", "x"), L("مطبخ"), L("y")]) == set())
class _Q:
    def __init__(self, data): self.data = data
    def select(self, *a): return self
    def eq(self, *a): return self
    def limit(self, *a): return self
    def execute(self): return self
class _C:
    def table(self, name):
        if name == "search_listings_ar":
            return _Q([{"deal_ar": "بيع", "city_ar": "الرياض", "type_ar": "شقة"}])
        return _Q([{"listing_url": "https://site/x"}])
pages = iter([["أجهزة مطبخ", "شقة 1"], ["أجهزة مطبخ", "شقة 2"], ["أجهزة مطبخ", "شقة 3"]])
ns["page_evidence"] = lambda body: {"evidence_lines": next(pages)}
asked = []
ns["ask"] = lambda anon, params: asked.append(params) or []
ns["score_site"](_C(), object(), "site", [("t", 1), ("t", 2), ("t", 3)], night="n", pace=0,
                 probe=lambda u: (200, "<html>"), wasalt=None)
check("score_site never asks a customer question its website's template answered", asked == [])
pages = iter([["موقف سيارات خاص"], ["مدخل خاص", "موقف سيارات خاص"]])
asked.clear()
ns["score_site"](_C(), object(), "aqar", [("t", 1), ("t", 2)], night="n", pace=0,
                 probe=lambda u: (200, "<html>"), wasalt=None)
check("score_site never asks aqar's parking from the ad's prose", not any("parking" in (q.get("p_amenities") or []) for q in asked))
print(json.dumps(out))
`;

function run(src: string): [string, boolean][] {
  return JSON.parse(execFileSync('python3', ['-c', PY], { input: src, encoding: 'utf8' }).trim().split('\n').pop()!);
}
const real = readFileSync(SRC, 'utf8');
const bad = run(real).filter(([, ok]) => !ok);
if (bad.length) { console.error('af_score fails: ' + bad.map(([n]) => n).join(', ')); process.exit(1); }

const mustCatch = (what: string, find: string, repl: string) => {
  if (!real.includes(find)) { console.error(`mutation anchor missing: ${what}`); process.exit(1); }
  if (!run(real.replace(find, repl)).some(([, ok]) => !ok)) { console.error(`NOT CAUGHT: ${what}`); process.exit(1); }
};
mustCatch('a NULL read as a miss when the list was capped', 'return None if len(rows) >= RPC_LIMIT else False', 'return False');
mustCatch('a failed request read as not found', 'if rows is None:\n        return None', 'if rows is None:\n        return False');
mustCatch('a negated amenity read as a yes', 'and not all(re.search(NEG', 'and not any(re.search(r"^$"');
mustCatch('stored NULL no longer asked for', 'in (MATCH, WE_MISS) and page_says_yes', 'in (MATCH,) and page_says_yes');
mustCatch('amenity sent as Arabic', 'p["p_amenities"] = slugs', 'p["p_amenities"] = answers');
mustCatch('rent period dropped for «إيجار»', 'RENT = ("إيجار", "ايجار")', 'RENT = ("ايجار",)');
mustCatch('furnished asked on Monthly', 'return [a for a in answers if a != FURNISHED]', 'return answers');
mustCatch('wasalt agent block read', 'if key and _WASALT_SKIP.search(key):', 'if False:');
mustCatch('wasalt page dropped as unreadable', 'if status != 200 or not isinstance(pd, dict):\n        return None', 'return None');
mustCatch('an empty label read as a yes', 'and not BARE_LABEL.match(x)]', ']');
mustCatch('the site template read as the ad (no template filter)', 'ad_lines = [x for x in page_lines(page) if x not in chrome]', 'ad_lines = page_lines(page)');
mustCatch('the template computed from too few pages', 'if len(readable) < TEMPLATE_MIN_PAGES:', 'if len(readable) < 1:');
mustCatch('one page enough to call a line template', 'return set.intersection(*readable)', 'return set.union(*readable)');
mustCatch('a lift shaft read as a lift', 'hit = [x for x in (unprepared(y, kw) for y in lines) if re.search(kw, x)]', 'hit = [x for x in lines if re.search(kw, x)]');
mustCatch('parity compares the wrong count', 'return int(promised) == int(after)', 'return True');
mustCatch('a failed parity read counted as a pass', 'except Exception:  # noqa: BLE001\n        return None\n    promised', 'except Exception:  # noqa: BLE001\n        return True\n    promised');
mustCatch('prose read for a field the site publishes structurally', 'af_only = structured_only(platform, {k: v for k, v in results.items() if k in AF_FIELDS}, stored, page)', 'af_only = {k: v for k, v in results.items() if k in AF_FIELDS}');
mustCatch('aqar parking no longer structured-only', '"aqar": ("elevator", "parking",', '"aqar": ("elevator",');
mustCatch('a silent structured block read as a miss', 'if says is None:\n        return PAGE_SILENT', 'if says is None:\n        return WE_MISS');
mustCatch('site navigation read as the ad', 'if x and not CHROME.match(x) and', 'if x and');

const fail = (m: string) => { console.error(m); process.exit(1); };
const wf = '.github/workflows/af-score.yml';
if (!existsSync(wf)) fail('af-score.yml missing');
const w = readFileSync(wf, 'utf8');
if (/^\s*(schedule|push|pull_request):/m.test(w) || !w.includes('workflow_dispatch')) fail('af-score.yml must be dispatch-only');
if (!w.includes('scrapers.common.af_score') || !w.includes('WASALT_BROWSER')) fail('af-score.yml must run af_score with the browser');
const mig = readdirSync('supabase/migrations').filter((f) => /ops_af_score/.test(f));
const sql = mig.map((f) => readFileSync('supabase/migrations/' + f, 'utf8')).join('\n');
if (!/create table if not exists public\.ops_af_score/.test(sql)) fail('ops_af_score migration missing');
if (!/cron\.schedule\('gh-af-score', '0 8 \* \* \*'/.test(sql)) fail('gh-af-score cron row (08:00 UTC) missing');
// The night-2 net: the hourly robot customer (scrapers/common/af_robot.py; its mutation proof — a broken
// slug mapping must be reported as a miss — is scrapers/common/tests/test_af_robot.py).
const rwf = '.github/workflows/af-robot.yml';
if (!existsSync(rwf)) fail('af-robot.yml missing');
const rw = readFileSync(rwf, 'utf8');
if (/^\s*(schedule|push|pull_request):/m.test(rw) || !rw.includes('workflow_dispatch')) fail('af-robot.yml must be dispatch-only');
if (!rw.includes('scrapers.common.af_robot') || !rw.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY')) fail('af-robot.yml must run af_robot with the anon key');
const rsql = readdirSync('supabase/migrations').filter((f) => /af_robot/.test(f)).map((f) => readFileSync('supabase/migrations/' + f, 'utf8')).join('\n');
if (!/cron\.schedule\('gh-af-robot', '41 \* \* \* \*'/.test(rsql)) fail('gh-af-robot hourly cron row (:41) missing');
if (!existsSync('scrapers/common/tests/test_af_robot.py')) fail('the robot lost its mutation proof');
console.log('verify-af-score-measures-the-customer-path: ok');
