// Filter search → chat bubble: the OPENING rotates, nothing else does (owner rule 2026-09-18).
//
// Scope, verbatim from the owner: rotate ONLY the "ارحب إزهله 👋" opening of the bubble
// src/data/search.ts's filterToChat() builds when the user submits a Filter search — e.g.
// "ارحب إزهله 👋، أبحث عن عقار سكني للبيع في الخبر". Do NOT touch the filter-generated sentence
// after the opening; do NOT touch how filters/search work; do NOT touch the AI-chat's OWN greeting
// (agent.tsx's greetingText()) or the Advanced-Filter/interview bubble (interview.tsx); do NOT apply
// this rotation anywhere else. The rotation pool (100 AR + 100 EN rows) lives in Supabase
// (public.ui_filter_greetings / ui_filter_greetings_ar()) so it can be edited without a deploy — see
// supabase/migrations/20260918214451_ui_filter_greetings_rotation.sql.
//
// This barrier EXECUTES the real picker (src/data/filterGreetingRotation.ts) via its `__testing`
// seam — never a copy — and checks the surrounding scope by source shape, since the boundary itself
// (what must NOT change) is a text invariant, not a behavior.
//
//   node --experimental-strip-types scripts/verify-filter-greeting-rotation.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickFilterGreetingOpening, setFilterGreetingsCache, __testing } from '../src/data/filterGreetingRotation.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean, detail = '') =>
  check(`MUTATION — ${label}`, caught, detail);

console.log('\nFilter-search bubble opening rotates; the rest of the sentence never moves\n');

// ── 1. THE PICKER, EXECUTED — baked-in list must give a REAL rotation from search #1 ──────────────
// This is the whole point of the owner's 2026-09-19 rewrite: when a user opens the app and does
// their FIRST Filter search, they must already see a random one of the 100 openings, never the
// retired «ارحب إزهله 👋» text. The picker no longer has a fallback string — it uses the baked list
// at import time, so a fresh module import (i.e. a fresh session) is what's exercised right here.
check('the baked list carries the full owner-authored pool (100 rows)',
  __testing.BAKED.length === 100, `got ${__testing.BAKED.length}`);
check('every baked row has a non-empty greeting and emoji (no silent blanks in the picker output)',
  __testing.BAKED.every((r: { greeting: string; emoji: string }) => r.greeting && r.emoji));
check('no baked row leaks the retired "إزهله" brand word into the greeting half (safety against a bad edit)',
  __testing.BAKED.every((r: { greeting: string; emoji: string }) => !r.greeting.includes('إزهله')));
check('a fresh picker call already builds "{greeting} إزهله {emoji}، " from a REAL baked row (owner rule 2026-09-19: NO comma before the emoji — only after)',
  / إزهله [^ ]+، $/.test(pickFilterGreetingOpening())
  && !/، إزهله /.test(pickFilterGreetingOpening())
  && !pickFilterGreetingOpening().startsWith('ارحب إزهله'),
  `got: ${JSON.stringify(pickFilterGreetingOpening())}`);

// Server-side pool OVERRIDES the baked list when a non-empty one arrives.
setFilterGreetingsCache([{ greeting: 'هلا والله', emoji: '💚' }]);
check('a non-empty server pool OVERRIDES the baked list (editability without a deploy)',
  pickFilterGreetingOpening() === 'هلا والله إزهله 💚، ',
  `got: ${JSON.stringify(pickFilterGreetingOpening())}`);

// A FAILED / EMPTY fetch must NOT demote the working baked list back to nothing.
setFilterGreetingsCache([]);
check('an empty server response NEVER demotes the working baked list — the last-good pool stays',
  pickFilterGreetingOpening() === 'هلا والله إزهله 💚، ',
  `got: ${JSON.stringify(pickFilterGreetingOpening())}`);
setFilterGreetingsCache(null);
check('a NULL server response NEVER demotes the working baked list either',
  pickFilterGreetingOpening() === 'هلا والله إزهله 💚، ');

