// Barrier: WHICH SCREEN IS ON THE PAGE IS AN ELEMENT QUESTION, NEVER AN innerText SUBSTRING.
//
// Routine #6, 2026-09-26. Three journeys decided «the Filter home and its primary control are on
// screen» with `bodyText(page).includes('بحث')` — `cold-open` («missing primary control»),
// `back-after-search` («Back landed off-route») and `adv-background-tab` («controls missing after
// backgrounding»). Arabic is agglutinative: «بحث» is a proper substring of «أبحث», «البحث», «للبحث»
// and «بحثك», all four of which this product renders. The test answered a question about VOCABULARY
// while its failure message claimed a question about a BUTTON.
//
// MEASURED on production, Chromium, a fresh context per run, real Playwright clicks, pane
// foregrounded, before anything was changed:
//   · Filter home  — includes('بحث') true  · exact «بحث» nodes 1 · city-input 1     (4/4)
//   · agent screen — includes('بحث') TRUE  · exact «بحث» nodes 0 · city-input 0     (4/4, 1440 and 375)
//   · Filter home with its primary control DELETED out of the live DOM — exact nodes 1 → 0 while
//     includes('بحث') stayed TRUE (2/2). cold-open's own named defect could not fire. WATCHED.
//
// `back-after-search` exists for PART 5 shape 9 — «Browser Back stranding the user off-route» — and
// would have reported `pass` for a Back that landed on the agent screen. PART 9.5's class: not a red,
// a PASS that asserted something other than what it claimed.
//
// TWO HALVES, because either alone decays:
//
//  §1 enforces the INVARIANT as a CLASS, and it is deliberately NOT a ban on `.includes(`. A ban
//     would cry wolf on every legitimate content check (`includes('عرض المزيد')` asks whether a ROW
//     is on screen and is perfectly sound), and PART 9 states the cost: a barrier that cries wolf is
//     deleted by the next author. So the question is scoped to the one measurable property that made
//     this one wrong — the PRODUCT itself renders a strictly longer word carrying the same token, so
//     the test cannot discriminate BY CONSTRUCTION. The corpus is the product's own strings, so the
//     rule stays true as the copy changes instead of pinning today's wording.
//
//  §2 EXECUTES the real replacement predicate (`filterHomeVerdict`, imported from the harness — not
//     a copy) against the four shapes measured above, and §2b re-breaks it and watches it fail. A
//     source-text tripwire over these lines would pass for exactly as long as a defect is live, which
//     is the whole lesson of the three oracles this barrier replaces.
//
//   node --experimental-strip-types scripts/verify-screen-identity-is-an-element-not-a-substring.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { ambiguousCarriers, isCommentLine, productStringCorpus, walk } from './lib/productStrings.ts';
import { filterHomeVerdict } from '../e2e/journeys/harness.mjs';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};
/** An EXECUTABLE proof: this barrier's own predicate, applied to a deliberately broken input. */
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

// ═══ §1 · every AMBIGUOUS innerText substring test in e2e/ is discovered by shape ════════════════

/** `x.includes('…')` — the shape that reads innerText and decides something from a substring. */
const INCLUDES = /\.includes\(\s*(['"`])((?:[^'"`\\]|\\.)*?)\1\s*\)/g;

type Site = { file: string; token: string; carriers: string[] };

export function ambiguousSubstringSites(e2eDir: string, corpus: Set<string>): Site[] {
  const out: Site[] = [];
  for (const file of walk(e2eDir, /\.(mjs|js|ts|tsx)$/)) {
    const rel = relative(ROOT, file);
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      // Comment lines are excluded on purpose, and for the same reason the sibling barrier excludes
      // them: this file and the three repaired call sites all EXPLAIN the rule in prose that quotes
      // the offending call, and a corpus built from raw text would push the next author to delete the
      // explanation rather than the call.
      if (isCommentLine(line)) continue;
      INCLUDES.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = INCLUDES.exec(line))) {
        const token = m[2];
        const carriers = ambiguousCarriers(token, corpus);
        if (carriers.length) out.push({ file: rel, token, carriers });
      }
    }
  }
  return out;
}

