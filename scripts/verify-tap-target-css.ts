// THE 44px TAP FLOOR MUST STAY LAYOUT-NEUTRAL AND NEIGHBOUR-SAFE (ops_incident #17).
//
// react-native-web 0.21.2 does not implement `hitSlop` on `Pressable` — only the legacy `Touchable`
// reads it. All 39 `hitSlop` declarations in src/ sit on `Pressable`, so each one contributes
// exactly ZERO pixels and the tap area is the raw style box. Measured on production at 375px, nine
// controls on the two busiest screens were under the floor:
//
//     34x34   sidebar hamburger (both screens)      hitSlop 8  → intended 50
//     193x32  top sign-in pill (both screens)       hitSlop 6  → intended 44
//     106x36  ModeSwitch «تصفية» and «الوكيل الذكي» hitSlop 6  → intended 48
//     34x34   composer Stop / mic / cancel / stop-recording / send / search
//
// Every one of them ALREADY declared a hitSlop that would have cleared 44. The design intent was
// in the source the whole time; the platform was dropping it. So the fix invents no new numbers.
//
// WHAT THIS FILE GUARDS, AND WHAT IT DELIBERATELY DOES NOT. This is the SOURCE half: the CSS
// declarations that make the rule safe, and its wiring into the stylesheet that actually ships.
// The BEHAVIOURAL half — real boxes measured in a real browser — is the journey
// `tap-targets-meet-44` in e2e/journeys/run.mjs, which runs against production on three engines.
// Both halves exist on purpose: earlier today the ⋯-rename defect (#20) was pinned by TWO
// source-text barriers that passed for its entire life, because they asserted the line said what it
// said, which was true and was the bug. A source pin is worth having and is never the whole proof.
//
// THE TWO DECLARATIONS THAT CARRY THE SAFETY, and why a mutation of either is a real regression:
//
//   position:absolute   is what makes it LAYOUT-NEUTRAL. An out-of-flow pseudo-element cannot
//                       change the host's box, its flex sizing, its `gap`, or a sibling's position.
//                       Padding — the usual advice — touches the box model, paints with the host's
//                       background, and interacts with flex. Measured: with this rule the two
//                       busiest screens render pixel-for-pixel identically (0 of 1,218,000 pixels
//                       differ) and every control's box is unchanged.
//
//   min-width/min-height is what makes it NEIGHBOUR-SAFE. It grows ONLY an axis actually under the
//                       floor. The two ModeSwitch tabs are 106px wide and TOUCHING (gapX = 0,
//                       measured on production): plain `width:44px` would be inert there too, but
//                       `width:100%` plus a hard `width` floor — or any uniform outset — would have
//                       expanded them horizontally into each other and stolen the neighbour's edge
//                       presses. With min-*, their 106px axis is untouched and only the short 36px
//                       axis grows, into 26-44px of free vertical space.
//
// Run: node --experimental-strip-types scripts/verify-tap-target-css.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { TAP_TARGET_CSS, TAP_TARGET_MIN, TAP44, buildThemeCss } from '../src/theme/palette.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, cond: boolean) => {
  if (cond) console.log(`  ok  ${m}`);
  else { console.error(`  FAIL  ${m}`); failed++; }
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