// EXECUTED over many picks: with 2+ distinct rows, no two consecutive picks are identical.
setFilterGreetingsCache([
  { greeting: 'هلا', emoji: '👋' },
  { greeting: 'أهلين', emoji: '🌟' },
  { greeting: 'حياك', emoji: '😎' },
]);
{
  const picks = Array.from({ length: 500 }, () => pickFilterGreetingOpening());
  const backToBack = picks.some((p, i) => i > 0 && p === picks[i - 1]);
  check('500 consecutive picks from a 3-row pool never repeat back-to-back',
    !backToBack, 'a pick equalled the one immediately before it');
  const distinctSeen = new Set(picks).size;
  check('the rotation actually visits more than one row over 500 picks (not stuck on one)',
    distinctSeen > 1, `distinct openings seen: ${distinctSeen}`);
}

// A single-row pool can never satisfy "never repeat" by definition — must still return that ONE
// row's opening every time, not fall back.
setFilterGreetingsCache([{ greeting: 'مرحبا', emoji: '😊' }]);
check('a single-row pool still returns that row\'s opening on every call (no crash, no fallback)',
  Array.from({ length: 5 }, () => pickFilterGreetingOpening()).every((p) => p === 'مرحبا إزهله 😊، '));

// ── 2. THE MIGRATION — the deployable artifact itself ───────────────────────────────────────────
const migration = read('supabase/migrations/20260918214451_ui_filter_greetings_rotation.sql');
check('the migration creates the rotation table', /create table public\.ui_filter_greetings\s*\(/.test(migration));
check('the migration creates the anon-callable RPC the picker actually calls',
  /create or replace function public\.ui_filter_greetings_ar\(\)/.test(migration)
  && /grant execute on function public\.ui_filter_greetings_ar\(\) to anon, authenticated;/.test(migration));
check('the migration RPC is security definer with an explicit search_path (schema-hijack safe)',
  /security definer\s*\nset search_path = public/.test(migration));
const arCount = (migration.match(/\n {2}\('ar', \d+, /g) ?? []).length;
const enCount = (migration.match(/\n {2}\('en', \d+, /g) ?? []).length;
check('exactly 100 Arabic rows are seeded (the live rotation pool)', arCount === 100, `saw ${arCount}`);
check('exactly 100 English rows are seeded (stored for future English support, per owner instruction)',
  enCount === 100, `saw ${enCount}`);

// The BAKED list must equal the migration's AR rows in the SAME order — otherwise the code shipped
// and the server-edited-copy shipped different pools, and a user could see two different rotations
// depending on whether the RPC has resolved yet.
{
  const arRowsRe = /\n {2}\('ar', \d+, '([^']*)', '([^']*)'\)/g;
  const arRows: { greeting: string; emoji: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = arRowsRe.exec(migration)) !== null) arRows.push({ greeting: m[1], emoji: m[2] });
  const bakedJson = JSON.stringify(__testing.BAKED);
  const migJson = JSON.stringify(arRows);
  check('the BAKED list equals the migration\'s AR rows, byte-for-byte, in order (mirror can never drift)',
    bakedJson === migJson,
    bakedJson === migJson ? '' : `first differing index shape: BAKED[0]=${JSON.stringify(__testing.BAKED[0])} mig[0]=${JSON.stringify(arRows[0])}`);
}

// ── 2b. THE FETCH SIDE — loaderFilterGreetings.ts, checked by SHAPE (never imported directly: it
// pulls in @/lib/supabase, which does not resolve under a plain-Node barrier run — the exact reason
// loaderActivePlatforms.ts is split from loaderPlatforms.ts in the first place). ─────────────────
const loaderSrc = read('src/data/loaderFilterGreetings.ts');
check('the loader calls the real RPC the migration grants anon execute on',
  /supabase\.rpc\('ui_filter_greetings_ar'\)/.test(loaderSrc));
check('the loader pushes into the SAME pure cache the picker reads (setFilterGreetingsCache)',
  /setFilterGreetingsCache\(/.test(loaderSrc));
check('a failed/missing-client fetch pushes [] (falls back), never leaves the cache null forever',
  /setFilterGreetingsCache\(\[\]\)/.test(loaderSrc));
check('primeFilterGreetings is idempotent — it no-ops once a fetch has started or resolved',
  /if \(hasFilterGreetingsCache\(\) \|\| inFlight\) return;/.test(loaderSrc));

// ── 3. WIRING — filterToChat() actually uses BOTH halves, in the SAME t() call ───────────────────
const searchSrc = read('src/data/search.ts');
check('search.ts imports the real picker (not a re-derived local rule)',
  /import \{ pickFilterGreetingOpening \} from '\.\/filterGreetingRotation';/.test(searchSrc));
check('search.ts imports the real loader (primes the pool it reads from)',
  /import \{ primeFilterGreetings \} from '\.\/loaderFilterGreetings';/.test(searchSrc));
check('filterToChat() still primes the server pool (so a live DB edit reaches users without a deploy)',
  /primeFilterGreetings\(\);/.test(searchSrc));
{
  const callStart = searchSrc.indexOf("t(\"I'm looking for {what}{detail} {verb} in {place}{price}\", {");
  const callEnd = callStart >= 0 ? searchSrc.indexOf('});', callStart) : -1;
  const call = callStart >= 0 && callEnd >= 0 ? searchSrc.slice(callStart, callEnd) : '';
  check('the SAME t() call that builds the bubble passes opening: pickFilterGreetingOpening()',
    /opening: pickFilterGreetingOpening\(\),/.test(call), `call site: ${call ? 'found, but missing the param' : 'not found'}`);
}

// ── 4. THE BOUNDARY — everything the owner said NOT to touch, still untouched ────────────────────
const i18nSrc = read('src/i18n.tsx');
check('the Arabic template still reads "أبحث عن {what}{detail} {verb} في {place}{price}" — the filter-generated sentence is byte-identical after the opening',
  i18nSrc.includes("'{opening}أبحث عن {what}{detail} {verb} في {place}{price}',"));
check('the retired hardcoded "ارحب إزهله 👋، أبحث عن" one-piece prefix is gone from the template (it is now data, not a literal)',
  !i18nSrc.includes("'ارحب إزهله 👋، أبحث عن"));
check('the English key text is untouched (no {opening} added there — English still has no greeting prefix, per owner instruction not to wire English in yet)',
  i18nSrc.includes('"I\'m looking for {what}{detail} {verb} in {place}{price}": \'{opening}'));

const agentSrc = read('src/app/agent.tsx');
check('the SEPARATE AI-chat opening greeting (agent.tsx greetingText) is byte-exact untouched — this rotation must never touch it',
  agentSrc.includes("'ارحب، أنا إزهله. قلّي وش العقار اللي تدور عليه، وأنا أبحث لك بين المنصات العقارية وأطابق الخيارات مع طلبك لين نلقى اللي يناسبك… إزهلها وفالك الطيب.'"));
check('filterGreetingRotation is never imported by agent.tsx — the rotation has exactly one call site',
  !agentSrc.includes('filterGreetingRotation'));

const interviewSrc = read('src/app/interview.tsx');
check('the Advanced-Filter/interview bubble never imports the rotation — owner said apply this nowhere else',
  !interviewSrc.includes('filterGreetingRotation') && !interviewSrc.includes('pickFilterGreetingOpening'));

// ── 5. MUTATION PROOFS ────────────────────────────────────────────────────────────────────────────
// M-no-antirepeat: an immediate-repeat picker (always index 0) — the "never repeat back-to-back"
// check above must be the thing that actually catches this, proving it is not vacuous.
{
  const brokenPicks = Array.from({ length: 50 }, () => 'هلا إزهله 👋، '); // simulates a picker stuck on row 0
  const backToBack = brokenPicks.some((p, i) => i > 0 && p === brokenPicks[i - 1]);
  mustCatch('a picker stuck returning the same row every time is caught by the no-repeat check',
    backToBack);
}
// M-reverted-prefix: the OLD hardcoded one-piece opening, reintroduced — the boundary check must
// flag it as the retired literal still being present.
{
  const mutated = i18nSrc.replace(
    "'{opening}أبحث عن {what}{detail} {verb} في {place}{price}',",
    "'ارحب إزهله 👋، أبحث عن {what}{detail} {verb} في {place}{price}',",
  );
  mustCatch('reverting to the old hardcoded prefix is caught (the retired-literal check goes red)',
    mutated.includes("'ارحب إزهله 👋، أبحث عن"));
}
// M-shrunk-baked: the baked list is what makes a fresh session rotate from search #1 — a mutant that
// silently ships an empty list would put the picker back where the old fallback line used to be.
mustCatch('an empty baked list would leave the picker with nothing to rotate on — caught',
  __testing.BAKED.length > 0);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the greeting rotation drifted from the owner's exact scope.\n`);
  process.exit(1);
}
console.log('\n✓ only the Filter-bubble opening rotates; the filter sentence, the AI-chat greeting, and the AF interview bubble are all untouched\n');
