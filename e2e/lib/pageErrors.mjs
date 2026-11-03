// ONE RULING ABOUT REACT'S RECOVERABLE HYDRATION NOTICES, SHARED BY BOTH BROWSER SUITES.
//
// WHY THIS FILE EXISTS. The guardian suite and the journey suite disagreed about the same string,
// in opposite directions, and both were wrong:
//
//   guardian   dropped `Minified React error #418` AT CAPTURE, so it never appeared anywhere. A
//              silent drop cannot be counted, so a sudden spike would have looked exactly like the
//              steady state — the dark-detector shape AGENTS.md warns about.
//   journeys   had no rule at all, so the same notice was a product defect. Measured 2026-09-05:
//              a 100-journey production sweep reported 36 defects, of which 34 were this one
//              string and 2 were container transport. ZERO were product assertions.
//
// The fix is not a second copy of a regex in the other harness — two copies of a rule is the drift
// this repo keeps paying for. Both harnesses import THIS module, so the classification is identical
// by construction and `verify-journey-page-error-discriminator.ts` fails if either grows its own.
//
// ── WHAT IS ACTUALLY BEING EXCUSED, AND WHAT IS NOT ─────────────────────────────────────────────
//
// React #418/#423/#425 are the RECOVERABLE hydration family: the client markup disagreed with the
// static export, React logged it and re-rendered that subtree. They fire on this statically-rendered
// Expo export, they predate both suites (project memory
// `react-418-is-preexisting-not-the-both-feature-2026-08-15`), and `verify-web-runtime-smoke.mjs`
// already makes the same allowance. Adjudicated again on 2026-09-05 before this file was written:
// current `main` was built WITH and WITHOUT that day's tap-target change and served identically —
// **0 of these errors either way**, so they are not attributable to the change that surfaced them,
// and they do not reproduce on a locally served build of the same commit at all.
//
// **THIS IS NOT A HYDRATION ORACLE AND MUST NEVER BECOME ONE.** A genuine hydration regression is
// caught by `scripts/verify-live-hydration.mjs`, the BLOCKING post-deploy gate that drives five
// viewports and fails the deploy on `REACT HYDRATION MISMATCH`. That gate is the guard; this file
// only stops a journey about Favourites from failing because of a notice it never asserted on.
// Nothing here weakens that gate, and nothing here may be widened to cover it.
//
// Three deliberate narrowings keep this from becoming a blindfold — each one is mutation-proven:
//   1. ONLY the three documented codes. Any other minified React error (#185, #300, #310 …) is a
//      product defect and stays one. A future React bug must not inherit this excuse by number.
//   2. ONLY the MINIFIED notice shape. The unminified text a real regression produces —
//      «Hydration failed because the initial UI does not match what was rendered on the server» —
//      is NOT excused, because that is what a genuine mismatch looks like when it is not merely
//      recoverable.
//   3. It is a NOTE, never a silent drop. Both callers must report the count and the text, so the
//      steady state stays visible and a spike is legible in the run output.

/** The recoverable-hydration family this repo has ruled pre-existing. Deliberately an allowlist of
 *  exactly three codes — never a `#\d+` wildcard, which would excuse every future React error. */
export const HYDRATION_NOTICE_RE = /Minified React error #(?:418|423|425)(?!\d)/;

/**
 * Is this page error React's recoverable-hydration notice rather than an application exception?
 *
 * Accepts an Error or a string. Returns false for everything else, including any other minified
 * React error and any unminified hydration failure — see the three narrowings above.
 */
export const isHydrationNoticePageError = (err) =>
  HYDRATION_NOTICE_RE.test(String(err && err.message ? err.message : err));

/** Human-readable note text, shared so both suites say the same thing about the same condition. */
export const hydrationNoticeNote = (journey, errors) =>
  `${journey}: ${errors.length} RECOVERABLE-HYDRATION notice(s) (React #418/#423/#425) — pre-existing `
  + `on this static export and NOT counted as a product defect; a genuine hydration regression is `
  + `caught by scripts/verify-live-hydration.mjs, the blocking post-deploy gate (see `
  + `e2e/lib/pageErrors.mjs): ${errors.join(' | ').slice(0, 300)}`;

// ── AN EMBEDDED SOURCE SITE'S GOOGLE MAPS ERROR IS NOT AN EZHALAH EXCEPTION (2026-11-03) ──────────
//
// On a phone, a result card opens the SOURCE site's own page inside Ezhalah's ad viewer (a real
// cross-site iframe, src/components/AdViewer.tsx). Some of those pages load Google Maps with
// `callback=initMap` and never define it, and Google's loader throws «InvalidValueError: initMap is not a
// function» inside THEIR frame. Playwright reports it as a page error of our page, so guardian failed
// `back-preserves-results [mobile]` on it (run 41590614252) while every product assertion passed — and
// desktop, where the card opens a separate tab the journey closes, passed the same journey.
//
// Narrow by construction, and mutation-proven in scripts/verify-embedded-site-page-errors.ts:
//   · ONLY Google Maps' own error class `InvalidValueError` — Ezhalah never loads Google Maps (it uses
//     Apple MapKit) and never names that class; that barrier FAILS the moment src/ does either, because
//     then this excuse would be hiding our own error.
//   · Any other error — TypeError, ReferenceError, a React error — stays an app defect.
//   · It is a NOTE, never a silent drop: both suites print the count and the text.
export const EMBEDDED_GOOGLE_MAPS_ERROR_RE = /^(?:Uncaught (?:\(in promise\) )?)?InvalidValueError: /;

/** Accepts an Error (name + message) or the string a harness captured. */
export const isEmbeddedSitePageError = (err) => {
  if (err && typeof err === 'object' && err.name === 'InvalidValueError') return true;
  return EMBEDDED_GOOGLE_MAPS_ERROR_RE.test(String(err && err.message ? err.message : err).trim());
};

export const embeddedSiteNote = (journey, errors) =>
  `${journey}: ${errors.length} EMBEDDED-SITE page error(s) — Google Maps' InvalidValueError thrown inside a source `
  + `site's own page in the ad viewer, NOT counted as a product defect (e2e/lib/pageErrors.mjs): `
  + `${errors.join(' | ').slice(0, 300)}`;
