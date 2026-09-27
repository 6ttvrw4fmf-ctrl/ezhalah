// No-Results rotation contract (owner rule 2026-09-26). noResultsSuggestion() in src/data/search.ts
// has ~9 branches; 8 give an EARNED, specific diagnosis (empty district, price too narrow, wrong
// type, empty city, "did you mean X") and are untouched. Only its LAST branch — the true generic
// catch-all, tagged by the exported NO_RESULTS_GENERIC_FALLBACK_EN key — becomes a rotation across
// FOUR pools keyed on (lang, hasName), 20 owner-authored templates each.
//
// This barrier EXECUTES the real picker (src/data/noResultsRotation.ts) — never a copy — and pins
// the wiring in agent.tsx, following the same shape verify-results-found-rotation.ts already proved
// for the sibling "found results" rotation.
//
//   node --experimental-strip-types scripts/verify-no-results-rotation.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickNoResultsSentence, __testing, type NoResultsTemplate } from '../src/data/noResultsRotation.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

console.log('\nNo-Results sentence rotates across four (lang, hasName) pools; the other 8 diagnoses are untouched\n');

// ── 1. THE BAKED LIST'S SHAPE ────────────────────────────────────────────────────────────────────
const BAKED = __testing.BAKED as readonly NoResultsTemplate[];
check('exactly 80 baked rows (20 templates × 4 pools)', BAKED.length === 80, `got ${BAKED.length}`);

const groups = new Map<string, NoResultsTemplate[]>();
for (const tpl of BAKED) {
  const k = `${tpl.lang}|${tpl.hasName}`;
  const g = groups.get(k) ?? [];
  g.push(tpl);
  groups.set(k, g);
}
for (const key of ['ar|false', 'ar|true', 'en|false', 'en|true']) {
  check(`pool ${key} carries exactly 20 templates`, (groups.get(key) ?? []).length === 20,
    `got ${(groups.get(key) ?? []).length}`);
}
check('no duplicate template text anywhere in the 80', new Set(BAKED.map((t) => t.template)).size === BAKED.length);

check('every logged-in template contains {name}',
  BAKED.filter((t) => t.hasName).every((t) => t.template.includes('{name}')),
  BAKED.filter((t) => t.hasName && !t.template.includes('{name}')).map((t) => t.template).join(' | '));
check('every guest template does NOT contain {name} (guest rotation never inserts a name)',
  BAKED.filter((t) => !t.hasName).every((t) => !t.template.includes('{name}')),
  BAKED.filter((t) => !t.hasName && t.template.includes('{name}')).map((t) => t.template).join(' | '));

// Owner rule: no comma may sit directly before the terminal emoji (comma ALWAYS after emoji, NEVER
// before — permanent, fleet-wide). Strip trailing pictographic/whitespace and check what's left.
const EMOJI_TAIL = /[\p{Extended_Pictographic}️\s]+$/u;
{
  const withCommaBeforeEmoji = BAKED.filter((tpl) => {
    const stripped = tpl.template.replace(EMOJI_TAIL, '');
    const lastChar = stripped.slice(-1);
    return lastChar === ',' || lastChar === '،';
  });
  check('no template has a comma directly before its terminal emoji (permanent fleet-wide rule)',
    withCommaBeforeEmoji.length === 0,
    withCommaBeforeEmoji.slice(0, 3).map((t) => t.template).join(' || '));
}

// ── 2. THE PICKER, EXECUTED ─────────────────────────────────────────────────────────────────────
{
  const out = pickNoResultsSentence({ lang: 'ar', name: null });
  check('AR + guest: no {name} leaks (never contains the raw placeholder)', !out.includes('{name}'),
    `got: ${JSON.stringify(out)}`);
  check('AR + guest: the sentence is one of the 20 owner-authored guest templates',
    groups.get('ar|false')!.some((t) => t.template === out), `got: ${JSON.stringify(out)}`);
}
{
  const out = pickNoResultsSentence({ lang: 'ar', name: 'يوسف النشوان' });
  check('AR + logged-in: {name} = the display name exactly (no email guess, no LLM)',
    out.includes('يوسف النشوان') && !out.includes('{name}'), `got: ${JSON.stringify(out)}`);
  check('AR + logged-in: the sentence is one of the 20 owner-authored logged-in templates',
    groups.get('ar|true')!.some((t) => t.template.split('{name}').join('يوسف النشوان') === out),
    `got: ${JSON.stringify(out)}`);
}
{
  const outG = pickNoResultsSentence({ lang: 'en', name: null });
  check('EN + guest: no name leaks', !outG.includes('{name}'));
  const outL = pickNoResultsSentence({ lang: 'en', name: 'Yusuf AlNashwan' });
  check('EN + logged-in: {name} substituted', outL.includes('Yusuf AlNashwan') && !outL.includes('{name}'));
}

// Anti-repeat over many picks (per (lang, hasName) key).
{
  const picks = Array.from({ length: 500 }, () => pickNoResultsSentence({ lang: 'ar', name: null }));
  const backToBack = picks.some((p, i) => i > 0 && p === picks[i - 1]);
  check('500 consecutive AR-guest picks never repeat back-to-back', !backToBack);
  check('the AR-guest rotation actually visits more than one row over 500 picks', new Set(picks).size > 1,
    `distinct: ${new Set(picks).size}`);
}