// REGISTERED AMBIGUOUS SITES, each adjudicated by READING it — never waved through to clear a red.
//
// WHY A REGISTRY AND NOT A BAN, restated where it is applied: the class that cost three blind oracles
// is a PAGE-WIDE innerText substring standing in for a screen or control identity. A STEM match on
// ONE element's own text is a different question, and for Arabic it is often the correct one — «إعلان»
// and «إعلانات» both mean the row carries a listing count. A barrier that cried wolf on those would
// be deleted by the next author, which PART 9 names as the real cost.
//
// COUNTS, NOT JUST KEYS (the §1b lesson from verify-ownership-probes-use-the-painted-stack.ts: per
// call site, never per file). guardian/harness.mjs holds four of these; keyed on `file :: token`
// alone, a NEW fifth one would hide behind the four already judged.
const ALLOWED: Record<string, { count: number; reason: string }> = {
  'e2e/guardian/harness.mjs :: إعلان': {
    count: 4,
    reason: 'Identifies a CITY SUGGESTION ROW, on ONE element: `t.startsWith(city) && t.includes("إعلان") '
      + '&& t.length < 46`. The row reads «الرياض 32,203 إعلان» or «… إعلانات» depending on the count, so '
      + 'matching the stem is deliberate and correct — the discriminators are startsWith(city), the '
      + 'length cap and pickCityOptionIndex, none of which is a page-wide innerText read.',
  },
  'e2e/live-sweep/sweep.mjs :: إعلان': {
    count: 3,
    reason: 'The same city-suggestion-row idiom as guardian/harness.mjs, on ONE element, for the same '
      + 'reason: «إعلان»/«إعلانات» both mark a row that carries a listing count.',
  },
  'e2e/af-real-ui.mjs :: لقينا': {
    count: 1,
    reason: 'A settling WAIT, not a verdict: waitForFunction(results text «لقينا» OR validation «الرجاء»), '
      + '.catch()-ed, and the caller re-reads the real state afterwards. Any inflection («لقيناها») is an '
      + 'equally valid arrival signal, so the ambiguity cannot produce a wrong answer here.',
  },
};

// SHRINK-ONLY. Raising this is a deliberate, reviewed edit that must come with a registry reason.
// 8 = the four guardian sites + three live-sweep sites + one af-real-ui wait, all adjudicated above.
// The ninth site found on the day this barrier landed — run.mjs's `includes('أبحث عن')` — was FIXED,
// not registered, and is why the number is 8 rather than 9.
const AMBIGUOUS_CEILING = 8;

