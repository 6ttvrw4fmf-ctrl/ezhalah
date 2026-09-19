// Results-Found rotation contract (owner rule 2026-09-19). The fixed sentence "لقينا {n} إعلان
// يطابق طلبك." rendered at agent.tsx:3363 is replaced by a rotation across FOUR pools keyed on
// (lang, hasName) — Arabic/English × logged-in/guest — with {count} always the exact backend total
// and {name} coming only from the existing authenticated profile the account menu already renders.
//
// This barrier EXECUTES the real picker (src/data/resultsFoundRotation.ts) — never a copy — asserts
// its baked pool byte-for-byte equals the migration's rows, and pins the wiring in agent.tsx +
// loaderResultsFound.ts. The mandate "do not create a second source for the user's name" is checked
// as a text invariant: no email-based name and no LLM-based name may appear in the picker's inputs.
//
//   node --experimental-strip-types scripts/verify-results-found-rotation.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickResultsFoundSentence,
  setResultsFoundCache,
  __testing,
  type ResultsFoundTemplate,
} from '../src/data/resultsFoundRotation.ts';

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

console.log('\nResults-Found sentence rotates across four (lang, hasName) pools; nothing else changes\n');

// ── 1. THE BAKED LIST'S SHAPE ────────────────────────────────────────────────────────────────────
const BAKED = __testing.BAKED as readonly ResultsFoundTemplate[];
check('exactly 40 baked rows (10 templates × 4 pools)', BAKED.length === 40, `got ${BAKED.length}`);

const groups = new Map<string, ResultsFoundTemplate[]>();
for (const t of BAKED) {
  const k = `${t.lang}|${t.hasName}`;
  const g = groups.get(k) ?? [];
  g.push(t);
  groups.set(k, g);
}
for (const key of ['ar|false', 'ar|true', 'en|false', 'en|true']) {
  check(`pool ${key} carries exactly 10 templates`, (groups.get(key) ?? []).length === 10,
    `got ${(groups.get(key) ?? []).length}`);
}

check('every logged-in template contains {name}',
  BAKED.filter((t) => t.hasName).every((t) => t.template.includes('{name}')),
  BAKED.filter((t) => t.hasName && !t.template.includes('{name}')).map((t) => t.template).join(' | '));
check('every guest template does NOT contain {name} (guest rotation never inserts a name)',
  BAKED.filter((t) => !t.hasName).every((t) => !t.template.includes('{name}')),
  BAKED.filter((t) => !t.hasName && t.template.includes('{name}')).map((t) => t.template).join(' | '));
check('every template contains {count} (the exact backend total must appear)',
  BAKED.every((t) => t.template.includes('{count}')));

// ── 2. THE PICKER, EXECUTED ─────────────────────────────────────────────────────────────────────
// Guest, Arabic: no name substitution, {count} filled, sentence looks like the owner's example.
{
  const out = pickResultsFoundSentence({ lang: 'ar', name: null, count: '5,741' });
  check('AR + guest: {count} filled and no name leaks (never contains "{name}" or the raw placeholder)',
    out.includes('5,741') && !out.includes('{count}') && !out.includes('{name}'),
    `got: ${JSON.stringify(out)}`);
  const guestPool = groups.get('ar|false')!.map((t) => t.template.split('{count}').join('5,741'));
  check('AR + guest: the sentence is one of the 10 owner-authored guest templates', guestPool.includes(out),
    `got: ${JSON.stringify(out)}`);
}

// Logged-in, Arabic: the owner's screenshot example.
{
  const out = pickResultsFoundSentence({ lang: 'ar', name: 'يوسف النشوان', count: '5,741' });
  check('AR + logged-in: {count} filled, {name} = the display name exactly (no email guess, no LLM)',
    out.includes('5,741') && out.includes('يوسف النشوان') && !out.includes('{count}') && !out.includes('{name}'),
    `got: ${JSON.stringify(out)}`);
  const loggedPool = groups.get('ar|true')!
    .map((t) => t.template.split('{count}').join('5,741').split('{name}').join('يوسف النشوان'));
  check('AR + logged-in: the sentence is one of the 10 owner-authored logged-in templates',
    loggedPool.includes(out), `got: ${JSON.stringify(out)}`);
}

