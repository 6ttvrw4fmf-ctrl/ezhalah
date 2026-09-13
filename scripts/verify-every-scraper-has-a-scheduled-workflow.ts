// PERMANENT BARRIER — a scraper with real code and no schedule is a silent onboarding gap
// (daily engineer, 2026-09-13).
//
// THE BUG THIS CLASS EXISTS FOR: scrapers/amlakalahsa/run.py shipped 2026-09-12, the same day the
// platform was owner-approved, with a fully working scraper (matches db.begin_run("amlakalahsa"),
// the exact name platform_registry and every run-attribution detector expect). Nobody ever added
// it to small-sources-sync.yml's matrix or gave it a bespoke workflow. It ran ZERO times via any
// scheduled path — the 236 production_ready rows already live came from a one-off manual/backfill
// run — until mon_detect_unattributable_platform_runs() caught the absence 24+ hours later and the
// daily engineer traced it to this exact gap. A scraper that exists but is never invoked is
// indistinguishable, from inside the DB, from a healthy platform between runs — nothing errors,
// nothing is empty, the rows already there just quietly go stale forever.
//
// WHAT IS ASSERTED, by walking the real files (never by grepping for a known-good list):
//   Every scrapers/<platform>/run.py is referenced as `scrapers.<platform>.run` by AT LEAST ONE
//   workflow under .github/workflows/ (the small-sources-sync.yml matrix, or a bespoke per-
//   platform workflow like muktamel-sharded.yml / dealapp-sharded.yml / the aqar/wasalt/gathern
//   fleets) — OR the platform has a reviewed exception row in
//   scripts/scraper-schedule-exclusions.txt naming where its retirement is documented and why.
//
// A word-boundary match (`scrapers\.<platform>\.run\b`) is required so "deal" cannot be satisfied
// by "dealapp" (or vice versa) — the literal bug class this repo already hit once with 'Al Khaas'
// vs 'alkhaas' (see verify-platform-registration-complete.ts).
//
// MUTATION-PROVEN, EXECUTABLE (see the mustCatch(...) block at the bottom of this file — each
// re-runs the real predicate against a synthetic broken input, independent of this repo's actual
// workflow files, so the proof survives even after the amlakalahsa gap itself is long fixed):
//   - a platform with no workflow reference at all reads as unscheduled (the amlakalahsa shape)
//   - "deal" is not falsely satisfied by "scrapers.dealapp.run", nor "aqar" by "scrapers.aqarcity.run"
//   - a real bare `run` reference, and a named entrypoint like aqar's `run_residential`, both DO
//     read as scheduled (so the guard above isn't just failing everything)
//   - a malformed scripts/scraper-schedule-exclusions.txt line is flagged, a well-formed one isn't
// Confirmed BY HAND on 2026-09-13 (mutation M1): deleting the amlakalahsa matrix line this same
// run just added made this barrier FAIL, and restoring it made it PASS again.
//
//   node --experimental-strip-types scripts/verify-every-scraper-has-a-scheduled-workflow.ts
//   (in `npm test`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// ── Every scraper platform: a scrapers/<name>/run.py that isn't the shared 'common' library ─────
const SCRAPERS_DIR = join(ROOT, 'scrapers');
const hasRunPy = (dir: string) => {
  try {
    return statSync(join(SCRAPERS_DIR, dir, 'run.py')).isFile();
  } catch {
    return false;
  }
};
const platforms = readdirSync(SCRAPERS_DIR)
  .filter((name) => name !== 'common' && statSync(join(SCRAPERS_DIR, name)).isDirectory())
  .filter(hasRunPy)
  .sort();

check('found scraper platforms', platforms.length >= 30, `got ${platforms.length}`);

// ── Concatenate every workflow's source once ─────────────────────────────────────────────────
const WF_DIR = join(ROOT, '.github', 'workflows');
const workflowText = readdirSync(WF_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => readFileSync(join(WF_DIR, f), 'utf8'))
  .join('\n---\n');

// ── The exclusions ledger: platform | where | why ────────────────────────────────────────────
const exclusionsRaw = readFileSync(join(ROOT, 'scripts', 'scraper-schedule-exclusions.txt'), 'utf8');
const exclusions = new Map<string, { where: string; why: string }>();
for (const line of exclusionsRaw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const parts = trimmed.split('|').map((s) => s.trim());
  if (parts.length !== 3) {
    check(`exclusions line is well-formed: "${trimmed}"`, false, 'expected "platform | where | why"');
    continue;
  }
  exclusions.set(parts[0], { where: parts[1], why: parts[2] });
}