/** Parse one CSS rule into { selector, decls } so assertions read properties, not substrings. */
function parseRule(css: string) {
  const m = /^([^{]+)\{([^}]*)\}\s*$/.exec(css.trim());
  if (!m) return null;
  const decls: Record<string, string> = {};
  for (const part of m[2].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return { selector: m[1].trim(), decls };
}

console.log('§1 the rule is the shape that makes it safe');
const rule = parseRule(TAP_TARGET_CSS);
check('TAP_TARGET_CSS is a single parseable rule', !!rule);
if (rule) {
  check(`it is a ::after pseudo-element rule (got «${rule.selector}»)`, rule.selector.endsWith('::after'));
  check('it declares content, without which a pseudo-element does not render',
    rule.decls.content !== undefined);
  check('LAYOUT NEUTRALITY: position is absolute, so the overlay is out of flow',
    rule.decls.position === 'absolute');
  check('it adds no padding and no margin — those would move the box it is protecting',
    !('padding' in rule.decls) && !('margin' in rule.decls)
    && !Object.keys(rule.decls).some((k) => k.startsWith('padding-') || k.startsWith('margin-')));
  check('it paints nothing (no background, border, outline or box-shadow)',
    !Object.keys(rule.decls).some((k) => /^(background|border|outline|box-shadow)/.test(k)));
  check(`NEIGHBOUR SAFETY: the floor is min-width/min-height at ${TAP_TARGET_MIN}px, never a hard width/height`,
    rule.decls['min-width'] === `${TAP_TARGET_MIN}px` && rule.decls['min-height'] === `${TAP_TARGET_MIN}px`);
  check('the base size still tracks the host (width/height 100%), so an already-large control never shrinks',
    rule.decls.width === '100%' && rule.decls.height === '100%');
  check('it is centred on the host, so growth is symmetric rather than one-sided',
    rule.decls.top === '50%' && rule.decls.left === '50%' && /translate\(-50%,\s*-50%\)/.test(rule.decls.transform || ''));
}

console.log('\n§2 the marker and the selector cannot drift apart');
const markerKeys = Object.keys(TAP44);
check('TAP44 carries exactly one key', markerKeys.length === 1);
// RNW renders dataSet key `tap44` as the DOM attribute `data-tap44`.
const attr = `data-${markerKeys[0]}`;
check(`the rule's selector targets [${attr}], the attribute TAP44 actually produces`,
  !!rule && rule.selector.startsWith(`[${attr}]`));

console.log('\n§3 the rule actually ships');
const themeCss = buildThemeCss();
check('buildThemeCss() — the <style> body +html.tsx injects — contains the rule',
  themeCss.includes(TAP_TARGET_CSS));
const html = readFileSync(join(ROOT, 'src/app/+html.tsx'), 'utf8');
check('+html.tsx injects buildThemeCss() into the document head',
  /buildThemeCss\(\)/.test(html));

console.log('\n§4 every marked control really imports the marker (no orphan attributes)');
{
  const files = ['src/app/index.tsx', 'src/app/agent.tsx', 'src/components/ModeSwitch.tsx'];
  let marks = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const uses = (src.match(/\.\.\.TAP44/g) || []).length;
    marks += uses;
    if (uses) {
      check(`${f}: ${uses} marked control(s), and it imports TAP44`,
        /import\s*\{[^}]*\bTAP44\b[^}]*\}\s*from\s*'@\/theme\/palette'/.test(src));
    }
  }
  // The nine measured under-floor controls, all marked. A tenth is fine; fewer means one was lost.
  check(`all nine measured under-floor controls are marked (found ${marks})`, marks >= 9);
}

console.log('\n§5 mutations — each flips a real declaration in the real exported string');
{
  const mutate = (from: string, to: string) => parseRule(TAP_TARGET_CSS.replace(from, to));
  // M1 — padding instead of an out-of-flow overlay: the classic advice, and it moves the box.
  const m1 = parseRule(TAP_TARGET_CSS.replace('position:absolute', 'position:relative;padding:5px'));
  mustCatch('an overlay made position:relative with padding (it would move the host and its siblings)',
    !(m1 && m1.decls.position === 'absolute' && !('padding' in m1.decls)));
  // M2 — a hard width floor: inert on the 106px tabs, but it is the shape that grows a short
  // control sideways into a touching neighbour, which is the click-stealing regression.
  const m2 = mutate(`min-width:${TAP_TARGET_MIN}px`, `width:${TAP_TARGET_MIN}px`);
  mustCatch('min-width replaced by a hard width (a short control would grow into a touching neighbour)',
    !(m2 && m2.decls['min-width'] === `${TAP_TARGET_MIN}px`));
  // M3 — min-height dropped: the axis EVERY one of the nine was actually short on.
  const m3 = mutate(`min-height:${TAP_TARGET_MIN}px;`, '');
  mustCatch('min-height dropped, so the axis all nine controls were short on stops growing',
    !(m3 && m3.decls['min-height'] === `${TAP_TARGET_MIN}px`));
  // M4 — content dropped: a ::after without content never renders, so the rule silently does nothing.
  const m4 = mutate('content:"";', '');
  mustCatch('content dropped, so the pseudo-element never renders and the rule is decoration',
    !(m4 && m4.decls.content !== undefined));
  // M5 — the selector stops matching the marker TAP44 emits.
  const m5 = parseRule(TAP_TARGET_CSS.replace(`[${attr}]`, '[data-tap-target]'));
  mustCatch('the selector renamed away from the attribute TAP44 emits (marks would match nothing)',
    !(m5 && m5.selector.startsWith(`[${attr}]`)));
  // M6 — the rule removed from the shipped stylesheet while still existing as a constant.
  const withoutRule = themeCss.replace(TAP_TARGET_CSS, '');
  mustCatch('the rule dropped from buildThemeCss() (it would exist but never ship)',
    !withoutRule.includes(TAP_TARGET_CSS));
  // M7 — a paint declaration added: the overlay would become visible over the control.
  const m7 = parseRule(TAP_TARGET_CSS.replace('content:""', 'content:"";background:#f00'));
  mustCatch('a background added to the overlay (it would paint a block over the icon)',
    !(m7 && !Object.keys(m7.decls).some((k) => /^(background|border|outline|box-shadow)/.test(k))));
}

console.log('\n§6 this barrier runs');
check('discovered by `npm test`', npmTestRuns(ROOT, 'verify-tap-target-css'));

if (failed) { console.error(`\nverify-tap-target-css: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-tap-target-css: the 44px floor is out of flow and grows only the short axis.');
