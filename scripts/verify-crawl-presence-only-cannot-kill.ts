// ABSENCE FROM OUR CRAWL IS NOT A DEATH CERTIFICATE — AND 24 SCRAPERS STILL TREAT IT AS ONE.
//
// THE INCIDENT (measured, 2026-09-21 04:54 UTC). 94 `muktamel_residential_listings` rows were set
// `active = false` with `missing_count = 3` and **no source verdict recorded for a single one of
// them**: `mon_detect_unknown_treated_as_dead` raised P1 alert 4344 at 04:59 with
// `without_direct_evidence: 94`, `oracle_said_unknown: 0`. Root cause was not the crawl and not the
// weekly→daily cadence change (#3429) — that only made the third strike arrive in three days instead
// of three weeks. `fetch_one()` returns None for SEVEN reasons and `db.prune_unseen` could see one:
// "not in rows_seen". Per shard, that run logged ~85-90 reads that told us nothing about the listing
// (`http_500` 51-58, `network_Timeout` 29, `no_html_after_retries` 3-5) beside 84-98 real removals,
// all six shapes equal, all ageing toward the 30-day deletion window.
//
// `docs/ops/LISTING_LIVENESS.md` §1-§3 is the rule: liveness is THREE-valued, absence is
// `EvidenceKind.ABSENCE` — a candidate signal and NEVER a verdict — and only a DIRECT fetch of the
// listing's own URL may kill. `db.prune_unseen(verify_gone=...)` is the seam where a scraper honours
// it, and `scrapers/common/http_liveness.py` is the law a platform's signal cannot relax.
//
// WHAT THIS GUARD ADDS THAT NOTHING ELSE HAD. `liveness_policies.py` already says in prose that
// `CRAWL_PRESENCE_ONLY` "CANNOT satisfy the owner rule and is recorded as a known gap" — but nothing
// executed that sentence, so a platform sitting in that tier while calling a killing pruner was
// invisible. The PART 1.11 shape (`docs/ops/BARRIER_ENGINEER.md`): a declaration read as coverage.
// Measured here on the day it was first executed: **25 call sites across 24 platforms**, one of them
// a declared DIRECT_REVISIT platform — so the defect was never confined to the honest tier, and a
// guard keyed on the tier label alone would have missed it.
//
// STRUCTURE, NOT TEXT. The defect is an ABSENT keyword argument, so the subject is the argument list
// of the call the interpreter will really make. This reads each `run.py` with Python's own `ast` and
// asks whether that call site is passed `verify_gone=`. A grep gets this wrong in BOTH directions and
// did: `arkaan`, `sadin` and `alta` all mention `verify_gone` in prose beside a call that is not
// passed one, and a `**kwargs` spread would hide an oracle from any text scan (refused outright
// below, because a call site whose keywords cannot be read cannot be certified either way).
//
// WHY A SHRINK-ONLY FLOOR AND NOT A BAN. Giving a platform a real oracle requires its removal signal
// MEASURED against the live source with interleaved known-alive controls — that is the platform
// owner's work, and an unmeasured signal is precisely the "never guess" violation this repo keeps
// paying for. A guard that went red on 24 shipped scrapers would be deleted by the first person it
// blocked. So the known debt is frozen in `scripts/absence-kill-baseline.txt`, a NEW entrant is RED,
// and a FIXED entry left in the file is RED as stale so the ratchet can never read better than
// reality. The list falling is the intended direction and never a failure.
//
// Run: node --experimental-strip-types scripts/verify-crawl-presence-only-cannot-kill.ts  (npm test)

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

type Site = { platform: string; strategy: string; ordinal: number; line: number; oracle: boolean; opaque: boolean };
type Problem = { key: string; why: string };