console.log('§1 ambiguous innerText substring oracles in e2e/, discovered against the product corpus');
{
  const corpus = productStringCorpus(join(ROOT, 'src'));
  // An empty corpus would make every check below vacuously green — the dark-barrier shape this repo
  // has been burned by. Fail CLOSED on it.
  check(`the product corpus is non-empty (${corpus.size} Arabic string literals in src/)`, corpus.size > 100);

  const sites = ambiguousSubstringSites(join(ROOT, 'e2e'), corpus);
  console.log(`  discovered: ${sites.length} ambiguous substring oracle(s)`);
  for (const s of sites) console.log(`    ${s.file} :: «${s.token}» also inside ${s.carriers.map((c) => `«${c}»`).join(', ')}`);

  const perKey = new Map<string, number>();
  for (const s of sites) {
    const key = `${s.file} :: ${s.token}`;
    perKey.set(key, (perKey.get(key) || 0) + 1);
  }
  for (const [key, n] of perKey) {
    const reg = ALLOWED[key];
    check(`${key} — its ${n} site(s) are registered with a reason`, !!reg && reg.count >= n);
    if (reg && reg.count < n) {
      console.error(`        registered for ${reg.count}, found ${n}: a NEW ambiguous oracle was added here`);
    }
  }
  check(`the ambiguous-oracle count is at or below its shrink-only ceiling (${sites.length} <= ${AMBIGUOUS_CEILING})`,
    sites.length <= AMBIGUOUS_CEILING);
  // A registry entry matching nothing is stale, and a stale ratchet reads better than reality — the
  // failure verify-every-rpc-call-is-bounded.ts turns RED for.
  for (const [key, reg] of Object.entries(ALLOWED)) {
    const n = perKey.get(key) || 0;
    check(`the registry entry for ${key} still describes ${reg.count} real call site(s) (not stale)`,
      n === reg.count);
    if (n !== reg.count) console.error(`        registered ${reg.count}, found ${n}`);
  }

  // THE DISCOVERY ITSELF MUST BE ALIVE. The token that caused this barrier is still in the product,
  // so the carrier lookup must still find it — otherwise §1 could be silently answering nothing.
  const carriers = ambiguousCarriers('بحث', corpus);
  check(`the product still carries «بحث» inside longer words, so §1 is asking a live question `
    + `(${carriers.map((c) => `«${c}»`).join(', ')})`, carriers.length >= 2);

  // ── §1b · MUTATIONS of the discovery ─────────────────────────────────────────────────────────
  mustCatch('a NEW ambiguous substring oracle, by re-running the real discovery over a synthetic corpus',
    ambiguousCarriers('بحث', new Set(['وأنا أبحث لك'])).length === 1);
  mustCatch('an oracle whose token is carried by a longer word in a DIFFERENT inflection',
    ambiguousCarriers('بحث', new Set(['ابحث الآن', 'نتائج البحث'])).length === 2);
  // The mirror image, which is what keeps §1 from becoming a blanket ban: a token standing alone as
  // its own word, separated by space/punctuation/guillemets, is NOT ambiguous and must not be flagged.
  check('a token that is its own WORD is not flagged («ابدأ بحث جديد», «عرض المزيد»)',
    ambiguousCarriers('بحث', new Set(['ابدأ بحث جديد', '«بحث»'])).length === 0
    && ambiguousCarriers('عرض المزيد', new Set(['«عرض المزيد»', 'عرض المزيد'])).length === 0);
  check('a non-Arabic token is out of scope (an English substring check is not this class)',
    ambiguousCarriers('search', new Set(['research', 'searching'])).length === 0);

  // ── §1c · THE REAL DISCOVERY, over the REAL pre-fix text, re-executed every run ───────────────
  // The mutations above exercise the carrier rule on synthetic corpora. These run the whole §1
  // pipeline — walk, comment-strip, extract, adjudicate against the product's own strings — over a
  // throwaway tree holding the ACTUAL lines this change repaired. Without this, the proof that the
  // barrier would have caught the defect is a sentence in a merged PR body (ops_incident #728's shape).
  const tmp = mkdtempSync(join(tmpdir(), 'ezhalah-screen-identity-'));

  // The four oracles as they stood before this change, verbatim.
  writeFileSync(join(tmp, 'prefix.mjs'), [
    "  if (!text.includes('بحث')) defect(name, 'missing primary control', 'not rendered');",
    "  else if (!text.includes('بحث')) defect(name, 'Back landed off-route', 'no Filter home controls');",
    "  else if (!t.includes('بحث')) defect(name, 'controls missing after backgrounding', 'no control');",
    "  const leaked = t.includes('أبحث عن') && ['جدة'].some((c) => t.includes(c));",
  ].join('\n'));
  const prefix = ambiguousSubstringSites(tmp, corpus);
  mustCatch('the three blind «بحث» screen oracles this change replaced',
    prefix.filter((x) => x.token === 'بحث').length === 3);
  mustCatch("adv-newchat-mid-restore's «أبحث عن» leak oracle, which the product's own greeting carries",
    prefix.filter((x) => x.token === 'أبحث عن').length === 1);
  mustCatch('none of the four is registered, so each would have been a FAIL',
    prefix.every((x) => !ALLOWED[`${relative(ROOT, join(tmp, 'prefix.mjs'))} :: ${x.token}`]));

  // A brand-new file nobody registered: discovery is by shape, so tomorrow's probe is RED on arrival.
  writeFileSync(join(tmp, 'brand-new-probe.mjs'), "if (txt.includes('بحث')) ok();\n");
  mustCatch('a NEW ambiguous oracle in a file that has never been registered',
    ambiguousSubstringSites(tmp, corpus).some((x) => x.file.endsWith('brand-new-probe.mjs')));

  // And the mirror: a comment QUOTING the forbidden call must not be flagged, or the next author
  // deletes the explanation instead of the call (the sibling barrier's stated reason).
  writeFileSync(join(tmp, 'only-a-comment.mjs'), "// the old line was text.includes('بحث') and it was blind\n");
  check('a comment quoting the forbidden call is NOT flagged',
    !ambiguousSubstringSites(tmp, corpus).some((x) => x.file.endsWith('only-a-comment.mjs')));

  rmSync(tmp, { recursive: true, force: true });
}

