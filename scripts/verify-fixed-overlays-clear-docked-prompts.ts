// BARRIER: an overlay THE APP ITSELF docks must be laid out clear of a foreign prompt's band —
// `position: fixed` does not inherit the root's padding, so reserving the band there is not enough.
//
// WHY THIS EXISTS (ops_incident #163, 2026-09-11, regression hunter — an INCOMPLETE FIX of #120).
//
// #120 ended with the app reserving a docked third-party auth prompt's height at its ROOT:
//
//     <View style={{ flex: 1, paddingTop: promptInset.top, paddingBottom: promptInset.bottom }}>
//
// and `verify-bottom-prompt-inset.ts` §E2 pins exactly that. Both are correct. What neither asks is
// whether every control the visitor needs is actually laid out INSIDE that padded box. A
// `position: fixed` child is not: fixed resolves against the VIEWPORT, so an ancestor's padding is
// invisible to it by definition. `usePromptInsets()` had exactly ONE consumer in the whole tree —
// the root View — so every fixed overlay sat outside the guarantee while reading as covered by it.
//
// The cost, measured on the served bundle entry-3545b04ac003d2a47e8bec8441b0fe2e.js, which carries
// BOTH the inset mechanism and the consent card, so this was live and not latent:
//
//   · One Tap's legacy sheet owns the bottom 144 px at `z-index: 9999; pointer-events: auto`.
//   · CookieConsent stayed pinned at `bottom: 20`, its button row in its own bottom ~40 px — i.e.
//     viewport y ∈ [VH−75, VH−38], wholly inside [VH−144, VH].
//   · So «السماح بالكل» and «الضروري فقط» both hit-test to Google's iframe. A signed-out visitor
//     cannot record the Only-necessary choice at all, and the card's own search-dismissal then
//     records Allow-all on their behalf.
//
// The two surfaces target the IDENTICAL visitor — signed out, on the web — so on the legacy One Tap
// path this is the DEFAULT first-visit state, not a corner case. Neither owner could see it alone:
// with no prompt docked the card is fine, and with no card docked the prompt is fine. It exists only
// in the composition.
//
// WHY A NEW FILE RATHER THAN EXTENDING verify-bottom-prompt-inset.ts: that barrier owns the INSET's
// geometry — how big the band is — and it was green for the whole time this defect was live, because
// the band was computed perfectly correctly and then applied somewhere a fixed child cannot see. It
// is not wrong about anything it asserts, so it is left alone. This file owns the other half:
// whatever the band is, every overlay the app docks must be OUTSIDE it. Neither subsumes the other.
//
// THE TWO HALVES BELOW, and why the second one is what keeps this working. §A EXECUTES the real
// shipped `dockedEdgeOffset` against the measured One Tap geometry. §B DISCOVERS every
// `position: 'fixed'` overlay in src/ at run time and fails on any that is not classified — so an
// overlay added tomorrow is RED until someone says which kind it is, rather than silently repeating
// #163. A hardcoded list of today's overlays is the same staleness trap that produced this bug.
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
// Google's legacy One Tap bottom sheet, exactly as #120 measured it on production.
const VH = 812;
const SHEET = { top: VH - 144, bottom: VH, height: 144 };
const BAND = bottomPromptInset(SHEET, VH);          // the real function, not a transcribed 144

// The consent card's own gap from the edge, READ FROM THE COMPONENT rather than retyped here — a
// retyped constant is a second, unshipped program, which is the defect class this repo keeps
// getting burned by (feedback_never-test-a-copy-of-production-code).
const consentSrc = readFileSync(join(SRC, 'components/CookieConsent.tsx'), 'utf8');
const gapMatch = consentSrc.match(/const\s+EDGE_GAP\s*=\s*(\d+)/);
check('A0. the consent card declares its edge gap as a named constant this barrier can read',
  !!gapMatch, 'EDGE_GAP not found in src/components/CookieConsent.tsx');
const EDGE_GAP = gapMatch ? Number(gapMatch[1]) : NaN;

/**
 * The whole invariant, in one line of arithmetic and independent of the card's height.
 *
 * The card's bottom edge sits at viewport y = VH − offset; the sheet's top edge at y = VH − band.
 * "The card is entirely above the sheet" is therefore exactly `offset >= band`. Stating it this way
 * rather than by measuring the card means a taller card, a longer translation or an extra button row
 * can never quietly invalidate the proof.
 */