// ── The subject: every prune_unseen call site in every REGISTERED platform's scraper ─────────────
// The registry is read from `sql/mirrors/liveness_registry.json`, the offline mirror that
// `scripts/verify-liveness-registry-mirror.ts` already pins byte-consistent with the SQL and with
// `liveness_policies.py`. A platform with no entry cannot be production-searchable, so the mirror is
// the complete population by construction.
const AST_PROBE = `
import ast, json, pathlib, sys
reg = json.load(open('sql/mirrors/liveness_registry.json'))
out = []
for row in sorted(reg, key=lambda r: r['platform']):
    plat, strat = row['platform'], row['strategy']
    rp = pathlib.Path('scrapers') / plat / 'run.py'
    if not rp.exists():
        continue
    try:
        tree = ast.parse(rp.read_text())
    except SyntaxError as e:
        out.append({'platform': plat, 'strategy': strat, 'ordinal': -1, 'line': e.lineno or 0,
                    'oracle': False, 'opaque': True})
        continue
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and (getattr(n.func, 'attr', None) == 'prune_unseen'
                  or getattr(n.func, 'id', None) == 'prune_unseen')]
    calls.sort(key=lambda n: n.lineno)
    for i, c in enumerate(calls):
        kw = [k.arg for k in c.keywords]
        out.append({'platform': plat, 'strategy': strat, 'ordinal': i, 'line': c.lineno,
                    'oracle': 'verify_gone' in kw, 'opaque': None in kw})
json.dump(out, sys.stdout)
`;

function scanSites(): Site[] {
  // Fails CLOSED: no python3, an unreadable registry or a scraper that will not parse is a RED, never
  // a quiet "nothing to report". An unreadable subject reads as MISSING (AGENTS.md: a failed fetch is
  // not an empty answer — the same rule, one layer down).
  const raw = execFileSync('python3', ['-c', AST_PROBE], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(raw) as Site[];
}

export function siteKey(s: Pick<Site, 'platform' | 'strategy' | 'ordinal'>): string {
  return `${s.platform}|${s.strategy}|${s.ordinal}`;
}

// ── The predicate, pure and total ────────────────────────────────────────────────────────────────
export function absenceKillProblems(sites: Site[], baseline: Set<string>, ceiling: number): Problem[] {
  const out: Problem[] = [];

  if (sites.length === 0) {
    out.push({ key: '(scan)', why: 'no prune_unseen call site was found at all — the subject could not be read, which is never the same as "nothing can kill on absence"' });
    return out;
  }
  if (baseline.size > ceiling) {
    out.push({ key: '(baseline)', why: `the floor has ${baseline.size} entries against a CEILING of ${ceiling}: debt was ADDED instead of a call site being fixed` });
  }

  const killers = new Set<string>();
  for (const s of sites) {
    const key = siteKey(s);
    if (s.opaque) {
      out.push({ key, why: `run.py line ${s.line}: the call spreads **kwargs, so whether an oracle reaches prune_unseen cannot be read from the call site — neither certifiable nor deniable` });
      continue;
    }
    if (s.oracle) continue;
    killers.add(key);
    if (!baseline.has(key)) {
      out.push({ key, why: `run.py line ${s.line}: prune_unseen can deactivate on absence alone (${s.strategy}) and this call site is NOT in the declared floor. Give it a verify_gone= oracle measured against the live source — never add it here` });
    }
  }

  for (const declared of baseline) {
    if (!killers.has(declared)) {
      out.push({ key: declared, why: 'STALE floor entry: this call site no longer kills on absence, so the ratchet is reading worse than reality — remove the line and lower CEILING' });
    }
  }
  return out;
}

export function parseBaseline(text: string): { baseline: Set<string>; ceiling: number } {
  const baseline = new Set<string>();
  let ceiling = -1;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('CEILING=')) { ceiling = Number(line.slice('CEILING='.length)); continue; }
    baseline.add(line);
  }
  return { baseline, ceiling };
}

// ── Execute against the tree as it really ships ──────────────────────────────────────────────────
const BASELINE_FILE = join(ROOT, 'scripts', 'absence-kill-baseline.txt');
let failed = 0;

if (!existsSync(BASELINE_FILE)) {
  console.error(`❌ ${BASELINE_FILE} is missing — the floor cannot be checked, so nothing can be certified.`);
  process.exit(1);
}
const { baseline, ceiling } = parseBaseline(readFileSync(BASELINE_FILE, 'utf8'));
if (!Number.isInteger(ceiling) || ceiling < 0) {
  console.error('❌ absence-kill-baseline.txt declares no valid CEILING= — the ratchet has no stop.');
  process.exit(1);
}

