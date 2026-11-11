// THE MAP'S POP-UP CARDS CLOSE WHEN THE USER DOES SOMETHING ELSE (owner 2026-11-03, a screenshot with the «نوع الأرض»
// ground-type card open: «if the user selects something else it goes away — I clicked the satellite photo and it
// didn't go away»). Opening the layers card did not close the ground card, and neither closed on a map tap or move.
// This barrier pins every way out: the two cards are one family (opening one closes the other), choosing a map style,
// touching or moving the map, a pin or bubble tap, the zoom buttons, the draw button and full screen all close both.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const hasAll = (src: string) =>
  /const closePanels = \(\) => \{ setLayersOpen\(false\); setGroundOpen\(false\); \};/.test(src)
  && /setMapType\(k\);\n\s*closePanels\(\);/.test(src)                                              // choosing a map style
  && /onPress=\{\(\) => \{ setLayersOpen\(\(o\) => !o\); setGroundOpen\(false\); \}\}/.test(src)         // layers button closes ground
  && /onPress=\{\(\) => \{ setGroundOpen\(\(o\) => !o\); setLayersOpen\(false\); \}\}/.test(src)         // ground button closes layers
  && /lastPick = Date\.now\(\);\n\s*closePanels\(\);/.test(src)                                         // a pin or bubble tap
  && /onSurface\(m, 'pointerdown', closePanels\)/.test(src)                                           // touching the map
  && /m\.addEventListener\('region-change-start', closePanels\)/.test(src)                            // moving the map
  && /m\.removeEventListener\('region-change-start', closePanels as unknown as \(e: unknown\) => void\)/.test(src)
  && /const zoomBy = \(f: number\) => \{\n\s*closePanels\(\);/.test(src)                                // the zoom buttons
  && /const startDrawing = \(\) => \{ closePanels\(\);/.test(src)                                      // the draw button
  && /onPress=\{\(\) => \{ closePanels\(\); onExpand\(\);(?: openFull\(\);)? \}\}/.test(src);           // full screen (then the «tap to open» hint is remembered as seen)
check('every way of doing something else on the map closes both pop-up cards', hasAll(web));

// Mutation proofs: remove each exit in turn; the predicate must reject every one of them.
const without = (needle: string | RegExp) => web.replace(needle, '');
mustCatch('the ground card staying open after the layers button (the screenshot defect)', !hasAll(without("setLayersOpen((o) => !o); setGroundOpen(false);")));
mustCatch('the cards staying open while the map is touched', !hasAll(without("const offPanelsClose = onSurface(m, 'pointerdown', closePanels);")));
mustCatch('the cards staying open while the map moves', !hasAll(without("m.addEventListener('region-change-start', closePanels);")));
mustCatch('a map style choice that leaves the card open', !hasAll(without("setMapType(k);\n    closePanels();")));
mustCatch('a zoom button that leaves the cards open', !hasAll(without("const zoomBy = (f: number) => {\n    closePanels();")));

if (failed) { console.error(`\n❌ verify-map-cards-close-on-other-actions: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-cards-close-on-other-actions: all checks passed');
