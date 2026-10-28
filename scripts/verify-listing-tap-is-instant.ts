// TAPPING A GOLDEN LISTING IS INSTANT AND SMOOTH (owner 2026-10-27: «when I click on a listing that opens inside
// ezhalah it takes time, doesn't feel smooth … the ones with the golden that let's a confetti pop happen»).
//
// Measured on ezhalah.com that day: the tap froze the page ~380 ms on a fast laptop (1-2 s on a phone). Two causes:
//   1. opening the pane re-laid-out every card in ONE blocking render → commitAdPane now updates the pane inside a
//      React transition (the tap's buzzer/confetti paint first; the re-layout renders in non-blocking slices);
//   2. on web the 152-piece confetti ran through Animated with no native driver — 760 interpolations recomputed in
//      JavaScript every frame for 2.2 s, on top of that render → the web layer hands each piece to the Web
//      Animations API once (compositor: translate / rotate / scale / opacity), native keeps Animated.
// This reads the source for both properties; mutations prove each check can fail.
//   node --experimental-strip-types scripts/verify-listing-tap-is-instant.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const overlay = readFileSync(join(root, 'src/components/ConfettiOverlay.tsx'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const paneIsTransition = (s: string) => /const commitAdPane = \(p: AdPane<AdTab<Listing>>\) => \{ adPaneRef\.current = p; startTransition\(\(\) => setAdPane\(p\)\); \};/.test(s)
  && /import \{[^}]*\bstartTransition\b[^}]*\} from 'react';/.test(s);
check('opening the pane is a non-blocking transition (the ref stays synchronous for the next tap)', paneIsTransition(agent));
mustCatch('the pane opened in one blocking render again', !paneIsTransition(agent.replace('startTransition(() => setAdPane(p))', 'setAdPane(p)')));

// The web branch: returns before the Animated path, animates with el.animate, and never builds Animated values per piece.
const webBranch = (s: string) => {
  const i = s.indexOf('if (IS_WEB) {\n    return (');
  const j = s.indexOf('return (', i + 30);
  const branch = i > 0 && j > i ? s.slice(i, j) : '';
  return !!branch && !/Animated\./.test(branch) && /el\.animate\(/.test(s) && /typeof el\.animate !== 'function'/.test(s);
};
check('web confetti runs on the browser compositor (Web Animations), not per-frame JavaScript', webBranch(overlay));
mustCatch('the web layer going back to Animated per piece', !webBranch(overlay.replace("if (IS_WEB) {\n    return (", "if (IS_WEB) {\n    Animated.timing;\n    return (")));
check('reduced motion still draws nothing, and the party stays decoration (layer removed by a timer)',
  /if \(!live \|\| reduced\) return null;/.test(overlay) && /setTimeout\(\(\) => setLive\(false\), BURST_MS \+ 150\)/.test(overlay));

if (failed) { console.error(`\n❌ verify-listing-tap-is-instant: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-listing-tap-is-instant: a golden listing tap answers at once and the confetti never blocks the page.');
