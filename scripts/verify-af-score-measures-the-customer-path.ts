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
console.log('verify-af-score-measures-the-customer-path: ok');
