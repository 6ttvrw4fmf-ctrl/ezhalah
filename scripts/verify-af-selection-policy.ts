// ONE TAP WHERE A SECOND PICK WOULD WIDEN; SEVERAL PICKS ONLY WHERE THEY NARROW OR NAME WHAT YOU WANT
// (owner 2026-10-05, approving the one-tap Advanced Filter plan — supersedes the 2026-10-03 «every
// question is multi-select» rule, which this file used to pin as verify-af-every-question-multi.ts).
// Measured live before the change: ticking جديد then ١–٢ took the footer from 10,846 UP to 12,990 —
// a second pick widened the set, which the owner read as the filter getting worse.
//
//   · features (amenities)        — several, ALL required (each pick narrows)
//   · exact unit subtype          — several, like the property type itself (names what you want)
//   · installments (rnpl)         — a single chip, so arity cannot widen it
//   · age                         — ONE tap from a cumulative «up to» ladder: جديد · حتى سنتين ·
//                                   حتى ٥ سنوات · حتى ٩ سنوات («new or 1–2 years» is one tap)
//   · bathrooms / street width / rating — ONE tap («+٣» already means 3 or more)
//   · furnished / direction       — ONE tap; Skip = «doesn't matter»
//
// EXECUTED, not grepped: the REAL question objects are lifted from src/data/advancedFilters.ts and the
// REAL rpcAdvancedFilterParams from src/data/remote.ts (the same harness verify-af-matrix-truth uses), and
// what a pick SENDS to the database is checked. The chip text is executed from src/lib/afSummary.ts.
// Mutation proof: each defect is written into a COPY of the real advancedFilters.ts (the rest of src is
// linked, untouched), lifted the same way, and must turn this barrier red.
//
//   node --experimental-strip-types scripts/verify-af-selection-policy.ts   (in `npm test`)
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

const POLICY: Record<string, 'single' | 'multi'> = {
  property_age: 'single', bathrooms: 'single', street_width: 'single', rating: 'single',
  furnished: 'single', direction: 'single',
  amenities: 'multi', unit_subtype: 'multi', rnpl: 'multi',
};

/** Every way the rule can be broken, as a list of problems (empty = the rule holds). */
const problems = (L: Lifted): string[] => {
  const out: string[] = [];
  const q = (id: string) => L.questions.find((x) => (x as { id: string }).id === id) as unknown as
    { selection: string; apply: (q: unknown, keys: string[]) => Record<string, unknown> } | undefined;
  const sends = (id: string, keys: string[], from: Record<string, unknown> = BASE) => {
    const question = q(id);
    return question ? L.rpcAdvancedFilterParams(question.apply(from, keys) as never) : { missing: id };
  };
  for (const [id, want] of Object.entries(POLICY)) {
    const got = q(id)?.selection;
    if (got !== want) out.push(`«${id}» is ${got ?? 'missing'}, the policy says ${want}`);
  }
  const expect = (what: string, got: unknown, want: unknown) => { if (!same(got, want)) out.push(`${what}: sends ${JSON.stringify(got)}, must send ${JSON.stringify(want)}`); };
  // age — one tap; every «up to» rung is the union of ALL the newer buckets (no gap, no single bucket)
  expect('age «جديد»', sends('property_age', ['new']), { p_is_new_construction: true });
  expect('age «حتى سنتين» = new + 1–2', sends('property_age', ['upto2']), { p_age_buckets: ['new', '1_2'] });
  expect('age «حتى ٥ سنوات» = new + 1–2 + 3–5', sends('property_age', ['upto5']), { p_age_buckets: ['new', '1_2', '3_5'] });
  expect('age «حتى ٩ سنوات» = new … 6–9', sends('property_age', ['upto9']), { p_age_buckets: ['new', '1_2', '3_5', '6_9'] });
  const age = q('property_age');
  if (age) expect('a later age answer REPLACES the earlier one', L.rpcAdvancedFilterParams(age.apply(age.apply(BASE, ['upto5']), ['new']) as never), { p_is_new_construction: true });
  // one-tap ladders and yes/no
  expect('bathrooms «+٣»', sends('bathrooms', ['3']), { p_bath_min: 3 });
  expect('street width «20 m+»', sends('street_width', ['20']), { p_street_width_min: 20 });
  expect('furnished «yes»', sends('furnished', ['yes']), { p_furnished: true });
  expect('rating «9.5+»', sends('rating', ['9.5']), { p_rating_min: 9.5 });
  // several picks where they NARROW: every feature is required
  const am = sends('amenities', ['elevator', 'private_entrance']) as { p_amenities?: string[] };
  if (!['elevator', 'private_entrance'].every((k) => am.p_amenities?.includes(k))) out.push(`two features must BOTH be required: sends ${JSON.stringify(am)}`);
  // several subtypes = the types the user named
  expect('studio + regular apartment', sends('unit_subtype', ['استديو', 'شقة']), { p_unit_subtypes: ['استديو', 'شقة'] });
  return out;
};

const real = problems(await loadLifted(ROOT));
check('one tap where a second pick would widen; several only where they narrow or name the type — and each pick sends exactly its rung', real.length === 0, real.join('\n      '));

// The chip and the summary item read the rung the user tapped.
const chipAge = buildAfSummaryItems([{ id: 'property_age', keys: ['upto2'], labels: ['حتى سنتين'] }]);
check('an «up to» age answer reads as one item — عمر حتى سنتين 🏗️', same(chipAge, ['عمر حتى سنتين 🏗️']), JSON.stringify(chipAge));
const chipNew = buildAfSummaryItems([{ id: 'property_age', keys: ['new'], labels: ['جديد'] }]);
check('«جديد» keeps its sparkle — عمر جديد ✨', same(chipNew, ['عمر جديد ✨']), JSON.stringify(chipNew));

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
  const dir = mkdtempSync(join(tmpdir(), 'af-policy-'));
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
await mustCatch('the age question taking several answers again', /(titleKey: 'How old is the property\?',\n\s*selection: )'single'/, "$1'multi'");
await mustCatch('an «up to» rung sending only its own bucket (a gap, not a ladder)', "buckets: ['new', '1_2'],               count", "buckets: ['1_2'],                      count");
await mustCatch('a later rung skipping a bucket', "buckets: ['new', '1_2', '3_5', '6_9'], count", "buckets: ['new', '1_2', '6_9'],        count");
await mustCatch('bathrooms taking several answers again', /(id: 'bathrooms',\n(?:  [^\n]*\n){0,4}?  selection: )'single'/, "$1'multi'");
await mustCatch('furnished taking several answers again', /(id: 'furnished',\n(?:  [^\n]*\n){0,4}?  selection: )'single'/, "$1'multi'");
await mustCatch('features forced to ONE pick', /(titleKey: 'What amenities matter to you\?',\n(?:  [^\n]*\n){0,3}?  selection: )'multi'/, "$1'single'");
await mustCatch('unit subtype keeping only the first pick', 'apply: (q, keys) => (keys.length ? { ...q, unitSubtypes: [...keys] } : q),', 'apply: (q, keys) => (keys.length ? { ...q, unitSubtypes: [keys[0]] } : q),');

if (mutFail) failed += mutFail;
console.log(failed === 0
  ? '\n✅ one tap where a second pick would widen; several picks only where they narrow or name the type.\n'
  : `\n❌ ${failed} check(s) failed — a question takes the wrong number of answers, or a pick does not send its rung.\n`);
process.exit(failed === 0 ? 0 : 1);
