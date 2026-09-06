// ABSENCE MAY NOT DECIDE A LISTING'S FATE — and where it still does, the gap must be COUNTED.
//
// THE CLASS THIS EXISTS TO CONTAIN
// --------------------------------
// `db.prune_unseen()` deactivates a row that missed three consecutive crawls. Called WITHOUT a
// `verify_gone` oracle, that is EvidenceKind.ABSENCE deciding a listing's fate with no affirmative
// answer from the source — which docs/ops/LISTING_LIVENESS.md §1-§3 forbids, because a throttled
// run, a partial page or a source-side index gap is indistinguishable from a removal. Downstream the
// row stops being searchable, ages into the 30-day retention window, and on an `enabled` platform is
// deleted permanently. DELETION_SAFETY.md §5 measured the end of that road: of 21,371 rows a legacy
// age-and-strike deleter removed, 10,617 left no source key at all and are permanently unknowable.
//
// On 2026-09-06, 31 production-searchable platforms were in this state and nothing counted them.
// aqargate was fixed that day (scrapers/aqargate/run.py::_verify_gone); the other 30 are real, and
// the danger is not that they exist — it is that they were INVISIBLE, and that a NEW platform could
// join them by writing one more `prune_unseen(...)` call nobody would ever notice.
//
// WHAT THIS BARRIER DOES. It is a ratcheting ledger, the same shape scripts/test-baseline.txt uses:
//   1. a production-searchable platform pruning without an oracle and NOT in the ledger is RED —
//      a new platform cannot silently join;
//   2. a ledger entry whose platform has SINCE gained an oracle is RED — the ledger is forced to
//      shrink as platforms are fixed, so it cannot rot into a to-do list nobody revisits;
//   3. the count is ratcheted: it may fall, never rise without a deliberate reviewed edit.
//
// It deliberately does NOT try to prove an oracle is CORRECT — that is each platform's own barrier
// (verify-aqargate-absence-cannot-deactivate.ts is the worked example, and it executes the oracle
// rather than grepping it). This one answers a different question: is anything deactivating on
// absence that nobody has declared?
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const LEDGER = join(ROOT, 'scrapers', 'absence-only-prune.txt');

// The ledger's size on the day the ratchet was installed. It may FALL as platforms gain oracles.
// Raising it is a deliberate, reviewed edit and means a platform started deactivating on absence.
// 31 → 29 on 2026-09-06: raghdan and sanadak gained control-validated `_verify_gone` oracles
// (scripts/verify-raghdan-absence-cannot-deactivate.ts,
//  scripts/verify-sanadak-absence-cannot-deactivate.ts) and left the ledger.
// 29 → 30 later the same day: abwbna onboarded as a second tenant of aldarim's own Nuzul SaaS
// platform, inheriting the exact same absence-only prune aldarim already carries (reviewed — see
// the ledger entry's own note: if aldarim ever gains a verify_gone oracle, abwbna inherits the fix).
// 30 → 26 later still: jazwtn, mizlaj, nowaisiry and souq24 gained oracles, each measured against
// EVERY one of its inactive rows with interleaved known-active controls, and each routed through
// the shared law in scrapers/common/http_liveness.py rather than a private copy of it
// (scripts/verify-http-liveness-law.ts, scripts/verify-absence-oracles-are-measured.ts).
// 26 → 28 later still: alobid and bahadhabab onboarded as a third and fourth Nuzul tenant, same
// inherited-fix note as abwbna.
// Four movements landed the same afternoon (+1, -4, +2 across three separate edits) — exactly what
// a ratchet is for: it records the direction of each change instead of letting one land silently
// inside another.
// 28 → 27: eastabha. Its dead rows are STILL SERVED by the source, so a 404 rule would never have
// fired — the signal is the listing's OWN `slider-property-status` ribbon reading تأجرت or تم البيع
// (39/41 dead carried one; 0/45 interleaved controls did). A whole-document substring search for
// the same two words ALSO matched live pages, because the related-listings carousel carries other
// listings' ribbons in `ribbon-inside`; only the main-gallery element belongs to this listing.
const RATCHET = 27;

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-prune-without-oracle-is-declared: absence-only deactivation is counted, not silent.');

// ── Classify the tree, in Python, using the real registry for "is it production-searchable" ─────
// Docstrings and comments are stripped first: this barrier's own subject matter gets DISCUSSED in
// prose (aqargate's oracle docstring names `prune_unseen(verify_gone=...)`), and a classifier that
// counted prose would read a comment as a fix.
const CLASSIFY = String.raw`
import json, re, sys, pathlib
sys.path.insert(0, ".")
from scrapers.common.liveness_policies import POLICIES

DOCSTR = re.compile(r'"""[\s\S]*?"""' + "|'''[\\s\\S]*?'''")
CALL = re.compile(r"db\.prune_unseen\s*\(")

absence, oracle = set(), set()
for f in sorted(pathlib.Path("scrapers").glob("*/*.py")):
    src = DOCSTR.sub("", f.read_text(encoding="utf-8", errors="replace"))
    src = "\n".join(l.split("#")[0] for l in src.split("\n"))
    sites = []
    for m in CALL.finditer(src):
        depth = 0
        for j in range(m.end() - 1, len(src)):
            if src[j] == "(": depth += 1
            elif src[j] == ")":
                depth -= 1
                if depth == 0: break
        sites.append("verify_gone=" in src[m.end():j])
    if not sites:
        continue
    # EVERY call site must carry the oracle. One unguarded call is an unguarded platform — gathern
    # and dealapp each have a real DIRECT sweep elsewhere AND an absence-only prune in run.py.
    (oracle if all(sites) else absence).add(f.parent.name)

print(json.dumps({
    "absence": sorted(absence),
    "oracle": sorted(oracle - absence),
    "searchable": sorted(p for p in absence if p in POLICIES),
}))
`;

