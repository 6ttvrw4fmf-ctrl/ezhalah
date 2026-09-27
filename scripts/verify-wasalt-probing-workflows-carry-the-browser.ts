// A JOB THAT CANNOT READ THE SOURCE IS NOT A CHECK — it is silence wearing a green tick.
// (ops_incident #704, routine #11, 2026-09-25.)
//
// THE DEFECT THIS EXISTS FOR, measured. `scrapers/common/cleanup.py::_probe()` reaches wasalt.sa
// ONLY through `scrapers/wasalt/browser.py`, and only when `WASALT_BROWSER` is set — wasalt has
// null-routed the curl_cffi+Saudi-proxy shape since 2026-08-17 (issue #1019), so without the
// browser every wasalt probe times out at 25s and returns `(None, '')` → verdict `unknown`.
//
// `verify-deletions.yml` — the post-delete spot-check, the ONE independent second opinion on a
// permanent, unrecoverable delete — never set it, never installed Chromium and had no display.
// GitHub Actions run 35490675449 (2026-09-20): the wasalt leg took 16m43s for 40 rows (25.1s
// each) and reported `sampled=40 still_dead=0 live=0 unknown=40`, every row NULL http_status.
// 5,015 permanent wasalt deletions had no readable confirmation, and because
// `mon_detect_deleted_but_source_live` fires only on verdict='live', an audit that can read
// NOTHING is indistinguishable from an audit that found nothing wrong.
// LISTING_LIVENESS.md §9: absence cannot be compared, so silence reads as health.
//
// The same gap sat on `platform-cleanup.yml`, whose `platform` is a FREE-TEXT input — so the
// generic entrypoint to the sanctioned DELETER could be dispatched for wasalt and structurally
// could not confirm a single death. (Fails safe: unknown never deletes, and the run-level
// inconclusive freeze trips. Safe, and silent.)
//
// WHY A BARRIER AND NOT A NOTE. Six workflows already set WASALT_BROWSER correctly. Nothing
// connected "this workflow runs code that can probe wasalt" to "therefore it needs the browser",
// so the two that didn't looked exactly like the four platform-pinned cleanups that genuinely
// don't. A barrier that derives the cohort from the IMPORT GRAPH closes that: a workflow written
// tomorrow that runs a wasalt-probing module is RED until it carries the transport, with nobody
// registering anything.
//
// DISCOVERY, NOT A LIST (AGENTS.md). The cohort is every python module that reaches
// `scrapers/wasalt/browser.py` through `scrapers.*` import edges — which is how
// `scrapers.common.verify_deletions` is found at all: it imports `_probe` from
// `scrapers.common.cleanup`, which imports the browser. Tests are excluded (they never run in a
// workflow's probe path). A declared FLOOR on the cohort size is mutation-proven, so a refactor
// that hides an import edge cannot silently narrow what this checks.
//
// COMMENTS ARE STRIPPED BEFORE ANY ASSERTION, and mutation 4 proves it: the first version of the
// §4.1d barrier passed on a COMMENT after every real write had been deleted, and every one of the
// five 2026-09-04 defects had a source-TEXT tripwire over the exact line.
//
// Offline, hermetic, deterministic: reads only tracked repo files.
// Run: node --experimental-strip-types scripts/verify-wasalt-probing-workflows-carry-the-browser.ts
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const problems: string[] = [];
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`);
};

const BROWSER_MODULE = 'scrapers.wasalt.browser';

// SCOPE: the DELETION TIER's probe path, not every module that can touch wasalt. The transport
// requirement asserted below is the one `cleanup.py::_wasalt_browser_probe` needs —
// `BrowserFetcher` runs headless=False to clear the challenge, hence the display. wasalt's own
// crawl/enrich/liveness workflows arrange their transports differently and are routine #1's
// surface (LISTING_LIFECYCLE_ENGINEER.md §1.5); this barrier deliberately does not judge them,
// because asserting an unmeasured requirement on six correct workflows is how a barrier becomes
// noise people learn to dismiss (§8.3).
const PROBE_ROOT = 'scrapers.common.cleanup';

// The cohort measured 2026-09-25: `scrapers.common.cleanup` itself and
// `scrapers.common.verify_deletions`, which imports its `_probe`. A FLOOR, not a list — a module
// that imports that probe tomorrow needs no edit here, and LOWERING it is a deliberate reviewed
// change, because a shrinking cohort is how this check stops checking.
const COHORT_FLOOR = 2;

const ls = (glob: string) =>
  execFileSync('git', ['ls-files', glob], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

// ── 1. The cohort, derived from the import graph ────────────────────────────────────────────────

/**
 * Modules (dotted) that reach `PROBE_ROOT` — which itself reaches `BROWSER_MODULE` — excluding
 * tests. Both ends are checked: if `PROBE_ROOT` ever stops reaching the browser this returns
 * empty, which trips the floor rather than quietly passing everything.
 */
function probingModules(sources: Map<string, string>): Set<string> {
  const edges = new Map<string, Set<string>>();
  for (const [mod, src] of sources) {
    const out = new Set<string>();
    for (const m of src.matchAll(/^[ \t]*from[ \t]+(scrapers[\w.]*)[ \t]+import[ \t]+([^\n#]+)/gm)) {
      const base = m[1];
      if (sources.has(base)) out.add(base);
      // `from scrapers.wasalt import browser as _b` — the imported NAME is the module.
      for (const raw of m[2].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim().replace(/[()]/g, '');
        if (sources.has(`${base}.${name}`)) out.add(`${base}.${name}`);
      }
    }
    for (const m of src.matchAll(/^[ \t]*import[ \t]+(scrapers[\w.]*)/gm)) {
      if (sources.has(m[1])) out.add(m[1]);
    }
    edges.set(mod, out);
  }
  const closure = (target: string): Set<string> => {
    const reaches = new Set<string>();
    for (let changed = true; changed;) {
      changed = false;
      for (const [mod, out] of edges) {
        if (reaches.has(mod)) continue;
        for (const dep of out) {
          if (dep === target || reaches.has(dep)) { reaches.add(mod); changed = true; break; }
        }
      }
    }
    return reaches;
  };
  // The probe root must still be the thing that reaches the browser. If it is not, the premise of
  // this barrier has moved and an empty cohort (→ below the floor) is the honest answer.
  if (!closure(BROWSER_MODULE).has(PROBE_ROOT)) return new Set();
  const reaches = closure(PROBE_ROOT);
  reaches.add(PROBE_ROOT);
  for (const mod of [...reaches]) if (/(^|\.)tests?\./.test(mod) || /\.test_/.test(mod)) reaches.delete(mod);
  return reaches;
}

const pySources = new Map<string, string>();
for (const f of ls('scrapers/**/*.py')) {
  pySources.set(f.replace(/\.py$/, '').replace(/\//g, '.').replace(/\.__init__$/, ''), readFileSync(f, 'utf8'));
}
const COHORT = probingModules(pySources);

if (COHORT.size < COHORT_FLOOR) {
  problems.push(
    `the wasalt-probing cohort discovered from the import graph is ${COHORT.size}, below the ` +
    `declared floor of ${COHORT_FLOOR}. Either an import edge stopped being detectable (this check ` +
    `then silently stops checking those workflows) or a module really was removed — in which case ` +
    `lower COHORT_FLOOR deliberately and say so in the PR body. Found: ${[...COHORT].sort().join(', ')}`);
}
// Self-consistency: anything that literally imports the deletion-tier probe must be IN the cohort.
for (const [mod, src] of pySources) {
  if (/(^|\.)tests?\./.test(mod) || /\.test_/.test(mod) || mod === PROBE_ROOT) continue;
  if (new RegExp(`from ${PROBE_ROOT.replace(/\./g, '\\.')} import[^\\n]*\\b_probe\\b`).test(src)
      && !COHORT.has(mod)) {
    problems.push(`${mod} imports ${PROBE_ROOT}._probe but the graph walk did not find it — the ` +
      `discovery is broken, not the workflows`);
  }
}

// ── 2. Workflow invocations of those modules, and the transport each one must carry ─────────────

/** A workflow with every comment LINE removed, so nothing below can pass on a comment. */
const uncommented = (yml: string) =>
  yml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

type Finding = { file: string; module: string; missing: string[] };

/** Does this `run:` command pin itself to a platform that is not wasalt? */
function pinnedAwayFromWasalt(command: string): boolean {
  const m = command.match(/--platform[= ]+"?([^"\s\\]+)"?/);
  if (!m) return false;                       // no pin at all → it can be wasalt
  if (m[1].includes('${{')) return false;     // an expression → it can be wasalt
  return m[1] !== 'wasalt';
}

function audit(file: string, yml: string): Finding[] {
  const body = uncommented(yml);
  const out: Finding[] = [];
  // Each `run:` block, with the two-line neighbourhood collapsed: a `run: |` block ends at the
  // next line indented no further than the `run:` key itself.
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(- )?(?:name:.*)?run:(.*)$/);
    if (!open) continue;
    const indent = open[1].length + (open[2] ? open[2].length : 0);
    let command = open[3] ?? '';
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && (l.length - l.trimStart().length) <= indent) break;
      command += '\n' + l;
    }
    const modules = [...COHORT].filter(m =>
      new RegExp(`python[\\w.]*\\s+-m\\s+${m.replace(/\./g, '\\.')}(?![\\w.])`).test(command));
    if (!modules.length) continue;
    if (pinnedAwayFromWasalt(command)) continue;

    const missing: string[] = [];
    // (a) the browser gate, set to something truthy, in the JOB the step belongs to.
    if (!/^\s*WASALT_BROWSER:\s*["']?(?!0|false|no|""|''|\s*$)\S/m.test(body)) {
      missing.push('WASALT_BROWSER is never set to a truthy value');
    }
    // (b) a Chromium install: `browser_enabled()` true with no Chromium raises on launch, which is
    //     the right direction (loud, not silent) but still a job that cannot do its work.
    if (!/playwright\s+install[^\n]*chromium/.test(body)) {
      missing.push('no `playwright install … chromium` step');
    }
    // (c) a display. headless=False is what clears the challenge; the runner has none.
    if (!/xvfb-run/.test(command)) {
      missing.push('the invocation does not run under xvfb-run');
    }
    if (missing.length) out.push({ file, module: modules[0], missing });
  }
  return out;
}

const WORKFLOWS = ls('.github/workflows/*.yml');
const live = new Map<string, string>();
for (const f of WORKFLOWS) live.set(f, readFileSync(f, 'utf8'));

const auditAll = (files: Map<string, string>): Finding[] =>
  [...files].flatMap(([f, y]) => audit(f, y));

for (const f of auditAll(live)) {
  problems.push(
    `${f.file} runs \`python -m ${f.module}\`, which reaches ${BROWSER_MODULE} in the import ` +
    `graph and is not pinned away from wasalt, but ${f.missing.join('; ')}. Every wasalt probe in ` +
    `that job will time out at 25s and return unknown — a check that cannot read the source ` +
    `(ops_incident #704).`);
}

