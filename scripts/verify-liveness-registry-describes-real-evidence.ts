// THE LIVENESS REGISTRY MUST NOT MISDESCRIBE ITS OWN EVIDENCE.
//
// WHAT THIS IS FOR
// ----------------
// `scrapers/common/liveness_policies.py` is where every production-searchable platform declares
// what may kill one of its listings. It is read by monitoring, by the staleness SLA, and by every
// human who asks "how do we know this row is dead?". Its `death_signals` string is therefore a
// factual claim, not documentation.
//
// It went false silently, and that is the defect this file exists to make impossible. Ten platforms
// gained a `prune_unseen(verify_gone=…)` oracle between 2026-09-05 and 2026-09-06, and every one of
// them kept the shared registry string "none (absence from the crawl only)" — which by then
// described none of them. Nothing went red. A registry that misdescribes its own evidence is the
// same failure shape as a dark detector reading as a clean bill of health (AGENTS.md): the fact is
// wrong in the SAFE-LOOKING direction, so no alarm can be built on it.
//
// THE RULE, in one line:
//
//     a platform whose scraper passes verify_gone to prune_unseen may not claim, in the registry,
//     that absence from the crawl is its only death signal.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK. It says nothing about the TIER. Keeping an oracle-guarded
// platform at CRAWL_PRESENCE_ONLY is the honest reading and the established convention here (see
// the aqargate note in the registry): the tier and its SLA measure whether the POPULATION carries
// recent affirmative verification, and an at-grace oracle that never stamps last_verified_alive_at
// does not give it that. Promoting the tier would answer a real gap with a label change, which
// LISTING_LIVENESS.md §7 forbids. So this barrier pins the EVIDENCE STRING and leaves the tier
// alone — pinning the tier instead would push future sessions toward exactly the wrong repair.
//
// WHY EXECUTED, NOT GREPPED. AGENTS.md: every one of the five defects of 2026-09-04 had a barrier
// over the exact line, and every one of those barriers was a source-TEXT tripwire. So this imports
// the real registry and reads it as data, and it reads each scraper's prune wiring from its SYNTAX
// TREE — a docstring that mentions `verify_gone` is not a call site, and `_verify_gone` defined but
// never passed is not wiring.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + (ok || !detail ? '' : ' — ' + detail));
  if (!ok) failed++;
};

console.log('verify-liveness-registry-describes-real-evidence: the registry, executed as data.');

const HARNESS = String.raw`
import ast, json, os, sys
sys.path.insert(0, os.getcwd())
from scrapers.common import liveness_policies as LP

MUT = json.loads(os.environ["MUTATE"]) if os.environ.get("MUTATE") else None

# Does this platform's scraper actually HAND prune_unseen an oracle? From the syntax tree: a
# docstring naming verify_gone is not a call site, and a _verify_gone that is defined but never
# passed is not wiring.
def wiring(platform):
    path = os.path.join("scrapers", platform, "run.py")
    if not os.path.exists(path):
        return None
    tree = ast.parse(open(path, encoding="utf-8").read())
    sites = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
           and node.func.attr == "prune_unseen":
            sites.append("verify_gone" in {k.arg for k in node.keywords if k.arg})
    return {"sites": len(sites), "all_wired": bool(sites) and all(sites), "any_wired": any(sites)}

rows = {}
for platform, row in LP.POLICIES.items():
    w = wiring(platform)
    death = row["death_signals"]
    if MUT and MUT[0] == platform:
        death = MUT[1]
    rows[platform] = {
        "death_signals": death,
        "strategy": row["strategy"],
        "has_oracle": bool(w and w["any_wired"]),
        "all_prune_sites_wired": bool(w and w["all_wired"]),
        "prune_sites": (w or {}).get("sites", 0),
        "scraper_exists": w is not None,
    }
print(json.dumps(rows))
`;

type Row = {
  death_signals: string; strategy: string; has_oracle: boolean;
  all_prune_sites_wired: boolean; prune_sites: number; scraper_exists: boolean;
};

const run = (mutate?: [string, string]): Record<string, Row> => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Record<string, Row>;
};