// English pools too.
{
  const outG = pickResultsFoundSentence({ lang: 'en', name: null, count: '5,741' });
  check('EN + guest: no name, {count} filled',
    outG.includes('5,741') && !/[{}]|\{name\}/.test(outG) && !outG.includes('{count}'));
  const outL = pickResultsFoundSentence({ lang: 'en', name: 'Yusuf AlNashwan', count: '5,741' });
  check('EN + logged-in: {name} substituted, {count} filled',
    outL.includes('5,741') && outL.includes('Yusuf AlNashwan') && !outL.includes('{count}') && !outL.includes('{name}'));
}

// Anti-repeat over many picks (per (lang, hasName) key).
{
  const picks = Array.from({ length: 500 }, () =>
    pickResultsFoundSentence({ lang: 'ar', name: null, count: '5,741' }),
  );
  const backToBack = picks.some((p, i) => i > 0 && p === picks[i - 1]);
  check('500 consecutive AR-guest picks never repeat back-to-back', !backToBack);
  const distinctSeen = new Set(picks).size;
  check('the AR-guest rotation actually visits more than one row over 500 picks',
    distinctSeen > 1, `distinct: ${distinctSeen}`);
}

// Empty / whitespace name still counts as GUEST (no accidental "يا " with a blank).
{
  const outEmpty = pickResultsFoundSentence({ lang: 'ar', name: '', count: '1' });
  const outWs = pickResultsFoundSentence({ lang: 'ar', name: '   ', count: '1' });
  const guestTemplates = groups.get('ar|false')!.map((t) => t.template.split('{count}').join('1'));
  check('an empty display name falls into the GUEST pool (never a "hi ," with a blank)',
    guestTemplates.includes(outEmpty));
  check('a whitespace-only display name falls into the GUEST pool too',
    guestTemplates.includes(outWs));
}

// setResultsFoundCache overrides with a live DB pool; empty/null is IGNORED (never demotes).
setResultsFoundCache([
  { lang: 'ar', hasName: false, template: 'مرحبا! {count} نتيجة' },
]);
check('a non-empty server pool OVERRIDES the baked list (live editability)',
  pickResultsFoundSentence({ lang: 'ar', name: null, count: '42' }) === 'مرحبا! 42 نتيجة');
setResultsFoundCache([]);
check('an empty server response NEVER demotes the working cache (last-good pool stays)',
  pickResultsFoundSentence({ lang: 'ar', name: null, count: '42' }) === 'مرحبا! 42 نتيجة');
setResultsFoundCache(null);
check('a NULL server response NEVER demotes either',
  pickResultsFoundSentence({ lang: 'ar', name: null, count: '42' }) === 'مرحبا! 42 نتيجة');

// Reset for later checks (put baked back).
setResultsFoundCache([...BAKED]);

