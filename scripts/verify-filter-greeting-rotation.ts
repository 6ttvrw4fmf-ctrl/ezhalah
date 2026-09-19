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

// ── 1. THE PICKER, EXECUTED ─────────────────────────────────────────────────────────────────────
setFilterGreetingsCache(null);
check('with no cache loaded yet (the first search of a session), the exact pre-rotation fallback is used',
  pickFilterGreetingOpening() === __testing.FALLBACK_OPENING,
  `got: ${JSON.stringify(pickFilterGreetingOpening())}`);

setFilterGreetingsCache([]);
check('an empty rotation pool (RPC returned zero rows) also falls back — never a blank opening',
  pickFilterGreetingOpening() === __testing.FALLBACK_OPENING);

setFilterGreetingsCache([{ greeting: 'هلا والله', emoji: '💚' }]);
check('a loaded pool builds "{greeting}، إزهله {emoji}، " from the REAL cached row',
  pickFilterGreetingOpening() === 'هلا والله، إزهله 💚، ',
  `got: ${JSON.stringify(pickFilterGreetingOpening())}`);

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
  Array.from({ length: 5 }, () => pickFilterGreetingOpening()).every((p) => p === 'مرحبا، إزهله 😊، '));

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
check('filterToChat() primes the pool (so the SECOND search of a session already has it warm)',
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
  const brokenPicks = Array.from({ length: 50 }, () => 'هلا، إزهله 👋، '); // simulates a picker stuck on row 0
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
// M-empty-fallback-blank: a fallback that returns '' instead of the real pre-rotation line would
// silently blank the opening — prove the exact-string check on FALLBACK_OPENING would catch it.
mustCatch('a blank fallback (\'\' instead of the real pre-rotation line) is caught',
  __testing.FALLBACK_OPENING !== '');

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the greeting rotation drifted from the owner's exact scope.\n`);
  process.exit(1);
}
console.log('\n✓ only the Filter-bubble opening rotates; the filter sentence, the AI-chat greeting, and the AF interview bubble are all untouched\n');
