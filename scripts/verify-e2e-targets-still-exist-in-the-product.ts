// A HARNESS THAT CLICKS A LABEL THE PRODUCT NO LONGER HAS IS NOT COVERAGE — IT IS A TIDY SKIP.
//
// MEASURED, 2026-09-11 (routine #6). Commit 60bad2b (2026-09-06, PR #2061) renamed the agent tab
// «الوكيل الذكي» → «الوسيط الذكي» in `src/i18n.tsx` on the owner's instruction. Three scripts were
// updated with it. FOUR e2e suites were not:
//
//   e2e/journeys/run.mjs        8 click sites   (new-chat-blank, back-after-search, sidebar star
//                                                round trip, mode-switch history, composer, the
//                                                auth-overlay reachability journey …)
//   e2e/guardian/journeys.mjs   2 click sites
//   e2e/live-sweep/journeys.mjs 1 click site    (tab-switch-no-junk-history)
//   e2e/ui-parity.spec.ts       2 click sites
//
// WHEN IT ACTUALLY BIT, which is NOT when it was introduced. The rename merged on 2026-09-06 but
// the production deploy carrying it landed 2026-09-11T12:12:28Z (dpl_Eb6yPLNz…, commit e9a0522,
// PR #2248); the previous production deploy, 2026-09-07T00:14:49Z at 8d59aad, did not contain the
// rename. So the harness sat diverged from `main` for five days as a LATENT defect, and became a
// live coverage loss at 12:12 — about an hour and three quarters before this barrier was written.
// The bundle served afterwards contains «الوسيط الذكي» exactly once and «الوكيل الذكي» zero times
// (decoded from entry-3545b04a….js).
//
// That distinction is the point, not a footnote: the CI journey sweeps at 09:43 (Chromium), 10:11
// (WebKit) and 10:42 (Firefox) that morning all recorded `0/2 failed, 0 skipped` and were RIGHT to
// — they ran against a bundle that still had the old label. Nothing in the repo could tell the
// difference between a harness that agrees with production and one that merely has not been
// overtaken by a deploy yet. This barrier fires at the moment of DIVERGENCE, on the PR that renames
// the label, which is five days before the deploy makes it matter.
//
// WHAT IT ACTUALLY COST is the reason this barrier is not a lint rule. Most of those call sites are
// guarded — `if (!(await clickText(page, …))) { skip(name, …); return; }` — so they did not fail.
// They SKIPPED, politely, with a reason, and the sweep printed them under "SKIPPED (never executed
// — not a pass)". `new-chat-blank`, which is PART 5 barrier shape #1 and the single journey this
// routine exists to run, reported 4/4 skipped on the 2026-09-11 sweep. Nothing was red. Coverage
// had simply evaporated, which is the exact failure mode `AGENTS.md` keeps writing down: a check
// that cannot fire reads as a clean bill of health.
//
// THE ROOT CAUSE IS NOT THE RENAME. Renaming a label is ordinary product work and the author is
// entitled to do it. The defect is that nothing connected the harness's idea of a control to the
// product's, so the two could diverge with no signal in either direction. This barrier is that
// connection, and it runs offline in `npm test` on every PR — including the PR that does the next
// rename, which is the moment it needs to fire.
//
// HOW IT DECIDES, and why the corpus is literals and not text. Every Arabic string the e2e suites
// click, tap or match on must still exist as a STRING LITERAL somewhere in `src/**`. Comment lines
// are excluded deliberately: `src/app/_layout.tsx`, `src/lib/bottomPromptInset.ts`,
// `src/lib/webRefreshRoute.ts` and `src/app/agent.tsx` all still MENTION «الوكيل الذكي» in prose
// describing the 2026-09-01 One Tap measurements, and a corpus built from raw file text would have
// been green through this entire defect on the strength of four comments.
//
// Run: node --experimental-strip-types scripts/verify-e2e-targets-still-exist-in-the-product.ts
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const check = (m: string, cond: boolean) => { if (cond) ok(m); else { console.error(`  FAIL  ${m}`); failed++; } };

