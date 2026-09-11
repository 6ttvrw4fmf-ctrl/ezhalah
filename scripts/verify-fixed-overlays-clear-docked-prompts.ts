// BARRIER: an overlay THE APP ITSELF docks must be laid out clear of a FOREIGN prompt's band —
// `position: fixed` does not inherit the root's padding, so reserving the band there is not enough,
// and being a MEMBER of the shared band computation is not the same as MOVING OUT OF another
// member's way.
//
// WHY THIS EXISTS (ops_incident #163, 2026-09-11, regression hunter — an INCOMPLETE FIX of #120,
// re-diagnosed after ops_incident #152's owner-approved repair, PR #2267, changed the shape of the
// code underneath it without closing the gap).
//
// #120 ended with the app reserving a docked third-party auth prompt's height at its ROOT:
//
//     <View style={{ flex: 1, paddingTop: promptInset.top, paddingBottom: promptInset.bottom }}>
//
// and `verify-bottom-prompt-inset.ts` pins that. Correct — but `position: fixed` resolves against
// the VIEWPORT, so a fixed child never sees an ancestor's padding. `usePromptInsets()` had exactly
// ONE consumer — the root View — so every fixed overlay the app ITSELF docks sat outside the
// guarantee while reading as covered by it.
//
// FIRST MEASURED SHAPE (2026-09-11, entry-3545b04ac003d2a47e8bec8441b0fe2e.js): One Tap's legacy
// sheet owned the bottom 144 px at z-index 9999/pointer-events auto; CookieConsent stayed pinned at
// `bottom: 20`, its buttons inside its own bottom ~40 px — wholly inside the sheet.
//
// THE OWNER-APPROVED REPAIR THAT FOLLOWED (PR #2267, ops_incident #152) fixed a DIFFERENT half of
// the same class — the consent card no longer covers «بحث» — by making the card a MEMBER of
// `DOCKED_PROMPT_SELECTOR`, so the ROOT correctly reserves space for OTHER content around it. It did
// not close #163: the card's OWN element still paints at a fixed offset (`bottom: 20` beside the
// app, `bottom: 0` as the mobile sheet) with NOTHING shifting it when a FOREIGN prompt — One Tap —
// is ALSO docked. On a phone, One Tap's 144 px sheet then overlaps the bottom 144 of the consent
// card's own ~190 px sheet, exactly where its button row sits — the identical defect, new geometry.
// Confirmed by reading `verify-bottom-prompt-inset.ts`'s own new I-series: every case there measures
// the consent sheet and the One Tap sheet SEPARATELY; none co-docks them.
//
// THE FIX: `useForeignPromptInsets()` (src/lib/bottomPromptInset.ts) — the SAME band machinery,
// scoped to `AUTH_PROMPT_SELECTOR` only, so a card that is itself a `DOCKED_PROMPT_SELECTOR` member
// can consume it without folding its own rect back into its own required offset. Both of
// CookieConsent's branches (desktop corner, mobile sheet) now compute their `bottom` as
// `dockedEdgeOffset(base, foreignInset.bottom)`.
//
// THE INVARIANT, independent of card height: if `offset = dockedEdgeOffset(base, band) >= band`,
// the card's bottom edge (`VH - offset`) sits at or above the foreign sheet's top edge
// (`VH - band`), so the ENTIRE card — however tall, however many buttons — is above the sheet. This
// is why the barrier does not need to model the card's internal layout to prove its buttons are
// safe; it only needs to prove the ONE offset relation, for BOTH branches.
//
// WHY A NEW FILE RATHER THAN EXTENDING verify-bottom-prompt-inset.ts: that barrier owns the INSET's
// geometry — how big a band is and which rects qualify — and it was green for the whole time this
// defect was live in both its shapes, because the band was computed correctly and then applied
// somewhere a fixed child (or a co-docked sibling) cannot see. This file owns the other half:
// whatever the band is, every overlay the app docks must get OUT OF A FOREIGN ONE'S WAY. Neither
// subsumes the other.
//
// THE TWO HALVES BELOW. §A EXECUTES the real shipped `dockedEdgeOffset`/`useForeignPromptInsets`
// wiring against the measured One Tap geometry, for BOTH of CookieConsent's branches. §B DISCOVERS
// every `position: 'fixed'` overlay in src/ at run time and fails on any that is not classified — so
// a new overlay is RED until someone says which kind it is, rather than silently repeating #163. A
// hardcoded list of today's overlays is the same staleness trap that produced this bug twice.
//
//   node --experimental-strip-types scripts/verify-fixed-overlays-clear-docked-prompts.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bottomPromptInset, dockedEdgeOffset } from '../src/lib/bottomPromptInset.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── §A. THE MEASURED CASE, EXECUTED ──────────────────────────────────────────────────────────────
// The SAME measured One Tap geometry `verify-bottom-prompt-inset.ts` uses (BOTTOM_SHEET) — not a
// second, retyped set of numbers (feedback_never-test-a-copy-of-production-code).
const VH_PHONE = 812;
const VW_PHONE = 375;
const BOTTOM_SHEET = { top: 668, bottom: 812, height: 144, width: 375 };
const BAND = bottomPromptInset(BOTTOM_SHEET, VH_PHONE, VW_PHONE);   // the real function, not 144