const sites = scanSites();
const problems = absenceKillProblems(sites, baseline, ceiling);
const killing = sites.filter(s => !s.oracle && !s.opaque).length;
const oracled = sites.filter(s => s.oracle).length;

console.log(`prune_unseen call sites: ${sites.length} across ${new Set(sites.map(s => s.platform)).size} registered platforms`);
console.log(`  with a source oracle (verify_gone=): ${oracled}`);
console.log(`  able to kill on absence alone:       ${killing}  (declared floor ${baseline.size}, ceiling ${ceiling})`);

for (const p of problems) {
  failed++;
  console.error(`❌ ${p.key}: ${p.why}`);
}

// ── MUTATION PROOFS: a guard that cannot fail is decoration ──────────────────────────────────────
let mutFail = 0;
function mustCatch(what: string, caught: boolean): void {
  if (caught) { console.log(`  ✓ catches ${what}`); return; }
  mutFail++;
  console.error(`  ✗ does NOT catch ${what}`);
}
const site = (o: Partial<Site> = {}): Site =>
  ({ platform: 'muktamel', strategy: 'CRAWL_PRESENCE_ONLY', ordinal: 0, line: 700, oracle: true, opaque: false, ...o });

mustCatch('THE REAL DEFECT — muktamel pruning with no oracle again, exactly as it shipped on 2026-09-21',
  absenceKillProblems([site({ oracle: false })], new Set(), 0).length > 0);

mustCatch('a NEW platform joining the killers without being declared',
  absenceKillProblems([site({ platform: 'brandnew', oracle: false })], baseline, ceiling).length > 0);

mustCatch('a STALE floor entry — the ratchet reading better than reality after a fix',
  absenceKillProblems([site({ platform: 'abwbna', oracle: true })],
    new Set(['abwbna|CRAWL_PRESENCE_ONLY|0']), 1).length > 0);

mustCatch('the floor being GROWN past its ceiling instead of a call site being fixed',
  absenceKillProblems([site({ oracle: false })], new Set(['a|X|0', 'b|X|0']), 1).length > 0);

mustCatch('a call site whose keywords are hidden behind **kwargs (uncertifiable, so refused)',
  absenceKillProblems([site({ opaque: true, oracle: false })], new Set([siteKey(site())]), 1).length > 0);

mustCatch('an EMPTY scan — an unreadable subject is MISSING, never "nothing can kill on absence"',
  absenceKillProblems([], baseline, ceiling).length > 0);

mustCatch('a DIRECT_REVISIT platform hiding behind its tier label (the gathern shape)',
  absenceKillProblems([site({ platform: 'newdirect', strategy: 'DIRECT_REVISIT', oracle: false })],
    baseline, ceiling).length > 0);

// NEGATIVE CONTROLS — a check red for everything protects nothing.
mustCatch('…while the tree as it actually ships is NOT flagged (the predicate is not vacuously red)',
  problems.length === 0);

mustCatch('…and a SHRINKING floor is not a failure — the direction this ratchet exists to encourage',
  absenceKillProblems([site({ oracle: true })], new Set(), 0).length === 0);

mustCatch('…and an oracled call site is accepted whatever its declared tier',
  absenceKillProblems([site({ strategy: 'CRAWL_PRESENCE_ONLY', oracle: true }),
    site({ platform: 'aqar', strategy: 'DIRECT_REVISIT', oracle: true })], new Set(), 0).length === 0);

if (failed || mutFail) {
  if (failed) console.error(`\n❌ ${failed} problem(s) — a listing can be deactivated without the source ever being asked.`);
  if (mutFail) console.error(`❌ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defect it exists for.`);
  process.exit(1);
}
console.log(`\n✅ every absence-only kill path is inside the declared shrink-only floor (${killing}/${ceiling}), and the guard is proven to fail without it.`);
