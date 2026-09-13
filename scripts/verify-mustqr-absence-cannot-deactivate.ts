// Barrier: MUSTQR MAY NOT DEACTIVATE A LISTING ON CRAWL ABSENCE.
//
// THE DEFECT, measured on production 2026-09-12. `scrapers/mustqr/run.py` called
// `db.prune_unseen()` with NO oracle, so three consecutive crawl misses deactivated a listing on
// ABSENCE alone — `EvidenceKind.ABSENCE` deciding a listing's fate, which LISTING_LIVENESS.md §1–§3
// forbids. It carried a standing P1 `unknown_treated_as_dead` (alert_event 1488 since 2026-09-05,
// 2054 since 2026-09-09), affirmed daily and never acknowledged:
//
//     238 mustqr rows inactive, ALL at missing_count = 3
//     0 of the platform's 1,464 rows have EVER had last_verified_alive_at set
//
// The absence has an innocent explanation, which is exactly why it must not be a verdict:
// `fetch_all()` ingests with `status=eq.متاح`, so a listing whose status merely CHANGES vanishes
// from the crawl and looks identical to a timeout, a 403, a parser failure, or a crawl that did not
// run at all.
//
// WHY A SOURCE-TEXT TRIPWIRE IS NOT ENOUGH HERE. AGENTS.md: every one of the five defects of
// 2026-09-04 had a barrier over the exact line, and every one of those barriers was a source-TEXT
// tripwire that passed for the whole time the defect was live. So this barrier EXECUTES the real
// decision function lifted out of the module, against injected responses, and asserts the verdict.
//
// WHAT IT PROVES, by execution:
//   1. every UNKNOWN shape — timeout, 401/402/403/407/408/429, every 5xx, an unreadable body, a
//      missing status, an id mismatch — yields 'unknown', NEVER 'gone';
//   2. only an affirmative negative on THIS id yields 'gone';
//   3. the in-run canary gate fails CLOSED: with no canary, or a canary that does not read back
//      available, no 'gone' verdict may be issued at all;
//   4. the prune is actually WIRED to the oracle (an oracle nothing calls is decoration).
//
//   node --experimental-strip-types scripts/verify-mustqr-absence-cannot-deactivate.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const RUN_PY = join(root, 'scrapers', 'mustqr', 'run.py');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}
function mustCatch(label: string, caught: boolean): void {
  if (caught) console.log(`  ✓ mutation caught: ${label}`);
  else {
    console.error(`  ✗ MUTATION SURVIVED: ${label}`);
    failures++;
  }
}

// ─── §1 The decision function, EXECUTED against injected responses ──────────────────────────────
//
// `_gone_verdict(status, rows, pid)` is pure, so it can be driven directly. The harness imports the
// real module with its network transport stubbed out, so nothing here reaches mustqr.