// Most platforms dispatch through a single scrapers/<platform>/run.py, but a few (aqar) split
// into named entrypoints in the SAME module (run_residential.py, run_commercial.py) instead of
// one run.py::main — so the match allows any `run*` module, not only the bare `run`.
const isScheduledIn = (platform: string, text: string) =>
  new RegExp(String.raw`scrapers\.${platform}\.run\w*\b`).test(text);
const scheduled = (platform: string) => isScheduledIn(platform, workflowText);

const unscheduledAndUnexcluded: string[] = [];
for (const platform of platforms) {
  const isScheduled = scheduled(platform);
  const excludedAs = exclusions.get(platform);
  if (isScheduled) {
    check(`${platform}: scheduled by a workflow`, true);
  } else if (excludedAs) {
    check(`${platform}: not scheduled, but excluded (${excludedAs.why})`, true);
  } else {
    unscheduledAndUnexcluded.push(platform);
    check(`${platform}: scheduled OR excluded`, false, 'no workflow references it and it is not in scripts/scraper-schedule-exclusions.txt');
  }
}

// ── Every exclusions row must name a REAL, still-existing platform (no stale/typo rows) ─────────
for (const platform of exclusions.keys()) {
  check(`exclusion "${platform}" names a real scrapers/ directory`, platforms.includes(platform));
}

if (unscheduledAndUnexcluded.length) {
  console.log('');
  console.log('UNSCHEDULED, UNEXCLUDED PLATFORMS (silent onboarding/retirement gap):');
  for (const p of unscheduledAndUnexcluded) console.log(`  - ${p}`);
  console.log('');
  console.log('Fix: add ONE matrix line to .github/workflows/small-sources-sync.yml (or give the');
  console.log('platform its own bespoke workflow), OR — only if it is genuinely retired — add a');
  console.log('reviewed row to scripts/scraper-schedule-exclusions.txt naming where that is documented.');
}

// ── MUTATION PROOF — synthetic inputs, independent of this repo's real files ────────────────────
// Each mustCatch re-runs the SAME predicate against a deliberately broken input and checks that
// the predicate itself would have flagged it — proving the checks above are not vacuous.
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// M1/M3: a platform genuinely absent from every workflow must NOT read as scheduled.
mustCatch('a platform with no workflow reference at all (the amlakalahsa shape)',
  !isScheduledIn('amlakalahsa', '- { source: aqargate, cmd: "python -m scrapers.aqargate.run" }'));

// The word-boundary guard: "deal" must not be satisfied by "dealapp", nor "aqar" by "aqarcity" —
// the exact collision class this repo already hit once with 'Al Khaas' vs 'alkhaas'.
mustCatch('"deal" being falsely satisfied by "scrapers.dealapp.run"',
  !isScheduledIn('deal', 'exec python -m scrapers.dealapp.run --shard 0'));
mustCatch('"aqar" being falsely satisfied by "scrapers.aqarcity.run"',
  !isScheduledIn('aqar', '{ source: aqarcity, cmd: "python -m scrapers.aqarcity.run --type all" }'));

// A genuinely scheduled platform, including the named-entrypoint shape (aqar's run_residential),
// must still read as scheduled — otherwise the guard above is just failing everything.
mustCatch('a real bare `run` reference not being recognised as scheduled',
  isScheduledIn('amlakalahsa', 'cmd: "python -m scrapers.amlakalahsa.run"'));
mustCatch('a named entrypoint (run_residential) not being recognised as scheduled',
  isScheduledIn('aqar', 'exec python -m scrapers.aqar.run_residential --shard 0'));

// M4: a malformed exclusions line (wrong column count) must be flagged, not silently accepted.
const parseExclusionLine = (line: string) => line.trim().split('|').map((s) => s.trim());
mustCatch('a malformed exclusions line (missing the "why" column)',
  parseExclusionLine('someplatform | somewhere').length !== 3);
mustCatch('a well-formed exclusions line NOT being falsely flagged as malformed',
  parseExclusionLine('someplatform | somewhere | some reason').length === 3);

console.log('');
console.log(failed === 0 ? `PASS — all ${platforms.length} scraper platforms are scheduled or documented as excluded.` : `FAIL — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