const cardClearsSheet = (offsetFn: (base: number, inset: number) => number, band: number): boolean =>
  offsetFn(EDGE_GAP, band) >= band;

/** Every problem §A can see, as data, so the mutation proof can re-run the SAME assertions. */
function geometryProblems(offsetFn: (base: number, inset: number) => number): string[] {
  const problems: string[] = [];
  if (!cardClearsSheet(offsetFn, BAND)) {
    problems.push(`docked: card bottom offset ${offsetFn(EDGE_GAP, BAND)} < reserved band ${BAND}`);
  }
  // Nothing docked must move nothing — the path that was already correct stays byte-identical.
  if (offsetFn(EDGE_GAP, 0) !== EDGE_GAP) {
    problems.push(`undocked: offset moved to ${offsetFn(EDGE_GAP, 0)}, expected ${EDGE_GAP}`);
  }
  // The button row — what the visitor actually has to hit — must clear the sheet too. Modelled from
  // the card's own declared box: paddingVertical 18 below the row, the row itself ~37 px tall.
  const BTN_BOTTOM_PAD = 18, BTN_H = 37;
  const offset = offsetFn(EDGE_GAP, BAND);
  const btnBottomY = VH - offset - BTN_BOTTOM_PAD;
  if (btnBottomY > SHEET.top) {
    problems.push(`the consent buttons land at y≤${btnBottomY}, inside the sheet starting at ${SHEET.top}`);
  }
  void BTN_H;
  return problems;
}

{
  check('A1. the real inset function still reads the measured sheet as a 144 px band', BAND === 144,
    `got ${BAND}`);
  // The bug, stated as arithmetic over the SAME geometry: at a bare 20 px gap the card is inside it.
  check('A2. WITHOUT folding in the band the card sits inside the sheet (this is the bug)',
    EDGE_GAP < BAND, `gap ${EDGE_GAP} vs band ${BAND}`);
  check('A3. WITH the shipped dockedEdgeOffset the card clears the sheet (this is the fix)',
    geometryProblems(dockedEdgeOffset).length === 0,
    geometryProblems(dockedEdgeOffset).join(' | '));
  // Degenerate inputs must never amplify into a card flung off-screen.
  check('A4. a negative or nonsense band is ignored, never subtracted',
    dockedEdgeOffset(EDGE_GAP, -50) === EDGE_GAP
    && dockedEdgeOffset(EDGE_GAP, NaN) === EDGE_GAP);
  check('A5. a nonsense base does not inherit the band as its whole position',
    dockedEdgeOffset(NaN, BAND) === BAND && dockedEdgeOffset(-10, BAND) === BAND);
}

// ── §B. DISCOVERY — every fixed overlay in src/ is classified, or this goes red ───────────────────
// The three kinds, and what each owes the docked band:
//   full-screen  pinned on all four edges. It covers the prompt too, so "reserve a band" is
//                meaningless for it — the same judgement promptInsets() already makes internally
//                ("a rect that qualifies on BOTH edges is a modal, not a dock").
//   edge-docked  anchored to ONE edge at a fixed offset and not movable by the visitor. MUST fold
//                the band into that offset. This is the kind #163 was.
//   draggable    the visitor positions it and can move it out from under anything.
const KIND = { FULL_SCREEN: 'full-screen', EDGE_DOCKED: 'edge-docked', DRAGGABLE: 'draggable' } as const;
type Kind = typeof KIND[keyof typeof KIND];