const HARNESS = String.raw`
import json, sys, types
sys.path.insert(0, ${JSON.stringify(root)})
for name in ("curl_cffi", "curl_cffi.requests", "supabase", "dotenv", "bs4"):
    if name not in sys.modules:
        m = types.ModuleType(name); m.__path__ = []
        sys.modules[name] = m
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None
sys.modules["curl_cffi"].requests = sys.modules["curl_cffi.requests"]
sys.modules["curl_cffi.requests"].Session = object
sys.modules["bs4"].BeautifulSoup = object

from scrapers.mustqr import run as M

out = {}

# --- §1 every UNKNOWN shape must NOT be 'gone' -------------------------------------------------
AVAILABLE = [{"id": "4726", "status": "متاح"}]
unknown_shapes = {
    "timeout/network":        (None, None),
    "401":                    (401, None),
    "402":                    (402, None),
    "403":                    (403, None),
    "407":                    (407, None),
    "408":                    (408, None),
    "429":                    (429, None),
    "500":                    (500, None),
    "502":                    (502, None),
    "503":                    (503, None),
    "504":                    (504, None),
    "200 unreadable body":    (200, None),
    "200 missing status":     (200, [{"id": "4726", "status": ""}]),
    "200 id mismatch":        (200, [{"id": "9999", "status": "مباع"}]),
}
res = {}
for label, (st, rows) in unknown_shapes.items():
    v = M._gone_verdict(st, rows, "4726")
    # None means "retry, then unknown" — the caller turns it into 'unknown'. Never 'gone'.
    res[label] = "RETRY_THEN_UNKNOWN" if v is None else v[0]
out["unknown_shapes"] = res

# --- §2 the affirmative cases -------------------------------------------------------------------
out["live"] = M._gone_verdict(200, AVAILABLE, "4726")[0]
out["gone_absent_row"] = M._gone_verdict(200, [], "4726")[0]
out["gone_other_status"] = M._gone_verdict(200, [{"id": "4726", "status": "مباع"}], "4726")[0]
out["non_numeric_pid"] = M._gone_verdict(200, [], "abc")[0]

# --- §3 the canary gate, driven through the REAL _verify_gone ------------------------------------
# Stub the transport so every probe answers "this id is sold" (a genuine 'gone'), then vary only
# whether a canary exists / reads back available.
def _stub(answers):
    def f(pid):
        return answers.get(str(pid), (200, [{"id": str(pid), "status": "مباع"}]))
    return f

# (a) no canary supplied at all -> no removal may be believed
M.set_liveness_oracle(object(), "jwt", [])
M._oracle_fetch = _stub({})
out["gone_with_no_canary"] = M._verify_gone("MQ4726")[0]

# (b) canary supplied but it does NOT read back available (source serving us nothing real)
M.set_liveness_oracle(object(), "jwt", ["1111"])
M._oracle_fetch = _stub({"1111": (403, None)})
out["gone_with_blocked_canary"] = M._verify_gone("MQ4726")[0]

# (c) canary reads back available -> a genuine 'gone' is allowed through
M.set_liveness_oracle(object(), "jwt", ["1111"])
M._oracle_fetch = _stub({"1111": (200, [{"id": "1111", "status": "متاح"}])})
out["gone_with_good_canary"] = M._verify_gone("MQ4726")[0]

# (d) a live row stays live even with no canary (restorative reads are never gated)
M.set_liveness_oracle(object(), "jwt", [])
M._oracle_fetch = _stub({"4726": (200, AVAILABLE)})
out["live_needs_no_canary"] = M._verify_gone("MQ4726")[0]

# (e) a run where the source is entirely blocked must kill nothing
M.set_liveness_oracle(object(), "jwt", ["1111"])
M._oracle_fetch = _stub({"1111": (403, None), "4726": (403, None)})
out["blocked_run"] = M._verify_gone("MQ4726")[0]

print(json.dumps(out, ensure_ascii=False))
`;

let out: any;
try {
  const raw = execFileSync('python3', ['-c', HARNESS], { encoding: 'utf8', timeout: 120_000 });
  out = JSON.parse(raw.trim().split('\n').pop()!);
} catch (e: any) {
  console.error('✗ could not execute the mustqr oracle decision function:');
  console.error((e.stderr || e.message || String(e)).toString().slice(0, 2000));
  process.exit(1);
}

console.log('§1 every UNKNOWN shape is withheld from the removal path (executed):');
for (const [label, verdict] of Object.entries<string>(out.unknown_shapes)) {
  check(
    `${label} → ${verdict} (not 'gone')`,
    verdict !== 'gone',
    `a ${label} reading produced '${verdict}'`,
  );
}

console.log('\n§2 only an affirmative negative on THIS id is a removal (executed):');
check("status «متاح» → 'live'", out.live === 'live', `got '${out.live}'`);
check(
  "the id no longer exists in the source table → 'gone'",
  out.gone_absent_row === 'gone',
  `got '${out.gone_absent_row}'`,
);
check(
  "a readable non-available status → 'gone'",
  out.gone_other_status === 'gone',
  `got '${out.gone_other_status}'`,
);
check(
  "an ad_number carrying no property id → 'unknown'",
  out.non_numeric_pid === 'unknown',
  `got '${out.non_numeric_pid}'`,
);

console.log('\n§3 the in-run canary gate fails CLOSED (executed through the real _verify_gone):');
mustCatch(
  'a genuine gone with NO canary is withheld (removed_no_canary)',
  out.gone_with_no_canary === 'unknown',
);
mustCatch(
  'a genuine gone while the canary is BLOCKED is withheld (removed_canary_403)',
  out.gone_with_blocked_canary === 'unknown',
);
mustCatch(
  'an entirely blocked run deactivates nothing (removed_blocked_run)',
  out.blocked_run === 'unknown',
);
check(
  "a genuine gone WITH a healthy canary is allowed through → 'gone'",
  out.gone_with_good_canary === 'gone',
  `got '${out.gone_with_good_canary}' — the oracle can never retire anything`,
);
check(
  "a live reading needs no canary (a restorative read is never gated) → 'live'",
  out.live_needs_no_canary === 'live',
  `got '${out.live_needs_no_canary}'`,
);

// ─── §4 the oracle is actually WIRED — an oracle nothing calls is decoration ────────────────────