// ── 3. Mutations — this file's claims, executed against deliberately broken inputs ───────────────

const TARGET = '.github/workflows/verify-deletions.yml';
const base = live.get(TARGET);
if (!base) {
  problems.push(`${TARGET} is missing — the post-delete spot-check has no workflow at all`);
} else {
  const withTarget = (mutated: string) => {
    const m = new Map(live);
    m.set(TARGET, mutated);
    return auditAll(m).some(f => f.file === TARGET);
  };
  const need = (needle: string) => {
    if (!base.includes(needle)) problems.push(`mutation target vanished from ${TARGET}: ${needle}`);
    return base.includes(needle);
  };

  // 1 — THE SHIPPED DEFECT: no browser gate.
  if (need('WASALT_BROWSER: "1"')) {
    mustCatch('the shipped defect — WASALT_BROWSER removed, so every wasalt probe falls back to ' +
      'the null-routed transport',
      withTarget(base.replace(/^\s*WASALT_BROWSER: "1"\n/m, '')));
  }
  // 2 — a DIFFERENT wrong way: the gate is set but Chromium is never installed.
  if (need('playwright install --with-deps chromium')) {
    mustCatch('Chromium never installed, so the browser path raises on launch',
      withTarget(base.replace('python -m playwright install --with-deps chromium', 'true')));
  }
  // 3 — a THIRD wrong way: browser + Chromium, but no display for headless=False.
  if (need('exec xvfb-run -a python -m scrapers.common.verify_deletions')) {
    mustCatch('the display removed, so headless=False cannot start',
      withTarget(base.replace('exec xvfb-run -a python -m scrapers.common.verify_deletions',
        'exec python -m scrapers.common.verify_deletions')));
  }
  // 4 — THE TRAP THIS REPO KEEPS PAYING FOR: the gate present only as a COMMENT. A source-TEXT
  //     tripwire passes here; this one must not.
  mustCatch('WASALT_BROWSER present only inside a comment',
    withTarget(base.replace(/^(\s*)WASALT_BROWSER: "1"$/m, '$1# WASALT_BROWSER: "1"')));

  // 5 — a NEW workflow, written tomorrow, that runs a probing module with no transport at all.
  //     Proves the rule is derived, not a list of two files someone remembered to add.
  {
    const invented = new Map(live);
    invented.set('.github/workflows/invented-by-the-barrier.yml',
      'name: Invented\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n' +
      '      - name: Go\n        run: |\n          exec python -m scrapers.common.verify_deletions --platform wasalt\n');
    mustCatch('a brand-new workflow running a wasalt-probing module with no transport',
      auditAll(invented).some(f => f.file === '.github/workflows/invented-by-the-barrier.yml'));
  }

  // 6 — GUARD ON THE GUARD: an import edge that stops being detectable must BREAK this check,
  //     never satisfy it. Hide `verify_deletions`' import of cleanup and the cohort shrinks.
  {
    const hidden = new Map(pySources);
    const vd = hidden.get('scrapers.common.verify_deletions');
    if (!vd || !vd.includes('from scrapers.common.cleanup import')) {
      problems.push('mutation 6 target vanished: verify_deletions no longer imports from cleanup');
    } else {
      hidden.set('scrapers.common.verify_deletions',
        vd.replace(/^from scrapers\.common\.cleanup import.*$/m, '_probe = None  # hidden edge'));
      const shrunk = probingModules(hidden);
      mustCatch('the import edge that puts verify_deletions in the cohort being hidden — the ' +
        'cohort must shrink below the floor, not quietly stop checking',
        !shrunk.has('scrapers.common.verify_deletions') && shrunk.size < COHORT_FLOOR);
    }
  }

  // 7 — THE DIRECTION THAT MUST NOT CHANGE: a cleanup pinned to a non-wasalt platform is
  //     legitimately exempt, and must stay exempt, or this barrier turns into noise on four
  //     workflows that are correct.
  for (const f of ['.github/workflows/aqar-cleanup.yml', '.github/workflows/gathern-cleanup.yml',
                   '.github/workflows/aqarcity-cleanup.yml']) {
    const y = live.get(f);
    if (!y) { problems.push(`${f} is missing — cannot prove the platform-pinned exemption`); continue; }
    if (audit(f, y).length) {
      problems.push(`${f} is pinned to a non-wasalt platform and must not be flagged — the ` +
        `exemption broke and this barrier now cries wolf`);
    }
  }
}

if (problems.length) {
  console.error('RED  verify-wasalt-probing-workflows-carry-the-browser\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(
  `PASS verify-wasalt-probing-workflows-carry-the-browser — ${COHORT.size} modules reach ` +
  `${PROBE_ROOT}'s wasalt probe in the import graph (floor ${COHORT_FLOOR}); every workflow ` +
  `invocation of one ` +
  `that is not pinned away from wasalt carries WASALT_BROWSER + Chromium + a display. 6 mutations ` +
  `caught, including the gate present only as a comment and an import edge hidden from discovery ` +
  `(ops_incident #704, run 35490675449).`);