const REGISTRY: Record<string, { kind: Kind; why: string }> = {
  'src/app/browser.tsx': { kind: KIND.FULL_SCREEN, why: 'inset:0 backdrop at z-index 9998' },
  'src/components/AccountMenu.tsx': { kind: KIND.FULL_SCREEN, why: 'full-viewport click-catcher + centred dialog root, all four edges 0' },
  'src/components/AuthModal.tsx': { kind: KIND.FULL_SCREEN, why: 'centred modal pinned to the viewport on all four edges' },
  'src/components/Sidebar.tsx': { kind: KIND.FULL_SCREEN, why: 'dcRoot centred dialog, all four edges 0' },
  'src/components/SignInCard.tsx': { kind: KIND.DRAGGABLE, why: 'top:0/left:0 + a drag translate the visitor owns; grab strip is at the card top, clear of a bottom band at its default position' },
  'src/components/CookieConsent.tsx': { kind: KIND.EDGE_DOCKED, why: 'bottom-anchored, not movable — ops_incident #163' },
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
      problems.push(`UNCLASSIFIED fixed overlay ${file} — say which kind it is, and if it is edge-docked make it fold in the prompt band (ops_incident #163)`);
      continue;
    }
    if (entry.kind !== KIND.EDGE_DOCKED) continue;
    // An edge-docked overlay must actually COMPUTE its anchor from the band. Asserting that the file
    // merely mentions dockedEdgeOffset is not enough, and that is not a hypothetical: the first cut
    // of this barrier did exactly that, and a mutation which reverted the anchor to `bottom: EDGE_GAP`
    // while leaving the import and the hook call in place SURVIVED it. A guard satisfied by an unused
    // import is the source-TEXT tripwire this repo keeps getting burned by (AGENTS.md, "Barriers for
    // this class must EXECUTE"). So: read the ANCHORS themselves.
    const src = reads(file);
    if (!/usePromptInsets/.test(src)) {
      problems.push(`${file} is edge-docked but never reads the prompt band (expects usePromptInsets)`);
    }
    const anchors = [...src.matchAll(/(?<![A-Za-z.])(top|bottom)\s*:\s*([^,\n}]+)/g)]
      .map((m) => ({ edge: m[1], expr: m[2].trim() }));
    const derived = anchors.filter((a) => /^dockedEdgeOffset\(/.test(a.expr));
    if (derived.length === 0) {
      problems.push(`${file} is edge-docked but no top:/bottom: anchor is computed by dockedEdgeOffset(...) — the band is not folded in`);
    }
    // A second, HARD anchor beside the derived one would win or fight with it. `bottom: 20` living on
    // in the stylesheet is precisely how #163 shipped.
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
  check('B1. every fixed overlay in src/ is classified, and every edge-docked one folds in the band',
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
mustCatch('the pre-#163 offset that ignores the reserved band',
  geometryProblems(preFixOffset).length > 0);
// …and it is wrong in the exact way production was: the card lands INSIDE the sheet.
mustCatch('…specifically by putting the consent buttons inside the sheet',
  geometryProblems(preFixOffset).some((p) => /inside the sheet/.test(p)),
  geometryProblems(preFixOffset).join(' | '));

// M2: an overlay that "reserves" the band by always adding a constant would move the card even with
// nothing docked — permanent whitespace, the regression #120 explicitly refused to introduce.
const alwaysPad = (base: number, _inset: number) => base + 144;
mustCatch('an offset that pads unconditionally (permanent whitespace when nothing is docked)',
  geometryProblems(alwaysPad).some((p) => /^undocked/.test(p)));

// M3: a NEW fixed overlay nobody classified must go red rather than pass silently.
mustCatch('a new, unclassified fixed overlay',
  registryProblems([...found, 'src/components/NewFloatingThing.tsx'], REGISTRY, readSrc)
    .some((p) => /UNCLASSIFIED/.test(p)));

// M4: an edge-docked overlay whose anchor no longer comes from the band.
mustCatch('an edge-docked overlay whose anchor is not computed by dockedEdgeOffset',
  registryProblems(found, REGISTRY, (f) =>
    f === 'src/components/CookieConsent.tsx' ? readSrc(f).replace(/dockedEdgeOffset/g, 'xx') : readSrc(f))
    .some((p) => /no top:\/bottom: anchor is computed/.test(p)));

// M4b: THE ONE THAT MATTERED. Revert only the ANCHOR to a bare constant — exactly how #163 shipped —
// while leaving the import and the usePromptInsets() call untouched. The first cut of this barrier
// checked only that the file MENTIONED dockedEdgeOffset, and this mutant survived it. It must not.
mustCatch('an anchor reverted to a bare constant while the import and hook call stay in place',
  registryProblems(found, REGISTRY, (f) =>
    f === 'src/components/CookieConsent.tsx'
      ? readSrc(f).replace(/bottom: dockedEdgeOffset\(EDGE_GAP, promptInsets\.bottom\)/, 'bottom: EDGE_GAP')
      : readSrc(f))
    .some((p) => /hard edge anchor/.test(p)));

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
