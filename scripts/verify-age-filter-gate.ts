// Automated, REAL tests for the Property Age (عمر العقار) advanced-filter eligibility gate —
// src/lib/ageFilterTypes.ts. This gate decides whether a user is offered the age question at all, so
// a silent desync here is invisible in the UI: the question simply stops appearing (or, worse, appears
// on a scope whose data can't honestly answer it).
//
// THE LOAD-BEARING TEST is `macro matches CLEAN_MACRO`. AGE_FILTER_TYPES hand-writes a macro per type;
// CLEAN_MACRO derives the real macro from HIERARCHY (the single source). If someone later moves a type
// between Residential and Commercial in HIERARCHY, the hand-written tag would silently disagree and the
// question would either vanish for that type or fire under the wrong category. This test fails the build
// on that drift instead.
//
//   node --experimental-strip-types scripts/verify-age-filter-gate.ts   (wired into `npm test`)

import { AGE_FILTER_TYPES, isAgeFilterScope } from '../src/lib/ageFilterTypes.ts';
import { CLEAN_MACRO, CLEAN_TO_TYPE_AR } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── The drift tripwire: every hand-written macro must equal the taxonomy's own derived macro ──────
for (const [type, macro] of AGE_FILTER_TYPES) {
  check(
    `${type}: is a real clean type (present in CLEAN_MACRO)`,
    type in CLEAN_MACRO,
  );
  check(
    `${type}: declared macro '${macro}' matches CLEAN_MACRO's derived '${CLEAN_MACRO[type]}'`,
    CLEAN_MACRO[type] === macro,
  );
  // A type the RPC can't be given p_types for could never return rows — catches a typo'd key.
  check(
    `${type}: resolves to a non-empty p_types array via CLEAN_TO_TYPE_AR`,
    Array.isArray(CLEAN_TO_TYPE_AR[type]) && CLEAN_TO_TYPE_AR[type].length > 0,
  );
}

// ── The gate itself ───────────────────────────────────────────────────────────────────────────────
check('Apartment fires under Residential', isAgeFilterScope({ category: 'Residential' }, ['Apartment']));
check('Villa fires under Residential', isAgeFilterScope({ category: 'Residential' }, ['Villa']));
check('Office fires under Commercial', isAgeFilterScope({ category: 'Commercial' }, ['Office']));
check('Warehouse fires under Commercial', isAgeFilterScope({ category: 'Commercial' }, ['Warehouse']));

// Wrong-macro guards — the whole reason each type carries its own macro rather than one global check.
check('Villa does NOT fire under Commercial', !isAgeFilterScope({ category: 'Commercial' }, ['Villa']));
check('Office does NOT fire under Residential', !isAgeFilterScope({ category: 'Residential' }, ['Office']));
check(
  'Warehouse does NOT fire under Residential (it is kinds:BOTH — the macro tag is the only thing stopping it)',
  !isAgeFilterScope({ category: 'Residential' }, ['Warehouse']),
);

// Non-eligible types must never offer the question, regardless of category.
for (const t of ['Land', 'Farm', 'Agriculture Plot', 'Chalet', 'Studio', 'Duplex', 'Shop'])
  check(`${t} (not enabled) never fires`, !isAgeFilterScope({ category: 'Residential' }, [t]) && !isAgeFilterScope({ category: 'Commercial' }, [t]));

// Multi-type and no-type scopes have no single age distribution to ask about.
check('a MULTI-type scope never fires', !isAgeFilterScope({ category: 'Residential' }, ['Apartment', 'Villa']));
check('an EMPTY type scope never fires', !isAgeFilterScope({ category: 'Residential' }, []));
check('a missing category never fires', !isAgeFilterScope({}, ['Apartment']));
check('a null category never fires', !isAgeFilterScope({ category: null }, ['Apartment']));

// An unknown/garbage type must not fire (Map.get → undefined must never === a category).
check('an unknown type never fires', !isAgeFilterScope({ category: 'Residential' }, ['NotAType']));

console.log(failed === 0 ? '\n✓ all age-filter-gate assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
