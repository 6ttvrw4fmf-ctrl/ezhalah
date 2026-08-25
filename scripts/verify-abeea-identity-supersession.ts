// ABEEA IDENTITY SUPERSESSION — the regression barrier for a duplicate that could never age out.
//
// THE CASE (2026-08-25): abeea edits a live post's «Property ID» in place (ABREA166 → ABRE166,
// ABRE3334 → ABRE334). Ezhalah keys identity on Property ID, so the next crawl INSERTS a second
// row while the old row keeps the same listing_url. The old row is then never seen again, so
// prune_unseen() strikes it 3× and calls the platform's verify_gone oracle — which resolved the
// URL BY ad_number, fetched the shared page, saw HTTP 200 and a non-Sold status, and answered
// 'live'. prune's 'live' branch SELF-HEALS (missing_count = 0, last_seen_at = now()), so the
// retired identity was resurrected on every cycle and BOTH rows stayed production_ready forever.
//
// Measured before the fix: row 659716 (ABREA166) resurrected that way from 2026-06-23 to
// 2026-08-25 — two user-reachable cards for one property — and 7673907 (ABRE3334) likewise.
// Source truth the same day: abeea's complete catalogue is 247 posts / 243 distinct Property IDs;
// ABREA166 and ABRE3334 appear in NONE of them, ABRE166 and ABRE334 in exactly one each.
//
// THE INVARIANT THIS PINS:
//   same live canonical source URL + changed source Property ID → only ONE user-reachable card.
//
// It is a pure-function test (no network, no DB) over scrapers/abeea/run.py::_liveness_verdict,
// and it MUTATION-PROVES the identity clause: with that clause removed, the exact production case
// must go back to answering 'live'. A test that only asserts the fixed behaviour would still pass
// if someone deleted the clause and the bug returned some other way.
import { execFileSync } from 'node:child_process';

const PY = `
import importlib.util, sys, json, re
spec = importlib.util.spec_from_file_location("abeea_run", "scrapers/abeea/run.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
v = m._liveness_verdict

cases = [
  # name, http, body_len, page_property_id, page_status, probed_ad_number, expected
  ["identity changed at the same live URL (ABREA166 -> ABRE166)", 200, 5000, "ABRE166",  "For Rent", "ABREA166",   "gone"],
  ["identity changed at the same live URL (ABRE3334 -> ABRE334)", 200, 5000, "ABRE334",  "For Rent", "ABRE3334",   "gone"],
  ["identity matches and the post is live",                       200, 5000, "ABRE166",  "For Rent", "ABRE166",    "live"],
  ["identity matches and the source says Rented",                 200, 5000, "ABRE166",  "Rented",   "ABRE166",    "gone"],
  ["identity matches and the source says Sold",                   200, 5000, "ABRE300",  "Sold",     "ABRE300",    "gone"],
  ["page publishes no Property ID (md5-slug ad), live",           200, 5000, None,       "For Rent", "ABdeadbeef", "live"],
  ["page publishes no Property ID, status unreadable",            200, 5000, None,       None,       "ABdeadbeef", "unknown"],
  ["identity matches, status unreadable -> never guessed",        200, 5000, "ABRE166",  None,       "ABRE166",    "unknown"],
  ["post deleted outright",                                       404, 0,    None,       None,       "ABRE166",    "gone"],
  ["blocked / truncated body is never proof of death",            403, 10,   None,       None,       "ABRE166",    "retry"],
  ["Property ID punctuation and case are normalised",             200, 5000, "abre-166", "For Rent", "ABRE166",    "live"],
  ["bare numeric Property ID gets the AB prefix",                 200, 5000, "166",      "For Rent", "AB166",      "live"],
]
out = []
for name, st, ln, pid, status, ad, want in cases:
    got = v(st, ln, pid, status, ad)
    out.append({"name": name, "got": got, "want": want, "ok": got == want})

# MUTATION: delete the identity clause and re-run the two production cases. Without it they must
# read 'live' again — i.e. the bug returns — which is what proves the clause is load-bearing.
src = open("scripts/../scrapers/abeea/run.py", encoding="utf-8").read()
start = src.index("def _liveness_verdict(")
end = src.index("def _pin_sold_inactive(")
body = src[start:end]
mutated = body.replace(
    'if _ad_number_from_pid(page_pid).upper() != (probed_ad or "").upper():\\n            return "gone"',
    'pass')
if mutated == body:
    print(json.dumps({"error": "MUTATION ANCHOR NOT FOUND — the identity clause was reshaped; update this barrier deliberately"}))
    sys.exit(3)
ns = {"re": re, "Optional": None, "GONE_STATUS": m.GONE_STATUS,
      "_ad_number_from_pid": m._ad_number_from_pid}
exec(compile(mutated.replace("page_pid: Optional[str]", "page_pid").replace("status_text: Optional[str]", "status_text"), "<mut>", "exec"), ns)
mv = ns["_liveness_verdict"]
mut = [
  {"name": "ABREA166 with the identity clause removed", "got": mv(200, 5000, "ABRE166", "For Rent", "ABREA166")},
  {"name": "ABRE3334 with the identity clause removed", "got": mv(200, 5000, "ABRE334", "For Rent", "ABRE3334")},
]
print(json.dumps({"cases": out, "mutation": mut}))
`;

const raw = execFileSync('python3', ['-c', PY], { encoding: 'utf8', cwd: process.cwd() });
const res = JSON.parse(raw.trim().split('\n').pop()!);
if (res.error) { console.error(`✗ ${res.error}`); process.exit(1); }

let bad = 0;
for (const c of res.cases) {
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} → ${c.got}${c.ok ? '' : ` (expected ${c.want})`}`);
  if (!c.ok) bad++;
}
// The mutant MUST reproduce the production bug, or this barrier is not actually testing the clause.
for (const mtn of res.mutation) {
  const reproduced = mtn.got === 'live';
  console.log(`  ${reproduced ? 'PASS' : 'FAIL'}  mutation: ${mtn.name} → ${mtn.got}` +
    `${reproduced ? " (bug reproduced, so the clause is load-bearing)" : " (expected 'live' — the clause is NOT what fixes this)"}`);
  if (!reproduced) bad++;
}

if (bad) { console.error(`\n✗ abeea identity supersession: ${bad} failure(s)`); process.exit(1); }
console.log('\n✓ same live URL + changed source Property ID → exactly one user-reachable card ' +
            '(identity clause mutation-proven load-bearing)');