// ═══ §2 · the REAL replacement predicate, EXECUTED against the four measured shapes ══════════════

console.log('§2 filterHomeVerdict discriminates the shapes measured on production');
{
  const HOME = { exactSearchNodes: 1, cityInputs: 1, bodyLength: 1197 };          // measured, desktop1440
  const HOME_375 = { exactSearchNodes: 1, cityInputs: 1, bodyLength: 954 };       // measured, mobile375
  const AGENT = { exactSearchNodes: 0, cityInputs: 0, bodyLength: 678 };          // measured, desktop1440
  const AGENT_375 = { exactSearchNodes: 0, cityInputs: 0, bodyLength: 406 };      // measured, mobile375
  const HOME_NO_BUTTON = { exactSearchNodes: 0, cityInputs: 1, bodyLength: 1197 };// measured, DOM mutant
  const BLANK = { exactSearchNodes: 0, cityInputs: 0, bodyLength: 12 };

  check('the real Filter home is `home` (desktop and mobile)',
    filterHomeVerdict(HOME) === 'home' && filterHomeVerdict(HOME_375) === 'home');
  check('the real agent screen is `not-home` — the shape the substring oracle called a pass',
    filterHomeVerdict(AGENT) === 'not-home' && filterHomeVerdict(AGENT_375) === 'not-home');
  check('the Filter home with its primary control deleted is `home-missing-search-control`, '
    + 'NOT `not-home` — two different bugs, told apart',
    filterHomeVerdict(HOME_NO_BUTTON) === 'home-missing-search-control');
  check('a blank body is `blank`, judged before either element question',
    filterHomeVerdict(BLANK) === 'blank');
  // A blank page must be `blank` even when the markers somehow read present: the body floor is the
  // first question, so a half-rendered screen cannot be reported as a healthy home.
  check('the blank floor wins over the markers',
    filterHomeVerdict({ exactSearchNodes: 1, cityInputs: 1, bodyLength: 200 }) === 'blank');
  check('the verdict is total — every shape returns one of the four names',
    [HOME, HOME_375, AGENT, AGENT_375, HOME_NO_BUTTON, BLANK]
      .every((s) => ['home', 'not-home', 'home-missing-search-control', 'blank'].includes(filterHomeVerdict(s))));

  // ── §2b · MUTATIONS of the predicate ─────────────────────────────────────────────────────────
  // Each one re-implements a plausible wrong version and requires THIS section's assertions to fail
  // on it, re-executed every run rather than performed once by hand in a merged PR body.
  const substringOracle = (s: { bodyLength: number }) =>
    // The production defect: the answer comes from innerText carrying the token at all. Both the
    // agent screen and the button-less home do, so both are reported healthy.
    s.bodyLength > 200 ? 'home' : 'blank';
  mustCatch('reverting to the innerText-substring oracle, which calls the agent screen the Filter home',
    substringOracle(AGENT) !== filterHomeVerdict(AGENT));
  mustCatch('reverting to the innerText-substring oracle, which cannot see the deleted control',
    substringOracle(HOME_NO_BUTTON) !== filterHomeVerdict(HOME_NO_BUTTON));

  const twoValued = (s: { exactSearchNodes: number; cityInputs: number; bodyLength: number }) =>
    s.bodyLength > 200 ? (s.exactSearchNodes > 0 && s.cityInputs > 0 ? 'home' : 'not-home') : 'blank';
  mustCatch('collapsing the verdict to two values, which reports a missing CONTROL as a wrong SCREEN',
    twoValued(HOME_NO_BUTTON) !== filterHomeVerdict(HOME_NO_BUTTON));

  const cityOnly = (s: { cityInputs: number; bodyLength: number }) =>
    s.bodyLength > 200 ? (s.cityInputs > 0 ? 'home' : 'not-home') : 'blank';
  mustCatch('deciding on the city input alone, so the missing primary control is invisible again',
    cityOnly(HOME_NO_BUTTON) !== filterHomeVerdict(HOME_NO_BUTTON));

  const searchOnly = (s: { exactSearchNodes: number; bodyLength: number }) =>
    s.bodyLength > 200 ? (s.exactSearchNodes > 0 ? 'home' : 'not-home') : 'blank';
  mustCatch('deciding on the label alone, which cannot tell the home from any screen that grew a «بحث» button',
    searchOnly(HOME_NO_BUTTON) !== filterHomeVerdict(HOME_NO_BUTTON));
}