const ARABIC = /[؀-ۿ]/;

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.test(p)) out.push(p);
  }
  return out;
}

// ── THE PRODUCT'S SIDE: Arabic string LITERALS in src/, comments excluded ───────────────────────
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const isCommentLine = (line: string) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

export function productStringCorpus(srcDir: string): Set<string> {
  const corpus = new Set<string>();
  for (const file of walk(srcDir, /\.(ts|tsx)$/)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (isCommentLine(line)) continue;
      let m: RegExpExecArray | null;
      LITERAL.lastIndex = 0;
      while ((m = LITERAL.exec(line))) {
        const v = m[1] ?? m[2] ?? m[3];
        if (v && ARABIC.test(v)) corpus.add(v);
      }
    }
  }
  return corpus;
}

// ── THE HARNESS'S SIDE: what the e2e suites actually aim at ─────────────────────────────────────
// Only QUOTED literals at a real targeting call site, so a comment describing a control (of which
// the suites have many) is never mistaken for a click on it.
const TARGET_PATTERNS: RegExp[] = [
  /\bclickText\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'/g,   // e2e/journeys
  /\btap\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'/g,         // e2e/guardian
  /getByText\(\s*'([^']+)'/g,                                // raw Playwright
  /'text=([^']+)'/g,                                         // text= engine, incl. /regex/ form
  /\bconst\s+[A-Z][A-Z0-9_]*\s*=\s*'([^']+)'/g,              // LABEL constants used at call sites
];

export function harnessTargets(e2eDir: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of walk(e2eDir, /\.(mjs|js|ts|tsx)$/)) {
    const src = readFileSync(file, 'utf8');
    for (const re of TARGET_PATTERNS) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(src))) {
        const t = m[1];
        if (!ARABIC.test(t)) continue;
        if (!found.has(t)) found.set(t, new Set());
        found.get(t)!.add(file.slice(root.length + 1));
      }
    }
  }
  return found;
}

// ── FIXTURES ARE NOT PRODUCT STRINGS, AND EACH ONE SAYS WHY ─────────────────────────────────────
// This is the only escape hatch, and it is a MAP so an entry cannot be added without a reason. A
// city the user types, a chat title the harness seeds, a listing word that comes from scraped
// inventory: none of those live in `src/` and none of them should. Anything that IS a control the
// product renders belongs in the corpus, not here.
const FIXTURES: Record<string, string> = {
  'فلل جدة':      'THREE_CHATS fixture — a seeded sidebar chat title (e2e/journeys/harness.mjs)',
  'عقارات الرياض': 'THREE_CHATS fixture — a seeded sidebar chat title',
  'شقق الخبر':    'THREE_CHATS fixture — a seeded sidebar chat title',
  'شاليهات أبها': 'the rename target in sidebar-rename — a value the journey TYPES, never one it finds',
};

/** The whole decision, as a pure function, so the mutation proof below EXECUTES it. */
export function staleTargets(
  targets: Map<string, Set<string>>,
  corpus: Set<string>,
  fixtures: Record<string, string>,
): { target: string; where: string[] }[] {
  const stale: { target: string; where: string[] }[] = [];
  for (const [target, where] of targets) {
    if (fixtures[target]) continue;
    // `text=/…/` is a Playwright REGEX selector: the product string legitimately continues past it
    // («…سيأخذك إلى {host}»), so a substring match is the correct oracle for this form alone.
    const isRegex = target.startsWith('/') && target.endsWith('/') && target.length > 2;
    const needle = isRegex ? target.slice(1, -1) : target;
    const hit = isRegex
      ? [...corpus].some((v) => v.includes(needle))
      : corpus.has(needle);
    if (!hit) stale.push({ target, where: [...where] });
  }
  return stale;
}