// stableKey pins the pick across repeat calls (same fix class as ops_incident #346 for resultsFound).
{
  const first = pickNoResultsSentence({ lang: 'ar', name: null, stableKey: 'msg-A' });
  const same40 = Array.from({ length: 40 }, () => pickNoResultsSentence({ lang: 'ar', name: null, stableKey: 'msg-A' }));
  check('a stableKey pins the pick across every repeat call for the SAME key (no mid-render flip)',
    same40.every((s) => s === first), `first=${first} distinct=${new Set(same40).size}`);
  const twenty = Array.from({ length: 20 }, (_, i) => pickNoResultsSentence({ lang: 'ar', name: null, stableKey: `msg-B-${i}` }));
  check('a DIFFERENT stableKey does its own fresh pick (per-message rotation, not global freeze)',
    new Set(twenty).size >= 2, `distinct: ${new Set(twenty).size}`);
}

// Empty / whitespace name still counts as GUEST.
{
  const outEmpty = pickNoResultsSentence({ lang: 'ar', name: '' });
  const outWs = pickNoResultsSentence({ lang: 'ar', name: '   ' });
  const guestTemplates = groups.get('ar|false')!.map((t) => t.template);
  check('an empty display name falls into the GUEST pool', guestTemplates.includes(outEmpty));
  check('a whitespace-only display name falls into the GUEST pool too', guestTemplates.includes(outWs));
}

// ── 3. THE BOUNDARY — search.ts stays pure; only the LAST branch is tagged ────────────────────────
const searchSrc = read('src/data/search.ts');
check('search.ts exports the untranslated generic-fallback key the render layer detects',
  /export const NO_RESULTS_GENERIC_FALLBACK_EN =/.test(searchSrc));
check('search.ts does NOT import the rotation picker (the render layer owns personalization, same '
  + 'boundary as resultsFoundRotation)', !searchSrc.includes('pickNoResultsSentence'));
check('the generic fallback returns the exported key, not a re-inlined literal',
  /return t\(NO_RESULTS_GENERIC_FALLBACK_EN\);/.test(searchSrc));

// ── 4. WIRING IN agent.tsx ──────────────────────────────────────────────────────────────────────
const agentSrc = read('src/app/agent.tsx');
check('agent.tsx imports the real picker (not a re-derived local rule)',
  /import \{ pickNoResultsSentence \} from '@\/data\/noResultsRotation';/.test(agentSrc));
check('agent.tsx imports the generic-fallback key from search.ts',
  /NO_RESULTS_GENERIC_FALLBACK_EN/.test(agentSrc));
check('the intro-text render only swaps in the rotation for the GENERIC fallback, not every zero-result reply',
  /isGenericNoResults = introZeroResult && m\.result\.suggestion === t\(NO_RESULTS_GENERIC_FALLBACK_EN\)/.test(agentSrc));

const CALL_SITE_RE = /pickNoResultsSentence\(\{ lang: rfLang, name: rfName \?\? null, stableKey: m\.id \}\)/;
check('agent.tsx PASSES stableKey: m.id at the call site (per-message pin, same class as PR #3232)',
  CALL_SITE_RE.test(agentSrc),
  'without it the picker is re-invoked on every typewriter tick and the sentence flips mid-typing');
check('a non-generic zero-result reply (e.g. a specific district/price/type diagnosis) still renders '
  + "m.result.suggestion untouched",
  /: \(m\.result\.suggestion \?\? t\('No exact matches/.test(agentSrc));

// ── 5. NO NEW NAME SOURCE, NO LLM, NO EMAIL-BASED GUESS ─────────────────────────────────────────
{
  const editedBlock = agentSrc.match(/pickNoResultsSentence\(\{[^}]*\}\)/)?.[0] ?? '';
  check('the call site never feeds an email into the name argument',
    editedBlock !== '' && !/email|user\?\.email|user\?\.sub/.test(editedBlock), `block: ${editedBlock}`);
  check('the call site never asks an LLM / generator for the name',
    editedBlock !== '' && !/openai|deepseek|generate|prompt/i.test(editedBlock));
  check('the {name} comes from the same rfName the resultsFound rotation already computes '
    + '(AuthUser.nameAr / .nameEn, not a second source)',
    editedBlock.includes('rfName ?? null'));
}

// ── 6. MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────
mustCatch('an empty baked list would leave the picker with nothing to rotate — caught', BAKED.length > 0);
{
  const brokenPool: NoResultsTemplate[] = [{ lang: 'ar', hasName: true, template: 'ما فيه نتائج' }];
  mustCatch('a logged-in template missing {name} is caught',
    !brokenPool.every((t) => t.template.includes('{name}')));
}
{
  const brokenPool: NoResultsTemplate[] = [{ lang: 'ar', hasName: false, template: 'ما فيه نتائج يا {name}' }];
  mustCatch('a guest template containing {name} is caught',
    !brokenPool.every((t) => !t.template.includes('{name}')));
}
{
  // The exact mutant that reopened ops_incident #346 for resultsFound: drop `stableKey: m.id` from
  // the call site. Proven both directions so the check is not vacuously red.
  const mutatedSrc = agentSrc.replace(
    'pickNoResultsSentence({ lang: rfLang, name: rfName ?? null, stableKey: m.id })',
    'pickNoResultsSentence({ lang: rfLang, name: rfName ?? null })',
  );
  mustCatch('deleting `stableKey: m.id` from the call site is caught',
    mutatedSrc !== agentSrc && !CALL_SITE_RE.test(mutatedSrc),
    mutatedSrc === agentSrc ? 'the mutation did not apply — the call site no longer has the shape this proof mutates' : '');
  check('MUTATION — …while the real shipped agent.tsx still PASSES the pin check (not vacuously red)',
    CALL_SITE_RE.test(agentSrc));
}
if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the No-Results rotation drifted from the owner's exact spec.\n`);
  process.exit(1);
}
console.log('\n✓ four pools rotate the generic No-Results fallback with real display names; the 8 specific diagnoses are untouched\n');
