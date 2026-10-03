// NO ADVANCED FILTER QUESTION FORCES ONE ANSWER, AND SEVERAL ANSWERS MEAN EXACTLY THEIR MIX
// (owner 2026-10-03: «many users want to choose جديد or ١–٢ years. We should let users choose more than
// one … It's a new rule», «never force the user to select one thing», and for جديد + ٦–٩: «you show a
// mixture of the ages you selected» — the exact union, never a filled gap).
//
// EXECUTED, not grepped: the REAL question objects are lifted from src/data/advancedFilters.ts and the
// REAL rpcAdvancedFilterParams from src/data/remote.ts (the same harness verify-af-matrix-truth uses), and
// what a pick SENDS to the database is checked. The chip text is executed from src/lib/afSummary.ts.
// Mutation proof: each defect is written into a COPY of the real advancedFilters.ts (the rest of src is
// linked, untouched), lifted the same way, and must turn this barrier red.
//
//   node --experimental-strip-types scripts/verify-af-every-question-multi.ts   (in `npm test`)
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadLifted, sortedJson, type Lifted } from './lib/afMatrix.ts';
import { buildAfSummaryItems } from '../src/lib/afSummary.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const same = (a: unknown, b: unknown) => sortedJson(a) === sortedJson(b);
const BASE = { deal: 'Rent', rentPeriod: 'yearly', category: 'Residential', types: ['Apartment'] } as Record<string, unknown>;

/** Every way the rule can be broken, as a list of problems (empty = the rule holds). */
const problems = (L: Lifted): string[] => {
  const out: string[] = [];
  const q = (id: string) => L.questions.find((x) => (x as { id: string }).id === id) as unknown as
    { selection: string; apply: (q: unknown, keys: string[]) => Record<string, unknown> } | undefined;
  const sends = (id: string, keys: string[], from: Record<string, unknown> = BASE) => {
    const question = q(id);
    return question ? L.rpcAdvancedFilterParams(question.apply(from, keys) as never) : { missing: id };
  };
  for (const x of L.questions as unknown as Array<{ id: string; selection: string }>)
    if (x.selection !== 'multi') out.push(`«${x.id}» still forces ONE answer (selection: ${x.selection})`);

  const expect = (what: string, got: unknown, want: unknown) => { if (!same(got, want)) out.push(`${what}: sends ${JSON.stringify(got)}, must send ${JSON.stringify(want)}`); };
  // age — the exact mixture, in bucket order, nothing between, no single-range fields riding along
  expect('age جديد + ٦–٩', sends('property_age', ['new', '6_9']), { p_age_buckets: ['new', '6_9'] });
  expect('age picked in reverse order', sends('property_age', ['6_9', 'new']), { p_age_buckets: ['new', '6_9'] });
  expect('age جديد + ١–٢ (the owner\'s example)', sends('property_age', ['new', '1_2']), { p_age_buckets: ['new', '1_2'] });
  expect('age one pick keeps the single-answer shape', sends('property_age', ['1_2']), { p_age_min: 1, p_age_max: 2 });
  expect('age one pick «جديد»', sends('property_age', ['new']), { p_is_new_construction: true });
  const age = q('property_age');
  if (age) expect('a later single age answer REPLACES an earlier mixture', L.rpcAdvancedFilterParams(age.apply(age.apply(BASE, ['new', '6_9']), ['3_5']) as never), { p_age_min: 3, p_age_max: 5 });
  // furnished — both = the listings that stated either way
  expect('furnished + unfurnished', sends('furnished', ['yes', 'no']), { p_furnished_in: [true, false] });
  expect('furnished alone', sends('furnished', ['yes']), { p_furnished: true });
  // rating — a mixture with no single threshold
  expect('rating 9.5+ and 9.0+ with 10 reviews', sends('rating', ['9.5', '9.0_rc10']), { p_rating_buckets: ['9.5', '9.0_rc10'] });
  expect('rating one pick', sends('rating', ['9.5']), { p_rating_min: 9.5 });
  // «at least» ladders — the union IS the lowest pick
  expect('bathrooms +٣ and +١', sends('bathrooms', ['3', '1']), { p_bath_min: 1 });
  expect('street 30 m and 20 m', sends('street_width', ['30', '20']), { p_street_width_min: 20 });
  // unit subtype — every pick
  expect('studio + regular apartment', sends('unit_subtype', ['استديو', 'شقة']), { p_unit_subtypes: ['استديو', 'شقة'] });
  return out;
};

const real = problems(await loadLifted(ROOT));
check('every question takes several answers, and each mixture sends exactly its union', real.length === 0, real.join('\n      '));

// The chip and the summary item name EVERY pick, not just the first.
const chipAge = buildAfSummaryItems([{ id: 'property_age', keys: ['new', '6_9'], labels: ['جديد', '٦–٩ سنوات'] }]);
check('a mixed age answer shows BOTH picks on its chip — عمر جديد ✨ · عمر ٦–٩ سنوات 🏗️',
  same(chipAge, ['عمر جديد ✨', 'عمر ٦–٩ سنوات 🏗️']), JSON.stringify(chipAge));
