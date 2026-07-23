// Automated, REAL regression test for the AI-agent Arabic free-text type-recognition layer
// (src/data/agent.ts's AR_TYPE dict + the production LLM prompt in supabase/functions/agent/index.ts).
//
// Two distinct bug classes found live 2026-07-23 during a systematic re-audit of every merged
// clean-type's long-tail raw types (the same class of bug originally found for أرض زراعية/Agriculture
// Plot — see scripts/verify-farm-agriculture-plot-classification.ts):
//
// 1. COVERAGE GAPS: 11 raw Arabic type words (كشك, درايف ثرو, صالة, سينما, bare محطة, مكاتب مشتركة,
//    مخازن سحابية, ملحق علوي, مبنى شقق مخدومة, مجمع سكني, حوش) exist as real raw types in the
//    structured taxonomy (src/data/propertyTypes.ts CLEAN_TO_QUERY) but were recognized by NEITHER
//    AI-agent surface -- a user typing that exact Arabic word got no type match at all.
//
// 2. ORDERING SHADOWING (more subtle, and the reason coverage alone isn't enough of a test): AR_TYPE
//    is matched via `text.includes(ar)` in Object.entries() insertion order, breaking on the first
//    hit. A SHORTER key that is a literal prefix of a LONGER, more specific key will shadow it if the
//    shorter key comes first -- e.g. 'أرض' shadowed 'أرض زراعية' this way, silently making the
//    original Agriculture Plot free-text fix dead code (verified live: typing "أرض زراعية" resolved
//    to "Residential Land", not "Agriculture Plot", despite the correct mapping existing in the dict).
//    Coverage checks alone would NOT have caught this -- the mapping WAS present, just unreachable.
//    This test's ordering invariant is the one that actually catches that class of bug, and protects
//    against it recurring for any future addition to AR_TYPE, not just today's known cases.
//
// agent.ts itself can't be imported here (its module chain pulls in react-native, unparseable by
// plain node/tsx outside the Metro bundler -- confirmed both fail), so this reads the file as TEXT
// and extracts the AR_TYPE object literal with a regex, preserving insertion order. This is weaker
// than executing the real lookup function, but it directly tests the property that actually matters
// (order + presence), and is corroborated by a real extraction+execution smoke test (not committed,
// run manually during the fix) that reproduced both the original bug and the fix across 19 real
// phrases with the actual `text.includes()` matching logic.
//
//   node --experimental-strip-types scripts/verify-ai-agent-arabic-synonym-coverage.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const agentSrc = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');

const dictMatch = agentSrc.match(/const AR_TYPE: Record<string, string> = \{([\s\S]*?)\n\};/);
check('src/data/agent.ts still defines an AR_TYPE object literal', dictMatch !== null);
if (!dictMatch) {
  console.log('\n✗ cannot locate AR_TYPE — aborting remaining checks');
  process.exit(1);
}

// Parse 'key': 'value' pairs in source order (order is the whole point of this test).
const pairs: [string, string][] = [];
const pairRe = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;
let m: RegExpExecArray | null;
while ((m = pairRe.exec(dictMatch[1])) !== null) pairs.push([m[1], m[2]]);
check(`parsed a non-trivial number of AR_TYPE entries (got ${pairs.length})`, pairs.length >= 30);

const asMap = new Map(pairs);
const has = (ar: string, en: string) => asMap.get(ar) === en;

// ── 1. Coverage: the 11 newly-added long-tail terms + the original Agriculture Plot pair ──────────
check("'أرض زراعية' -> Agriculture Plot", has('أرض زراعية', 'Agriculture Plot'));
check("'ارض زراعية' -> Agriculture Plot", has('ارض زراعية', 'Agriculture Plot'));
check("'كشك' -> Shop", has('كشك', 'Shop'));
check("'درايف ثرو' -> Shop", has('درايف ثرو', 'Shop'));
check("'صالة' -> Commercial Building", has('صالة', 'Commercial Building'));
check("'سينما' -> Commercial Building", has('سينما', 'Commercial Building'));
check("'محطة' -> Gas Station", has('محطة', 'Gas Station'));
check("'مكاتب مشتركة' -> Office", has('مكاتب مشتركة', 'Office'));
check("'مخازن سحابية' -> Warehouse", has('مخازن سحابية', 'Warehouse'));
check("'ملحق علوي' -> Apartment", has('ملحق علوي', 'Apartment'));
check("'مبنى شقق مخدومة' -> Apartment", has('مبنى شقق مخدومة', 'Apartment'));
check("'مجمع سكني' -> Residential Building", has('مجمع سكني', 'Residential Building'));
check("'حوش' -> Residential Land", has('حوش', 'Residential Land'));

// ── 2. Ordering invariant: no key may be shadowed by an earlier, shorter, literal-prefix key ───────
// text.includes(ar) + break-on-first-hit means: for any two DISTINCT keys where the earlier one is a
// substring of the later one, the later (more specific) key can NEVER be reached. This is the actual
// root-cause check -- it would have caught the أرض/أرض-زراعية bug even before anyone noticed the
// symptom, and protects every future addition automatically.
const shadowed: string[] = [];
for (let i = 0; i < pairs.length; i++) {
  for (let j = i + 1; j < pairs.length; j++) {
    const [earlier] = pairs[i];
    const [later] = pairs[j];
    if (earlier !== later && later.includes(earlier)) {
      shadowed.push(`'${later}' (index ${j}) is shadowed by earlier, shorter key '${earlier}' (index ${i})`);
    }
  }
}
check(
  `no AR_TYPE key is shadowed by an earlier literal-prefix key (${shadowed.length} violation(s))`,
  shadowed.length === 0,
);
if (shadowed.length) shadowed.forEach((s) => console.log(`    ${s}`));

// ── 3. Production LLM prompt: the same 11 terms need an explicit synonym line ──────────────────────
const edgeFnSrc = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
const synonymsChecks: [string, RegExp][] = [
  ['كشك / درايف ثرو -> Shop', /كشك[\s\S]{0,80}درايف ثرو[\s\S]{0,20}→\s*Shop/],
  ['صالة / سينما -> Commercial Building', /صالة[\s\S]{0,80}سينما[\s\S]{0,20}→\s*Commercial Building/],
  ['محطة (bare) -> Gas Station', /محطة[\s\S]{0,80}→\s*Gas Station/],
  ['مكاتب مشتركة -> Office', /مكاتب مشتركة[\s\S]{0,20}→\s*Office/],
  ['مخازن سحابية -> Warehouse', /مخازن سحابية[\s\S]{0,20}→\s*Warehouse/],
  ['ملحق علوي / مبنى شقق مخدومة -> Apartment', /ملحق علوي[\s\S]{0,120}→\s*Apartment/],
  ['مجمع سكني -> Residential Building', /مجمع سكني[\s\S]{0,20}→\s*Residential Building/],
  ['حوش -> Residential Land', /حوش[\s\S]{0,20}→\s*Residential Land/],
];
for (const [label, re] of synonymsChecks) {
  check(`supabase/functions/agent/index.ts SYNONYMS covers: ${label}`, re.test(edgeFnSrc));
}

console.log(
  failed === 0
    ? '\n✓ all AI-agent Arabic synonym coverage + ordering assertions passed'
    : `\n✗ ${failed} assertion(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
