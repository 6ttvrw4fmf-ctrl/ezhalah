// «أرض» (Other Land) IS NOT A FILTER BOX (owner 2026-10-11, on seeing «أرض أخرى» in the Filter: «mistake … those lands are
// not searchable by property type, but searchable by other filters»). A plot whose source states no usage — Aqar's
// «نوع العقار» absent AND the seller's own words silent (4,127 rows in the live index on 2026-10-11) — stays a real clean
// type (a stored «أرض» maps to it, the card reads «أرض», its home macro is Commercial) but is offered NOWHERE as a property type:
//   • no box in the land group «الأراضي» (the four boxes are أرض تجارية / صناعية / سكنية / خام),
//   • no group or type selection returns it, and the AI chat can never produce it as a type (a type that lives in no
//     group would be an ACTIVE filter with no visible control to remove it — see groupOf),
//   • every search that names no property type still finds it: category, city, district, price, area.
// The 10-10 build read «don't show it in a specific property type, just other things» as a fifth box; it meant this.
//
//   node --experimental-strip-types scripts/verify-other-land-is-not-a-box.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HIERARCHY, CLEAN_MACRO, ALL_CLEAN_TYPES, UNBOXED_TYPES, CLEAN_TO_TYPE_AR, normalizeType, groupOf, groupMembers, offeredUnder, typeArForTypes,
} from '../src/data/propertyTypes.ts';

const ROOT = join(import.meta.dirname, '..');
const LAND_GROUP = 'Commercial & Industrial Plots';
const FOUR_BOXES = ['Commercial Land', 'Industrial Land', 'Residential Land', 'Raw Land'];

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

type Hier = typeof HIERARCHY;
// What the data must look like, judged on ANY copy of it so a deliberately broken copy is held to the same list.
const problems = (h: Hier, macro: Record<string, string>, unboxed: string[], sourceHierarchy: unknown): string[] => {
  const out: string[] = [];
  const boxes = (['Residential', 'Commercial'] as const).flatMap((m) => h[m].flatMap((g) => g.types));
  if (boxes.includes('Other Land')) out.push('«أرض» is offered as a filter box / group member');
  if (JSON.stringify(h.Commercial.find((g) => g.group === LAND_GROUP)?.types) !== JSON.stringify(FOUR_BOXES))
    out.push(`the land group does not list exactly the four boxes: ${JSON.stringify(h.Commercial.find((g) => g.group === LAND_GROUP)?.types)}`);
  if (!unboxed.includes('Other Land')) out.push('«أرض» is not registered as a real-but-unboxed type (UNBOXED_TYPES)');
  if (macro['Other Land'] !== 'Commercial') out.push('«أرض» has lost its home macro (Commercial) — category searches would stop finding it');
  if (sourceHierarchy !== null) out.push('taxonomy.source.json still gives «أرض» a hierarchy group');
  return out;
};

const SOURCE = JSON.parse(readFileSync(join(ROOT, 'src/data/taxonomy.source.json'), 'utf8')) as { cleanTypes: Array<{ clean: string; hierarchy: unknown }> };
const sourceHierarchy = SOURCE.cleanTypes.find((c) => c.clean === 'Other Land')?.hierarchy;
const real = problems(HIERARCHY, CLEAN_MACRO, UNBOXED_TYPES, sourceHierarchy);
check('«أرض» is no box, in no group, still registered, still Commercial, and its taxonomy entry has no group', real.length === 0, real.join('\n      '));

// ── still a real type: stored «أرض» maps to it; searches that name no property type still reach it ─────────────────
check('a stored «أرض» / «Land» still maps to the clean type, home macro Commercial',
  normalizeType('أرض', 'res').clean === 'Other Land' && normalizeType('Land', 'res').clean === 'Other Land' && normalizeType('أرض', 'res').macro === 'Commercial');
check('…it is a valid clean type whose stored word is «أرض» (the card keeps reading «أرض»)',
  ALL_CLEAN_TYPES.includes('Other Land') && (CLEAN_TO_TYPE_AR['Other Land'] ?? []).includes('أرض'));
check('…reachable by its home macro (a category search names no type) and never via a group',
  offeredUnder('Commercial', 'Other Land') && groupOf('Other Land') === null && !groupMembers(LAND_GROUP).includes('Other Land'));
check('a search with no property type sends NO type list to the server (so nothing excludes «أرض»)', typeArForTypes([]) === null);   // null = no restriction

// ── the AI chat can never produce it as a type ───────────────────────────────────────────────────────────────────────
const AGENT = readFileSync(join(ROOT, 'src/data/agent.ts'), 'utf8');
const chatCannotMakeIt = (src: string) => !/['"]Other Land['"]/.test(src) && !/OTHER_LAND_PHRASE/.test(src);
check('the AI chat has no «أرض أخرى» / "other land" vocabulary and no branch that sets the type', chatCannotMakeIt(AGENT));

// ── mutants ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const withBox: Hier = { ...HIERARCHY, Commercial: HIERARCHY.Commercial.map((g) => (g.group === LAND_GROUP ? { ...g, types: [...g.types, 'Other Land'] } : g)) };
mustCatch('the fifth «أرض أخرى» box coming back in the land group', problems(withBox, CLEAN_MACRO, UNBOXED_TYPES, sourceHierarchy).length > 0);
const { 'Other Land': _drop, ...macroWithout } = CLEAN_MACRO;
mustCatch('«أرض» losing its home macro (category searches stop finding it)', problems(HIERARCHY, macroWithout, UNBOXED_TYPES, sourceHierarchy).length > 0);
mustCatch('«أرض» dropped from the unboxed registry', problems(HIERARCHY, CLEAN_MACRO, [], sourceHierarchy).length > 0);
mustCatch('the taxonomy source giving «أرض» a group again', problems(HIERARCHY, CLEAN_MACRO, UNBOXED_TYPES, { macro: 'Commercial', group: LAND_GROUP }).length > 0);
mustCatch('the land group losing a real box', problems({ ...HIERARCHY, Commercial: HIERARCHY.Commercial.map((g) => (g.group === LAND_GROUP ? { ...g, types: g.types.slice(1) } : g)) }, CLEAN_MACRO, UNBOXED_TYPES, sourceHierarchy).length > 0);
mustCatch('the chat vocabulary «أرض أخرى» → Other Land coming back', !chatCannotMakeIt(AGENT.replace("'أرض': 'Residential Land',", "'أرض أخرى': 'Other Land', 'أرض': 'Residential Land',")));
mustCatch('the chat branch that sets the type coming back', !chatCannotMakeIt(AGENT + '\nconst OTHER_LAND_PHRASE = /x/;'));

console.log(failed === 0 ? '\n✅ «أرض» is a real type with no box: found by every search that names no property type, by none that does.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