// The exact claim that may not survive an oracle. Matched on meaning, not on the literal string:
// "absence only" is the assertion, however it is phrased.
const CLAIMS_ABSENCE_ONLY = (s: string): boolean => {
  const t = s.trim().toLowerCase();
  if (t === 'none' || t === '') return true;
  return t.startsWith('none (') || t.startsWith('none —') || t.startsWith('none -');
};

// The judgement, as a set of independent facts that hold. A mutation must SHRINK this.
const holds = (rows: Record<string, Row>): string[] => {
  const h: string[] = [];
  for (const [p, r] of Object.entries(rows)) {
    if (r.has_oracle && !CLAIMS_ABSENCE_ONLY(r.death_signals)) h.push(`${p}:describes-its-oracle`);
    if (!r.has_oracle && r.death_signals.trim() !== '') h.push(`${p}:says-something`);
  }
  return h;
};

const base = run();
const platforms = Object.keys(base).sort();
check(platforms.length > 0, 'the registry loads and is not empty');

const guarded = platforms.filter((p) => base[p].has_oracle);
const unguarded = platforms.filter((p) => base[p].scraper_exists && !base[p].has_oracle);
console.log(`  ⓘ ${platforms.length} registered · ${guarded.length} pass verify_gone: [${guarded.join(', ')}]`);

check(guarded.length > 0,
  'at least one registered platform passes verify_gone (this barrier is not vacuous)',
  'if every oracle disappeared, the rule below would be trivially satisfiable');

for (const p of guarded) {
  check(!CLAIMS_ABSENCE_ONLY(base[p].death_signals),
    `${p}: hands prune_unseen an oracle, so the registry may not say absence is its only death signal`,
    `death_signals is ${JSON.stringify(base[p].death_signals)} — this platform re-fetches the ` +
    'listing\'s own URL and requires an affirmative answer before deactivating, so the registry ' +
    'is understating its own evidence to monitoring and to every human who reads it');
  check(base[p].all_prune_sites_wired,
    `${p}: EVERY prune_unseen call site carries verify_gone, not just the one that was noticed`,
    `${base[p].prune_sites} call site(s), not all wired — an unguarded second prune path beside a ` +
    'guarded one is the exact shape already recorded on gathern and dealapp');
}

for (const p of platforms) {
  check(base[p].death_signals.trim() !== '',
    `${p}: declares SOMETHING about what may kill one of its listings`,
    'an empty death_signals is a platform whose liveness question was never answered');
}

// A platform with no oracle is allowed to say "none (absence from the crawl only)" — that is the
// honest declaration of a known gap and the whole point of the ledger. Prove the rule permits it,
// so nobody later "fixes" the barrier by making every platform claim a signal it does not have.
const honestGaps = unguarded.filter((p) => CLAIMS_ABSENCE_ONLY(base[p].death_signals));
check(honestGaps.length > 0,
  'a platform WITHOUT an oracle may still honestly declare absence-only (the rule is not "claim a signal")',
  'every unguarded platform now claims a death signal — which would mean the gap was papered over ' +
  'rather than closed');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — the defect this file was written for, reintroduced and executed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const TOTAL = holds(base).length;
const mustCatch = (what: string, mutate: [string, string]) => {
  check(holds(run(mutate)).length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every assertion above still held with the defect present');
};

// The real defect, verbatim: an oracle-guarded platform left carrying the shared gap string.
for (const p of guarded) {
  mustCatch(`${p} left claiming absence is its only death signal`,
    [p, 'none (absence from the crawl only)']);
}
// …and the phrasings a future edit might reach for instead of that exact string.
mustCatch('an oracle-guarded platform claiming a bare "none"', [guarded[0], 'none']);
mustCatch('an oracle-guarded platform declaring nothing at all', [guarded[0], '   ']);

// CONTROL — the judgement is not always-red. A platform describing its real oracle must survive.
const control = holds(run([guarded[0], 'a DIRECT re-fetch of the listing own URL answering 404/410']));
check(control.length === TOTAL, '(control) a truthful death_signals string is accepted',
  'the rule fires on a correct description too, so it is not measuring what it claims to measure');

console.log(failed === 0
  ? '\n✅ verify-liveness-registry-describes-real-evidence: every registered platform describes the evidence it actually has.'
  : '\n❌ verify-liveness-registry-describes-real-evidence: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