const chipFurn = buildAfSummaryItems([{ id: 'furnished', keys: ['yes', 'no'], labels: ['مفروش', 'غير مفروشة'] }]);
check('furnished + unfurnished shows both, each with its own emoji', same(chipFurn, ['مفروش 🛋️', 'غير مفروشة 🏠']), JSON.stringify(chipFurn));
const chipBath = buildAfSummaryItems([{ id: 'bathrooms', keys: ['1', '3'], labels: ['+١', '+٣'] }]);
check('two bathroom rungs show both picks', same(chipBath, ['+١ حمامات 🚿', '+٣ حمامات 🚿']), JSON.stringify(chipBath));

// The database half is in the repo (mirror rule): the clause mirror and the migration carry all three params.
const mirror = readFileSync(join(ROOT, 'sql/mirrors/af_eligibility_clause.sql'), 'utf8');
const migs = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('_af_every_question_multi_select_unions.sql'));
check('the clause mirror carries the three union params', ['p_age_buckets', 'p_rating_buckets', 'p_furnished_in'].every((p) => mirror.includes(`${p} is null or cardinality(${p}) = 0`)));
check('exactly one migration carries them', migs.length === 1, migs.join(', ') || 'none');

// ── MUTATION PROOF — each defect written into a COPY of the real advancedFilters.ts ─────────────────
console.log('\n  mutation proof — every pin must go red on its own defect\n');
let mutFail = 0;
const SRC = readFileSync(join(ROOT, 'src/data/advancedFilters.ts'), 'utf8');
const liftMutant = async (from: string | RegExp, to: string): Promise<Lifted> => {
  const mutated = SRC.replace(from, to);
  if (mutated === SRC) throw new Error(`mutation anchor missing: ${String(from).slice(0, 80)}`);
  const dir = mkdtempSync(join(tmpdir(), 'af-multi-'));
  mkdirSync(join(dir, 'src', 'data'), { recursive: true });
  for (const e of readdirSync(join(ROOT, 'src'))) if (e !== 'data') symlinkSync(join(ROOT, 'src', e), join(dir, 'src', e));
  for (const e of readdirSync(join(ROOT, 'src', 'data'))) if (e !== 'advancedFilters.ts') symlinkSync(join(ROOT, 'src', 'data', e), join(dir, 'src', 'data', e));
  writeFileSync(join(dir, 'src', 'data', 'advancedFilters.ts'), mutated);
  return loadLifted(dir);
};
const mustCatch = async (what: string, from: string | RegExp, to: string) => {
  let caught = false;
  try { caught = problems(await liftMutant(from, to)).length > 0; } catch (e) { if (String(e).includes('mutation anchor missing')) throw e; caught = true; }
  if (caught) { console.log(`  PASS  catches: ${what}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${what}`);
};
await mustCatch('the age question forcing one answer again', /(titleKey: 'How old is the property\?',\n\s*selection: )'multi'/, "$1'single'");
await mustCatch('two ages collapsing into the FIRST pick', 'if (picked.length >= 2) return { ...q, ageBuckets: picked, isNewConstruction: null, ageMin: null, ageMax: null };', '');
await mustCatch('a mixed age answer filling the gap (a range instead of the mixture)',
  'if (picked.length >= 2) return { ...q, ageBuckets: picked,',
  "if (picked.length >= 2) return { ...q, ageBuckets: AGE_BUCKETS.map((b) => b.key).slice(AGE_BUCKETS.findIndex((b) => b.key === picked[0]), AGE_BUCKETS.findIndex((b) => b.key === picked[picked.length - 1]) + 1),");
await mustCatch('furnished + unfurnished silently meaning «no filter»', "? { ...q, furnishedPref: null, furnishedIn: [true, false] }", '? q');
await mustCatch('a bathrooms ladder taking the HIGHEST pick (an intersection, not the union)',
  'return ns.length ? { ...q, bathMin: Math.max(Math.min(...ns), q.bathMin ?? 0) } : q;', 'return ns.length ? { ...q, bathMin: Math.max(Math.max(...ns), q.bathMin ?? 0) } : q;');
await mustCatch('unit subtype keeping only the first pick', 'apply: (q, keys) => (keys.length ? { ...q, unitSubtypes: [...keys] } : q),', 'apply: (q, keys) => (keys.length ? { ...q, unitSubtypes: [keys[0]] } : q),');
await mustCatch('the rating mixture dropped', "if (picked.length >= 2) return { ...q, ratingBuckets: picked };", '');

if (mutFail) failed += mutFail;
console.log(failed === 0
  ? '\n✅ every Advanced Filter question takes several answers, and several answers mean exactly their mix.\n'
  : `\n❌ ${failed} check(s) failed — a question forces one answer, or a mixture is not what the user ticked.\n`);
process.exit(failed === 0 ? 0 : 1);
