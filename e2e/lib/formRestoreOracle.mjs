// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THE FILTER FORM IS SHOWING, for the "state survived a cancel/restore" oracles.
//
// WHY THIS EXISTS (routine #6, 2026-09-13 — the follow-up that settled ops_incident #224).
//
// `verify-web-runtime-smoke.mjs` asserts, three times over, that a cancelled Filter search
// «restores city/district/area EXACTLY». Its oracle was:
//
//     Array.from(document.querySelectorAll('input')).filter(visible).map((e) => e.value)
//
// — every visible <input>'s VALUE. That reads the city, the min-area and the max-area correctly,
// and it can never read the DISTRICT at all, in either direction:
//
//  · The district box is a SEARCH box over the catalog, not a value field. Only a TAPPED
//    suggestion is ever searched (`src/app/index.tsx` onSearch, "no silent drop" rule 2026-08-23),
//    and the tap handler CLEARS the typed text (`districtTextRef.current = ''`) and pushes the pick
//    into `districtsSelected`, which renders as a removable `[data-testid="district-chip"]`.
//  · So with a district picked, the district <input> holds `''` — before the cancel and after it.
//    The assertion compared '' to '' and passed, whether the district survived or was dropped.
//
// That is PART 9.5's class exactly: a check that reports a PASS while asserting nothing about the
// thing its own name promises. It matters because the invariant it was meant to hold is a real one
// with a real history — the 2026-08-14 "silent widening" bug (search «الرياض + حي النرجس» → reopen
// «تصفية» → press «بحث» untouched → the حي is gone and the search runs city-wide, +989 listings the
// user never asked for). ops_incident #224 recorded a run where the resubmitted request carried
// `p_districts: null` while THIS assertion passed, and reasoned from that pair to a
// "visible-but-uncommitted window" — the UI showing a district the request had dropped. That
// inference does not hold: the passing assertion was never evidence about the district.
//
// MEASURED, so the correction rests on numbers and not on reading the code: on production
// (Chromium, 1440x900, fresh context per rep) the district survives both the Back-from-results path
// (0/2 dropped) and the exact [E] rapid-cancel-via-back path (0/3 dropped) — 0/5 — with the chip
// present at every resubmit press. The product invariant held every time we could observe it; what
// was broken was our ability to observe it.
//
// PURE AND SELF-CONTAINED BY CONSTRUCTION. It takes a document and returns data, closes over
// nothing, and imports nothing — which is what lets `page.evaluate()` serialise it into the browser
// AND lets `scripts/verify-restore-oracle-sees-the-district.ts` EXECUTE it offline against a
// synthetic DOM. That distinction is the whole point: the defect this replaces would have survived
// any source-TEXT tripwire, because the line it lived on looked perfectly correct.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Everything the Filter form is currently SHOWING the user, as one comparable value.
 *
 * `doc` DEFAULTS TO THE AMBIENT DOCUMENT, and that default is load-bearing rather than tidy:
 * `page.evaluate(readRestoredFormState)` invokes this with NO argument inside the browser (Playwright
 * serialises the function and passes only an explicit second argument, which a live `Document` can
 * never be — it is not structured-cloneable). Without the default, `doc` arrives `undefined` and the
 * call throws `Cannot read properties of undefined (reading 'querySelectorAll')` on every snapshot.
 * Caught by running it against production before shipping, NOT by the wiring assertions — which is
 * the whole reason `verify-restore-oracle-sees-the-district.ts` also EXECUTES the no-argument form.
 *
 * @param {Document} [doc]
 * @returns {{ inputs: string[], districts: string[] }}
 *   `inputs`   — every visible input's value, excluding the sign-in card's own fields (unchanged).
 *   `districts`— the text of each picked-district chip, in DOM order. A picked district lives ONLY
 *                here; it is absent from `inputs` by design.
 */
export function readRestoredFormState(doc = globalThis.document) {
  const inputs = Array.from(doc.querySelectorAll('input'))
    .filter((e) => e.offsetParent !== null && !e.closest('[data-testid="signin-card"]'))
    .map((e) => e.value);
  const districts = Array.from(doc.querySelectorAll('[data-testid="district-chip"]'))
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0);
  return { inputs, districts };
}