// ═══ §3 · the three repaired call sites really route through the predicate ═══════════════════════
//
// Not a spelling check on a comment: the point is that no journey is left deciding screen identity
// for itself. §1 already makes the ambiguous SHAPE impossible; this asserts the replacement is the
// thing actually wired in, so a future edit cannot quietly go back to reading innerText.
console.log('§3 the journeys that decide screen identity route through the shared predicate');
{
  const run = readFileSync(join(ROOT, 'e2e/journeys/run.mjs'), 'utf8');
  const code = run.split('\n').filter((l) => !isCommentLine(l)).join('\n');
  check('run.mjs imports filterHomeState/filterHomeWhy from the harness',
    /filterHomeState/.test(code) && /filterHomeWhy/.test(code));
  for (const journey of ['cold-open', 'back-after-search', 'adv-background-tab']) {
    const start = code.indexOf(`JOURNEYS['${journey}']`);
    check(`${journey} is still registered`, start > 0);
    if (start < 0) continue;
    const next = code.indexOf("JOURNEYS['", start + 10);
    const body = code.slice(start, next < 0 ? code.length : next);
    check(`${journey} asks filterHomeState for its screen verdict`, /filterHomeState\(/.test(body));
  }
  // The fourth repaired site: adv-newchat-mid-restore must ask for a PAINTED, non-decoration leaf,
  // never for a page-wide substring — the product renders «أبحث عن» in its own greeting and in the
  // composer's aria-hidden rotating examples.
  {
    const start = code.indexOf("JOURNEYS['adv-newchat-mid-restore']");
    check('adv-newchat-mid-restore is still registered', start > 0);
    if (start > 0) {
      const next = code.indexOf("JOURNEYS['", start + 10);
      const body = code.slice(start, next < 0 ? code.length : next);
      check('adv-newchat-mid-restore asks paintedTextCarriers for the leaked bubble',
        /paintedTextCarriers\(/.test(body));
      check('adv-newchat-mid-restore no longer ANDs in the city conjunct that was measured always-true',
        !/\['جدة'/.test(body));
    }
  }
  const harness = readFileSync(join(ROOT, 'e2e/journeys/harness.mjs'), 'utf8');
  check('the harness reads the control by EXACT label, which is what makes «أبحث» not a «بحث» button',
    /getByText\(FILTER_HOME_SEARCH_LABEL,\s*\{\s*exact:\s*true\s*\}\)/.test(harness));
  check('the blank-body floor has ONE definition, used by settle() rather than retyped (PART 5 #14)',
    /BLANK_BODY_MAX,\s*\{\s*timeout\s*\}/.test(harness) && (harness.match(/BLANK_BODY_MAX = /g) || []).length === 1);
  check('paintedTextCarriers excludes decorations AND unpainted nodes, not just the word boundary',
    /aria-hidden="true"/.test(harness) && /getBoundingClientRect\(\)/.test(harness)
    && /r\.width < 1 \|\| r\.height < 1/.test(harness));
}

check('this barrier runs in npm test', npmTestRuns(ROOT, 'verify-screen-identity-is-an-element-not-a-substring'));

if (failed) { console.error(`\n${failed} check(s) failed\n`); process.exit(1); }
console.log('  PASS  screen identity is an element question, not an innerText substring');