console.log('\n§4 the prune is wired to the oracle:');
const src = readFileSync(RUN_PY, 'utf8');
check(
  'db.prune_unseen(...) is called with verify_gone=_verify_gone',
  /prune_unseen\([\s\S]{0,300}?verify_gone\s*=\s*_verify_gone/.test(src),
  'the oracle exists but the prune does not use it',
);
check(
  'the canary pool is armed from rows THIS run fetched, not from last_verified_alive_at',
  /set_liveness_oracle\(\s*s\s*,\s*jwt\s*,[\s\S]{0,160}?res\s*\+\s*com/.test(src) &&
    !/set_liveness_oracle\([\s\S]{0,300}?last_verified_alive_at/.test(src),
  'a self-referential canary pool is the gathern deadlock of ops_incident #168',
);

// ─── §5 the re-adjudication path REPORTS and never writes ──────────────────────────────────────
//
// The 238 rows mustqr retired on absence alone are honestly UNKNOWN, and DELETION_SAFETY.md §1
// forbids reading an inconclusive verdict as permission in EITHER direction — restoration included.
// `recheck_deactivated()` therefore turns UNKNOWN into a MEASURED verdict and stops: a mode that
// quietly reactivated what it found live would be making the same kind of unearned write, in the
// friendlier direction, that this whole file exists to prevent.

console.log('\n§5 recheck_deactivated() measures and reports, writing nothing:');

/**
 * The function's own body with PROSE REMOVED, so a mutation can be applied to it and not to the
 * rest of the file — and so the docstring, which necessarily *names* the things this path must not
 * do, is not read as the path doing them. (AGENTS.md records the inverse failure: a scan that reads
 * prose takes the explanation for the defect.)
 */
function recheckBody(source: string): string {
  const start = source.indexOf('def recheck_deactivated(');
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\ndef ');
  const body = end < 0 ? rest : rest.slice(0, end);
  return body
    .replace(/"""[\s\S]*?"""/g, '')          // docstrings
    .replace(/'''[\s\S]*?'''/g, '')
    .replace(/(^|\s)#.*$/gm, '$1');          // line comments
}

/** One problem string per broken guarantee, so a mutation is proven to break exactly one. */
function recheckProblems(source: string): string[] {
  const body = recheckBody(source);
  if (!body) return ['recheck_deactivated() is missing — the P1 alert 1488 has no entrypoint again'];
  const bad: string[] = [];
  if (!/_verify_gone\(/.test(body))
    bad.push('it does not call _verify_gone — a second copy of the decision is a second chance to get it wrong');
  for (const verb of ['update', 'insert', 'upsert', 'delete']) {
    if (new RegExp(`\\.${verb}\\(`).test(body)) bad.push(`it WRITES (.${verb}(…)) — this path must only report`);
  }
  if (/last_verified_alive_at/.test(body))
    bad.push('it touches last_verified_alive_at — only liveness_contract may write that column');
  if (!/data is None/.test(body) || /data or \[\]/.test(body))
    bad.push('a failed read is not distinguished from an empty cohort (AGENTS.md: a failed fetch is not an empty answer)');
  return bad;
}

const recheckReal = recheckProblems(src);
for (const p of recheckReal) check(p, false);
check('recheck_deactivated() reuses the real oracle and performs no writes', recheckReal.length === 0);

const recheckMutation = (label: string, mutate: (s: string) => string) => {
  const broken = mutate(src);
  mustCatch(label, broken !== src && recheckProblems(broken).length > recheckReal.length);
};
recheckMutation('the report re-implementing the verdict instead of calling _verify_gone',
  (s) => s.replace(/verdict, reason = _verify_gone\(row\["ad_number"\]\)/,
                   'verdict, reason = ("gone", "assumed")'));
recheckMutation('the report quietly REACTIVATING what it finds live',
  (s) => s.replace(/restore_candidates\.append\(/,
                   'client.table(row["table"]).update({"active": True}).eq("id", row["id"]).execute() or restore_candidates.append('));
recheckMutation('the report stamping a verification it did not earn',
  (s) => s.replace(/restore_candidates\.append\(/,
                   'client.table(row["table"]).update({"last_verified_alive_at": "now"})'
                   + '.eq("id", row["id"]).execute() or restore_candidates.append('));
recheckMutation('a failed cohort read rendered as an empty cohort',
  (s) => s.replace(/if data is None:/g, 'if False:'));
recheckMutation('the entrypoint removed again, so the standing P1 has nowhere to go',
  (s) => s.replace('def recheck_deactivated(', 'def _removed_recheck_deactivated('));

check('the recheck mode is reachable from the command line',
  /--recheck-dead/.test(src) && /args\.recheck_dead/.test(src),
  'a probe nobody can run is decoration');

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed — mustqr could deactivate on absence.`);
  process.exit(1);
}
console.log('\n✓ mustqr cannot deactivate a listing without a DIRECT, canary-backed source verdict.');