const scan = JSON.parse(
  execFileSync('python3', ['-c', CLASSIFY], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop() as string,
) as { absence: string[]; oracle: string[]; searchable: string[] };

check(scan.searchable.length > 0, 'the classifier found prune_unseen call sites at all',
  'it parsed nothing — a classifier that sees no platforms would pass this barrier vacuously');

// ── The ledger ──────────────────────────────────────────────────────────────────────────────────
check(existsSync(LEDGER), 'the ledger is committed', LEDGER);
const declared = existsSync(LEDGER)
  ? readFileSync(LEDGER, 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('|')[0].trim())
  : [];

// ── The three rules, as a pure function so the mutations below can execute it ────────────────────
type Verdict = { undeclared: string[]; stale: string[]; over: boolean };
const judge = (searchable: string[], oracleNow: string[], ledger: string[], ratchet: number): Verdict => ({
  // (1) deactivating on absence without being declared
  undeclared: searchable.filter((p) => !ledger.includes(p)),
  // (2) declared, but the platform has since gained an oracle on every call site
  stale: ledger.filter((p) => oracleNow.includes(p)),
  // (3) the ratchet
  over: ledger.length > ratchet,
});

const v = judge(scan.searchable, scan.oracle, declared, RATCHET);

check(v.undeclared.length === 0,
  'every production-searchable platform that prunes on absence alone is declared in the ledger',
  `UNDECLARED: [${v.undeclared.join(', ')}]. This platform deactivates listings with no source ` +
  'verdict. Give it a control-validated verify_gone oracle (scrapers/aqargate/run.py is the worked ' +
  'example), or add it to scrapers/absence-only-prune.txt with the reason — and raising the ratchet ' +
  'is a reviewed decision, not a formality.');

check(v.stale.length === 0,
  'no ledger entry names a platform that has since gained an oracle',
  `FIXED BUT STILL LISTED: [${v.stale.join(', ')}]. Delete these lines and lower RATCHET — a ledger ` +
  'that never shrinks stops being a ledger and becomes wallpaper.');

check(!v.over, `the ledger has not grown past its ratchet (${declared.length}/${RATCHET})`,
  `${declared.length} declared vs ratchet ${RATCHET}. A platform started deactivating on absence.`);

check(declared.length === RATCHET || declared.length < RATCHET,
  'RATCHET matches or exceeds the committed ledger', `${declared.length} vs ${RATCHET}`);
if (declared.length < RATCHET) {
  console.log(`  ⓘ ledger is ${RATCHET - declared.length} shorter than the ratchet — lower RATCHET to ${declared.length} to lock the gain in.`);
}

// The platforms already fixed must stay fixed: this names them, so a regression that strips an
// oracle shows up here as an UNDECLARED platform rather than as silence.
console.log(`  ⓘ oracle-guarded platforms: [${scan.oracle.join(', ')}]`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — the judgement executed against inputs that carry the real defects.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the rule above is blind to the defect it exists to catch');

// A new platform starts deactivating on absence and nobody declares it.
mustCatch('a NEW absence-only platform absent from the ledger',
  judge([...scan.searchable, 'brandnew'], scan.oracle, declared, RATCHET).undeclared.includes('brandnew'));

// A platform is fixed but left in the ledger, so the gap count stays permanently overstated.
mustCatch('a ledger entry whose platform now has an oracle',
  judge(['mustqr'], ['raghdan'], ['mustqr', 'raghdan'], 99).stale.includes('raghdan'));

// The ledger grows past the ratchet.
mustCatch('the ledger growing past its ratchet',
  judge([], [], ['a', 'b', 'c'], 2).over);

// The opposite failure: a platform removed from the ledger WITHOUT being fixed must not read clean.
mustCatch('a platform quietly deleted from the ledger while still pruning on absence',
  judge(['sanadak'], [], declared.filter((p) => p !== 'sanadak'), RATCHET).undeclared.includes('sanadak'));

// And the guard must not congratulate itself on an empty scan — a broken classifier that finds
// nothing would otherwise report a perfectly clean tree.
mustCatch('an empty ledger against a real absence-only population',
  judge(scan.searchable, scan.oracle, [], RATCHET).undeclared.length === scan.searchable.length);

console.log(failed === 0
  ? '\n✅ verify-prune-without-oracle-is-declared: every absence-only prune is declared, and the list can only shrink.'
  : `\n❌ verify-prune-without-oracle-is-declared: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