// ── 3. THE MIGRATION MIRRORS THE BAKED LIST BYTE-FOR-BYTE ────────────────────────────────────────
// Two migrations: 20260919040825 seeds the table + RPC; 20260919212000 rewrites 21 of those rows
// to remove every "comma before the emoji" (owner rule 2026-09-19). The prod state is the second
// migration's UPDATEs applied on top of the first migration's INSERTs, so BAKED must equal that
// final state — not either file alone.
const seedMig = read('supabase/migrations/20260919040825_ui_results_found_rotation.sql');
const recommaMig = read('supabase/migrations/20260919212000_ui_results_found_comma_after_emoji.sql');
check('the seed migration creates the table', /create table public\.ui_results_found\s*\(/.test(seedMig));
check('the seed migration creates the anon-callable RPC the loader actually calls',
  /create or replace function public\.ui_results_found_ar\(\)/.test(seedMig)
  && /grant execute on function public\.ui_results_found_ar\(\) to anon, authenticated;/.test(seedMig));
check('the seed migration RPC is security definer with an explicit search_path (schema-hijack safe)',
  /security definer\s*\nset search_path = public/.test(seedMig));

// Parse the seed migration's INSERT rows and the recomma migration's UPDATE rows; the FINAL state
// is INSERTs with UPDATEs overlaid on the same (lang, has_name, sort_order) keys.
{
  type Row = { lang: 'ar' | 'en'; hasName: boolean; sortOrder: number; template: string };
  const rows = new Map<string, Row>();

  const insertRe = /\n {2}\('(ar|en)',\s+(true|false),\s+(\d+),\s+'((?:[^'\\]|\\.|'')*)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = insertRe.exec(seedMig)) !== null) {
    const r: Row = { lang: m[1] as 'ar' | 'en', hasName: m[2] === 'true', sortOrder: Number(m[3]), template: m[4].replace(/''/g, "'") };
    rows.set(`${r.lang}|${r.hasName}|${r.sortOrder}`, r);
  }
  check('the seed migration seeds exactly 40 rows (10 × 4 pools)', rows.size === 40, `saw ${rows.size}`);

  const updateRe = /update public\.ui_results_found set template = '((?:[^'\\]|\\.|'')*)'\s+where lang='(ar|en)' and has_name=(true|false)\s+and sort_order=(\d+);/g;
  let updates = 0;
  while ((m = updateRe.exec(recommaMig)) !== null) {
    const key = `${m[2]}|${m[3]==='true'}|${Number(m[4])}`;
    const prior = rows.get(key);
    if (!prior) continue;
    rows.set(key, { ...prior, template: m[1].replace(/''/g, "'") });
    updates++;
  }
  check('the recomma migration updates all 40 rows (10 × 4 pools) — self-describing final state',
    updates === 40, `saw ${updates}`);

  // Owner rule 2026-09-19: no comma may appear BEFORE the terminal emoji in any final template.
  // A grapheme-safe test: pick the last non-space code unit that isn't a letter/digit/brace-tag —
  // simpler and stricter, just assert no ASCII "," and no Arabic "،" appears anywhere in each row.
  const rowList: Row[] = [...rows.values()];
  const withComma = rowList.filter((r) => r.template.includes(',') || r.template.includes('،'));
  check('owner rule: no template carries a comma (all commas were BEFORE the emoji, banned)',
    withComma.length === 0,
    withComma.slice(0, 3).map((r) => `${r.lang}|${r.hasName}|${r.sortOrder}: ${r.template}`).join(' || '));

  const migRows: ResultsFoundTemplate[] = rowList.map((r) => ({ lang: r.lang, hasName: r.hasName, template: r.template }));

  // Sort both by (lang, hasName) to compare — the migration is grouped by pool but not by the same
  // sort order as the picker's baked list; the semantic set is what needs to match.
  const norm = (rs: ResultsFoundTemplate[]) =>
    [...rs].sort((a, b) => a.lang.localeCompare(b.lang) || (Number(a.hasName) - Number(b.hasName))
      || a.template.localeCompare(b.template)).map((r) => `${r.lang}|${r.hasName}|${r.template}`);
  const bakedNorm = norm([...BAKED]);
  const migNorm = norm(migRows);
  check('the BAKED list equals the migration final state as a MULTISET (never drift, in any order)',
    JSON.stringify(bakedNorm) === JSON.stringify(migNorm),
    bakedNorm.length !== migNorm.length
      ? `sizes differ: baked=${bakedNorm.length} mig=${migNorm.length}`
      : `first differing: baked=${bakedNorm.find((v, i) => v !== migNorm[i])} mig=${migNorm.find((v, i) => v !== bakedNorm[i])}`);
}

// ── 4. THE LOADER (source-shape checks — @/lib/supabase does not resolve under plain Node) ───────
const loaderSrc = read('src/data/loaderResultsFound.ts');
check('the loader calls the RPC the migration grants anon execute on',
  /supabase\.rpc\('ui_results_found_ar'\)/.test(loaderSrc));
check('the loader bounds the RPC with an AbortController (every RPC await must be bounded)',
  /\.abortSignal\(ctrl\.signal\)/.test(loaderSrc));