// CookieConsent's own two bases — read from the component rather than retyped, so a future geometry
// change is caught here rather than silently validated against stale numbers.
const consentSrc = readFileSync(join(SRC, 'components/CookieConsent.tsx'), 'utf8');
const baseMatch = (label: string, re: RegExp): number => {
  const m = consentSrc.match(re);
  check(`A0. the consent card's ${label} base is a literal this barrier can read`, !!m,
    `pattern ${re} not found in src/components/CookieConsent.tsx`);
  return m ? Number(m[1]) : NaN;
};
const DESKTOP_BASE = baseMatch('desktop-corner', /right:\s*20,\s*bottom:\s*dockedEdgeOffset\((\d+),/);
const MOBILE_BASE = baseMatch('mobile-sheet', /left:\s*0,\s*right:\s*0,\s*bottom:\s*dockedEdgeOffset\((\d+),/);

/**
 * The whole invariant, independent of the card's own height (see file header). `offset >= band`
 * alone proves the entire card clears the sheet, on either branch.
 */
const clearsForeignSheet = (offsetFn: (base: number, inset: number) => number, base: number, band: number): boolean =>
  offsetFn(base, band) >= band;

/** Every problem §A can see for ONE branch, as data, so the mutation proof re-runs the SAME checks. */
function branchProblems(offsetFn: (base: number, inset: number) => number, base: number, label: string): string[] {
  const problems: string[] = [];
  if (!clearsForeignSheet(offsetFn, base, BAND)) {
    problems.push(`${label}: docked — offset ${offsetFn(base, BAND)} < foreign band ${BAND}`);
  }
  // Nothing foreign docked must move nothing — the path that was already correct stays byte-identical.
  if (offsetFn(base, 0) !== base) {
    problems.push(`${label}: undocked — offset moved to ${offsetFn(base, 0)}, expected ${base}`);
  }
  return problems;
}

{
  check('A1. the real inset function still reads the measured One Tap sheet as a 144 px band',
    BAND === 144, `got ${BAND}`);
  check('A2. WITHOUT folding in the band, EITHER branch would sit inside the sheet (this was the bug)',
    DESKTOP_BASE < BAND && MOBILE_BASE < BAND,
    `desktop base ${DESKTOP_BASE}, mobile base ${MOBILE_BASE}, band ${BAND}`);
  check('A3. WITH dockedEdgeOffset, the desktop-corner branch clears the sheet',
    branchProblems(dockedEdgeOffset, DESKTOP_BASE, 'desktop').length === 0,
    branchProblems(dockedEdgeOffset, DESKTOP_BASE, 'desktop').join(' | '));
  check('A4. WITH dockedEdgeOffset, the mobile-sheet branch clears the sheet',
    branchProblems(dockedEdgeOffset, MOBILE_BASE, 'mobile').length === 0,
    branchProblems(dockedEdgeOffset, MOBILE_BASE, 'mobile').join(' | '));
  // Degenerate inputs must never amplify into a card flung off-screen.
  check('A5. a negative or nonsense band is ignored, never subtracted',
    dockedEdgeOffset(DESKTOP_BASE, -50) === DESKTOP_BASE
    && dockedEdgeOffset(DESKTOP_BASE, NaN) === DESKTOP_BASE);
  check('A6. a nonsense base does not inherit the band as its whole position',
    dockedEdgeOffset(NaN, BAND) === BAND && dockedEdgeOffset(-10, BAND) === BAND);
}

// ── §B. DISCOVERY — every fixed overlay in src/ is classified, or this goes red ───────────────────
// The three kinds, and what each owes a FOREIGN docked band:
//   full-screen  pinned on all four edges. It covers a foreign prompt too, so "get out of its way"
//                is meaningless — the same judgement promptInsets() already makes internally
//                ("a rect that qualifies on BOTH edges is a modal, not a dock").
//   edge-docked  anchored to ONE edge, not movable by the visitor, and (per #152) itself a member of
//                DOCKED_PROMPT_SELECTOR. MUST fold a FOREIGN-only band into its own offset via
//                dockedEdgeOffset — using the combined usePromptInsets() here would be
//                self-referential (it counts this very overlay's own rect). This is the kind #163
//                was, twice.
//   draggable    the visitor positions it and can move it out from under anything.
const KIND = { FULL_SCREEN: 'full-screen', EDGE_DOCKED: 'edge-docked', DRAGGABLE: 'draggable' } as const;
type Kind = typeof KIND[keyof typeof KIND];

const REGISTRY: Record<string, { kind: Kind; why: string }> = {
  'src/app/browser.tsx': { kind: KIND.FULL_SCREEN, why: 'inset:0 backdrop at z-index 9998' },
  'src/components/AccountMenu.tsx': { kind: KIND.FULL_SCREEN, why: 'full-viewport click-catcher + centred dialog root, all four edges 0' },
  'src/components/AuthModal.tsx': { kind: KIND.FULL_SCREEN, why: 'centred modal pinned to the viewport on all four edges' },
  'src/components/Sidebar.tsx': { kind: KIND.FULL_SCREEN, why: 'dcRoot centred dialog, all four edges 0' },
  'src/components/SignInCard.tsx': { kind: KIND.DRAGGABLE, why: 'top:0/left:0 + a drag translate the visitor owns; grab strip is at the card top, clear of a bottom band at its default position' },
  'src/components/CookieConsent.tsx': { kind: KIND.EDGE_DOCKED, why: 'bottom-anchored (corner on desktop, flush sheet on mobile), not movable — ops_incident #163/#152' },
};

/** Every file under src/ that puts something into `position: 'fixed'`. */
function discoverFixedOverlays(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { discoverFixedOverlays(p, out); continue; }
    if (!/\.(tsx|ts)$/.test(name)) continue;
    if (/position:\s*'fixed'/.test(readFileSync(p, 'utf8'))) out.push(relative(ROOT, p));
  }
  return out;
}

/** The whole of §B as data, so the mutation proof can run it against a doctored world. */
function registryProblems(
  found: string[],
  registry: Record<string, { kind: Kind; why: string }>,
  reads: (file: string) => string,
): string[] {
  const problems: string[] = [];
  for (const file of found) {
    const entry = registry[file];
    if (!entry) {
      problems.push(`UNCLASSIFIED fixed overlay ${file} — say which kind it is, and if it is edge-docked make it fold a FOREIGN-only band into its offset (ops_incident #163)`);
      continue;
    }
    if (entry.kind !== KIND.EDGE_DOCKED) continue;
    // An edge-docked overlay must actually COMPUTE its anchor from a FOREIGN-only band, via
    // useForeignPromptInsets — never the combined usePromptInsets, which would be self-referential
    // now that #152 made this overlay itself a DOCKED_PROMPT_SELECTOR member. And asserting that the
    // file merely MENTIONS dockedEdgeOffset is not enough: the first cut of this barrier checked
    // exactly that, and a mutant that reverted only the ANCHOR while leaving the import/hook call in
    // place SURVIVED it — the source-TEXT tripwire AGENTS.md calls out. So: read the ANCHORS.
    const src = reads(file);
    if (!/useForeignPromptInsets/.test(src)) {
      problems.push(`${file} is edge-docked but never reads a FOREIGN-only prompt band (expects useForeignPromptInsets)`);
    }
    const anchors = [...src.matchAll(/(?<![A-Za-z.])(top|bottom)\s*:\s*([^,\n}]+)/g)]
      .map((m) => ({ edge: m[1], expr: m[2].trim() }));
    const derived = anchors.filter((a) => /^dockedEdgeOffset\(/.test(a.expr));
    if (derived.length === 0) {
      problems.push(`${file} is edge-docked but no top:/bottom: anchor is computed by dockedEdgeOffset(...) — the band is not folded in`);
    }
    // A second, HARD anchor beside the derived one(s) would win or fight with it. A bare `bottom: 20`
    // or `bottom: 0` living on beside a computed one is precisely how #163 shipped, twice.
    const hard = anchors.filter((a) => !/^dockedEdgeOffset\(/.test(a.expr) && /^(-?\d+(\.\d+)?|[A-Z_][A-Z0-9_]*)$/.test(a.expr));
    if (hard.length > 0) {
      problems.push(`${file} still pins ${hard.map((h) => `${h.edge}: ${h.expr}`).join(', ')} — a hard edge anchor beside the band-aware one re-creates ops_incident #163`);
    }
  }
  for (const file of Object.keys(registry)) {
    if (!found.includes(file)) {
      problems.push(`${file} is registered as a fixed overlay but no longer declares position:'fixed' — drop the entry or restore it`);
    }
  }
  return problems;
}

const found = discoverFixedOverlays(SRC).sort();
const readSrc = (f: string) => readFileSync(join(ROOT, f), 'utf8');
{
  check('B0. discovery actually found the fixed overlays (an empty sweep proves nothing)',
    found.length >= 5, `found ${found.length}`);
  const problems = registryProblems(found, REGISTRY, readSrc);
  check('B1. every fixed overlay in src/ is classified, and every edge-docked one folds in a foreign-only band',
    problems.length === 0, problems.join('\n      '));
  console.log(`      (${found.length} fixed overlays: ${found.map((f) => `${f.split('/').pop()}=${REGISTRY[f]?.kind ?? '??'}`).join(', ')})`);
}

// ── §C. MUTATION PROOFS — each rule, deliberately broken, must turn a check above red ────────────
console.log('\n── mutation ──');
const mustCatch = (what: string, caught: boolean, detail = '') =>
  check(`(mutation) catches ${what}`, caught,
    detail || 'MUTANT SURVIVED — the assertions above are blind to the defect this file exists for');

// M1: the pre-#163 behaviour — a fixed overlay that ignores the band, i.e. exactly what shipped.
const preFixOffset = (base: number, _inset: number) => base;
mustCatch('the pre-#163 offset that ignores the reserved band (either branch)',
  branchProblems(preFixOffset, DESKTOP_BASE, 'desktop').length > 0
  && branchProblems(preFixOffset, MOBILE_BASE, 'mobile').length > 0);

// M2: an overlay that "reserves" the band by always adding a constant would move the card even with
// nothing foreign docked — permanent whitespace, the regression #120 explicitly refused to introduce.
const alwaysPad = (base: number, _inset: number) => base + 144;
mustCatch('an offset that pads unconditionally (permanent whitespace when nothing foreign is docked)',
  branchProblems(alwaysPad, MOBILE_BASE, 'mobile').some((p) => /undocked/.test(p)));

// M3: a NEW fixed overlay nobody classified must go red rather than pass silently.
mustCatch('a new, unclassified fixed overlay',
  registryProblems([...found, 'src/components/NewFloatingThing.tsx'], REGISTRY, readSrc)
    .some((p) => /UNCLASSIFIED/.test(p)));

// M4: an edge-docked overlay whose anchor no longer comes from the band.
mustCatch('an edge-docked overlay whose anchor is not computed by dockedEdgeOffset',
  registryProblems(found, REGISTRY, (f) =>
    f === 'src/components/CookieConsent.tsx' ? readSrc(f).replace(/dockedEdgeOffset/g, 'xx') : readSrc(f))
    .some((p) => /no top:\/bottom: anchor is computed/.test(p)));

// M4b: THE SHAPE THAT ACTUALLY SHIPPED, TWICE. Revert only the ANCHOR(S) to a bare constant while
// leaving the import and the useForeignPromptInsets() call untouched. The first cut of this barrier
// checked only that the file MENTIONED dockedEdgeOffset, and this mutant survived it. It must not.
mustCatch('an anchor reverted to a bare constant while the import and hook call stay in place',
  registryProblems(found, REGISTRY, (f) =>
    f === 'src/components/CookieConsent.tsx'
      ? readSrc(f)
          .replace(/bottom: dockedEdgeOffset\(20, foreignInset\.bottom\)/, 'bottom: 20')
          .replace(/bottom: dockedEdgeOffset\(0, foreignInset\.bottom\)/, 'bottom: 0')
      : readSrc(f))
    .some((p) => /hard edge anchor/.test(p)));

// M4c: reintroducing the SELF-REFERENTIAL combined hook (usePromptInsets) in place of the
// foreign-only one must be caught — this is the mistake the file header warns against by name.
mustCatch('the combined (self-referential) usePromptInsets used instead of the foreign-only hook',
  registryProblems(found, REGISTRY, (f) =>
    f === 'src/components/CookieConsent.tsx'
      ? readSrc(f).replace(/useForeignPromptInsets/g, 'usePromptInsets').replace(/foreignInset/g, 'promptInsets')
      : readSrc(f))
    .some((p) => /never reads a FOREIGN-only prompt band/.test(p)));

// M5: deleting an entry's overlay (or the entry going stale) must not read as clean.
mustCatch('a registry entry whose file no longer declares position:\'fixed\'',
  registryProblems(found.filter((f) => f !== 'src/components/CookieConsent.tsx'), REGISTRY, readSrc)
    .some((p) => /no longer declares/.test(p)));

// ── §D. WIRING ───────────────────────────────────────────────────────────────────────────────────
console.log('');
check('D1. the root still applies the band it computes (the #120 half this file does not replace)',
  /paddingBottom:\s*promptInset\.bottom/.test(readFileSync(join(SRC, 'app/_layout.tsx'), 'utf8')));
check('D2. this barrier is discovered by `npm test`',
  npmTestRuns(ROOT, 'verify-fixed-overlays-clear-docked-prompts'));

console.log(failures === 0 ? '\nOK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