// ── 1. THE LIVE CHECK ───────────────────────────────────────────────────────────────────────────
const corpus = productStringCorpus(join(root, 'src'));
const targets = harnessTargets(join(root, 'e2e'));
check(`the product corpus is non-empty (${corpus.size} Arabic literals in src/)`, corpus.size > 500);
check(`the harness targets are non-empty (${targets.size} distinct Arabic targets in e2e/)`, targets.size > 10);

const stale = staleTargets(targets, corpus, FIXTURES);
if (stale.length) {
  console.error(`\n  FAIL  ${stale.length} e2e target(s) no longer exist as a string literal in src/:`);
  for (const s of stale) console.error(`          «${s.target}»  ←  ${s.where.join(', ')}`);
  console.error(`\n        A renamed or removed control does NOT fail these suites — the guarded call sites`);
  console.error(`        SKIP with a tidy reason, and the coverage silently disappears. Either update the`);
  console.error(`        harness to the product's current string, or, if the target is a fixture/data value`);
  console.error(`        that legitimately does not live in src/, add it to FIXTURES with a reason.\n`);
  failed++;
} else {
  ok(`every one of the ${targets.size} Arabic e2e targets still exists in the product`);
}

// ── 2. MUTATION PROOF — the barrier is watched catching the real defect, not assumed to ─────────
// §G.9.4: a check no mutation can turn red is decoration. Each of these EXECUTES `staleTargets`.
const AGENT_TAB_NOW = 'الوسيط الذكي';
const AGENT_TAB_BEFORE = 'الوكيل الذكي';           // the exact string PR #2061 renamed away
check('the corpus really contains the agent tab as it is named TODAY', corpus.has(AGENT_TAB_NOW));
check('the corpus does NOT contain the pre-#2061 name (four src COMMENTS still mention it — '
  + 'proof the comment exclusion is doing its job)', !corpus.has(AGENT_TAB_BEFORE));

const mutant = new Map([[AGENT_TAB_BEFORE, new Set(['e2e/journeys/run.mjs'])]]);
check('MUTATION: a harness still aiming at the pre-#2061 label is caught',
  staleTargets(mutant, corpus, FIXTURES).length === 1);

const renamedAway = new Set([...corpus].filter((v) => v !== AGENT_TAB_NOW));
check('MUTATION: renaming the tab in the product, with the harness left behind, is caught',
  staleTargets(new Map([[AGENT_TAB_NOW, new Set(['e2e/journeys/run.mjs'])]]), renamedAway, FIXTURES).length === 1);

check('a real fixture is NOT flagged (the escape hatch works)',
  staleTargets(new Map([['فلل جدة', new Set(['e2e/journeys/run.mjs'])]]), corpus, FIXTURES).length === 0);
check('MUTATION: an UNDECLARED fixture IS flagged (the escape hatch is not a blanket pass)',
  staleTargets(new Map([['فلل جدة', new Set(['x'])]]), corpus, {}).length === 1);

const regexTarget = new Map([['/الضغط على هذا الإعلان/', new Set(['e2e/live-sweep/journeys.mjs'])]]);
check('a /regex/ text selector matches a product string it is a PREFIX of',
  staleTargets(regexTarget, corpus, FIXTURES).length === 0);
check('MUTATION: a /regex/ selector matching nothing in the product IS flagged',
  staleTargets(new Map([['/لا شيء هنا أبداً/', new Set(['x'])]]), corpus, FIXTURES).length === 1);

// The extraction itself must keep working; an empty harness-target set would make every check above
// vacuously green — the shape of dark barrier this repo has been burned by before.
check('extraction still finds the agent tab at real call sites in e2e/', targets.has(AGENT_TAB_NOW));

if (failed) { console.error(`\n${failed} check(s) failed\n`); process.exit(1); }
console.log('  PASS  e2e click targets still exist in the product');