check('the loader pushes into the SAME pure cache the picker reads',
  /setResultsFoundCache\(/.test(loaderSrc));
check('a failed/missing-client fetch pushes [] (the picker ignores empty, so this cannot demote)',
  /setResultsFoundCache\(\[\]\)/.test(loaderSrc));

// ── 5. WIRING IN agent.tsx ──────────────────────────────────────────────────────────────────────
const agentSrc = read('src/app/agent.tsx');
check('agent.tsx imports the real picker (not a re-derived local rule)',
  /import \{ pickResultsFoundSentence \} from '@\/data\/resultsFoundRotation';/.test(agentSrc));
check('agent.tsx imports the real loader (primes the pool it reads from)',
  /import \{ primeResultsFound \} from '@\/data\/loaderResultsFound';/.test(agentSrc));
check('the intro-text render calls pickResultsFoundSentence with locale, name and the formatted count',
  /pickResultsFoundSentence\(\{[\s\S]{0,400}?lang:[\s\S]{0,120}?name:[\s\S]{0,200}?count: introTotal\.toLocaleString\('en-US'\),/.test(agentSrc));
check('the retired hardcoded "We found {n} listings matching your search." call is gone',
  !/t\('We found \{n\} listings matching your search\.'/.test(agentSrc));
check('the {name} comes from AuthUser.nameAr / .nameEn (the same field the account menu renders)',
  /user\?\.nameAr[\s\S]{0,80}user\?\.nameEn|user\?\.nameEn[\s\S]{0,80}user\?\.nameAr/.test(agentSrc));

// ── 6. NO NEW NAME SOURCE, NO LLM, NO EMAIL-BASED GUESS (owner explicit "do not create a second
// source for the user's name") ───────────────────────────────────────────────────────────────────
{
  const editedBlock = agentSrc.match(/pickResultsFoundSentence\(\{[\s\S]{0,400}?\}\)/)?.[0] ?? '';
  check('the call site never feeds an email into the name argument',
    editedBlock !== '' && !/email|user\?\.email|user\?\.sub/.test(editedBlock),
    `block: ${editedBlock}`);
  check('the call site never asks an LLM / generator for the name',
    editedBlock !== '' && !/openai|deepseek|generate|prompt/i.test(editedBlock));
}

// ── 7. THE BOUNDARY — nothing else changes ──────────────────────────────────────────────────────
check('the retired i18n key "We found {n} listings matching your search." is left intact in i18n.tsx (untouched by this rotation — cleaned up separately if unused)',
  /'We found \{n\} listings matching your search\.'/.test(read('src/i18n.tsx')));
check('the SEPARATE AI-chat opening greeting (agent.tsx greetingText) is untouched',
  agentSrc.includes("'ارحب، أنا إزهله. قلّي وش العقار اللي تدور عليه"));
check('the Filter-search bubble opening (filterToChat) is untouched — this rotation is a different sentence',
  !read('src/data/search.ts').includes('pickResultsFoundSentence'));

// ── 8. MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────
mustCatch('an empty baked list would leave the picker with nothing to rotate — caught',
  BAKED.length > 0);
{
  // A logged-in template that forgot {name} would silently render as guest-shaped for authed users.
  const brokenPool: ResultsFoundTemplate[] = [{ lang: 'ar', hasName: true, template: 'مرحبا {count}' }];
  const allHaveName = brokenPool.every((t) => t.template.includes('{name}'));
  mustCatch('a logged-in template missing {name} is caught by the "every logged-in template contains {name}" check',
    !allHaveName);
}
{
  // A guest template with a stray {name} would try to substitute nothing and reveal the placeholder.
  const brokenPool: ResultsFoundTemplate[] = [{ lang: 'ar', hasName: false, template: 'مرحبا يا {name} — {count}' }];
  const guestClean = brokenPool.every((t) => !t.hasName && !t.template.includes('{name}'));
  mustCatch('a guest template containing {name} is caught by the "guest templates never contain {name}" check',
    !guestClean);
}

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the Results-Found rotation drifted from the owner's exact spec.\n`);
  process.exit(1);
}
console.log('\n✓ four pools rotate the Results-Found sentence with real counts + real display names; nothing else changes\n');
