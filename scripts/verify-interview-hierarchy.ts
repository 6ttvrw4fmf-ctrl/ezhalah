// Permanent hierarchy-unification tests (audit item 1, owner-approved 2026-07-27).
// ONE source of truth: propertyTypes.ts HIERARCHY drives the Filter home, the guided interview, and
// the agent's free-text parser. The stale CATEGORY_TYPES taxonomy (dead types Building/Kiosk/Cinema,
// مزرعة misfiled under Commercial, missing Studio/Duplex/Residential Building) must never return.
//   node --experimental-strip-types scripts/verify-interview-hierarchy.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import {
  HIERARCHY, CLEAN_MACRO, CLEAN_TO_QUERY, SUBGROUPS, groupsFor, groupMembers, isCleanType,
} from '../src/data/propertyTypes.ts';
import { detailFor } from '../src/data/taxonomy.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── 1) The stale taxonomy is gone — no live CATEGORY_TYPES export or import anywhere ─────────────
const files = ['src/data/taxonomy.ts', 'src/app/interview.tsx', 'src/data/agent.ts'];
for (const f of files) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const live = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  check(`no live CATEGORY_TYPES reference in ${f}`, !live.some((l) => l.includes('CATEGORY_TYPES')));
}

// ── 2) Interview consumes the live hierarchy ─────────────────────────────────────────────────────
const IV = readFileSync(new URL('../src/app/interview.tsx', import.meta.url), 'utf8');
check('interview imports groupsFor + groupMembers + isCleanType from propertyTypes',
  /groupsFor,\s*groupMembers,\s*isCleanType.*from '@\/data\/propertyTypes'/.test(IV));
check('interview asks group from groupsFor(category) then type from groupMembers(group)',
  IV.includes("opts: groupsFor(a.category as Macro).map((g) => g.group)") && IV.includes('opts: groupMembers(a.typeGroup)'));
check('interview only forwards CLEAN types into the query (custom junk broadens, never dead-ends)',
  IV.includes('real(a.type) && isCleanType(a.type)'));
check('interview size applicability uses canonical detailFor/detailForContext',
  IV.includes('detailForContext(') && IV.includes('detailFor(a.type).isBedrooms'));

// ── 3) Farm/Agriculture can never be offered under Commercial; dead types never offered ──────────
const resTypes = HIERARCHY.Residential.flatMap((g) => g.types);
const comTypes = HIERARCHY.Commercial.flatMap((g) => g.types);
check('مزرعة (Farm) + أرض زراعية (Agriculture Plot) live under Residential «Vacation & Rural»',
  resTypes.includes('Farm') && resTypes.includes('Agriculture Plot')
  && HIERARCHY.Residential.some((g) => g.group === 'Vacation & Rural' && g.types.includes('Farm')));
check('Farm/Agriculture Plot appear in NO Commercial group', !comTypes.includes('Farm') && !comTypes.includes('Agriculture Plot'));
for (const dead of ['Building', 'Kiosk', 'Cinema'])
  check(`dead type "${dead}" is not offerable in any group`, !resTypes.includes(dead) && !comTypes.includes(dead));
for (const t of ['Studio', 'Duplex', 'Residential Building'])
  check(`"${t}" is offerable (was missing from the stale list)`, resTypes.includes(t));

// ── 4) Zero-result paths impossible: every offerable option resolves to a real query ─────────────
const offerable = [...resTypes, ...comTypes];
for (const t of offerable) {
  const viaSubgroup = t in SUBGROUPS; // 'Service Facilities' box expands to 5 facility types
  const ok = viaSubgroup
    ? SUBGROUPS[t].every((m) => isCleanType(m) && m in CLEAN_TO_QUERY)
    : isCleanType(t) && t in CLEAN_TO_QUERY;
  if (!ok) check(`offerable "${t}" resolves to CLEAN_TO_QUERY (no dead-end)`, false);
}
check('every offerable type/box resolves to a strict query (no guaranteed-zero paths)',
  offerable.every((t) => (t in SUBGROUPS ? SUBGROUPS[t].every((m) => m in CLEAN_TO_QUERY) : t in CLEAN_TO_QUERY)));

// ── 5) Buy/Rent + bedrooms applicability come from ONE canon ─────────────────────────────────────
for (const t of ['Residential Land', 'Warehouse', 'Factory', 'Workshop', 'Commercial Land', 'Industrial Land', 'Agriculture Plot'])
  check(`bedrooms NOT applicable to ${t} (canonical detailFor)`, detailFor(t).isBedrooms === false);
for (const t of ['Apartment', 'Villa', 'Duplex', 'Floor'])
  check(`bedrooms applicable to ${t}`, detailFor(t).isBedrooms === true);
check('Studio/Room are fixed single-bedroom', detailFor('Studio').options.join() === '1' && detailFor('Room').options.join() === '1');

// ── 5b) Agent REFINE flow asks bedrooms only where canonically applicable (audit item 5) ─────────
const AGX = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
check('refine flow gates the bedrooms question on detailFor/detailForContext applicability',
  AGX.includes('const bedsApplicable = q.type') && AGX.includes('!q.detail && bedsApplicable'));

// ── 6) Agent free-text parser on the same canon ──────────────────────────────────────────────────
const AG = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');
check('agent ALL_TYPES derives from CLEAN_MACRO', AG.includes('Object.entries(CLEAN_MACRO).map'));
check('agent synonyms: studio→Studio, duplex→Duplex (not Apartment/Floor)',
  /studio:\s*'Studio'/.test(AG) && /duplex:\s*'Duplex'/.test(AG));
check('agent no longer maps tower/block to the dead Building type', !/tower:\s*'Building'|block:\s*'Building'/.test(AG));

if (failed) { console.error(`\n✗ ${failed} interview-hierarchy assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all interview-hierarchy assertions passed (one source of truth; no dead types; no misfiled farm; canonical applicability)');
