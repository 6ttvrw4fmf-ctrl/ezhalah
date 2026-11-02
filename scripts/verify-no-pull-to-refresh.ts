// NO PULL-TO-REFRESH (owner 2026-10-24, phone: «when I scroll quick a refresh opens»).
//
// The chat scrolls inside its own box while the page is pinned behind it (ScrollViewStyleReset: body overflow hidden).
// A fast flick to the top has nowhere left to go inside the box, chains out to the page, and the browser reads it as
// «pull down to reload» — the conversation reloads under the user's thumb. `overscroll-behavior-y: none` on html AND
// body ends the chaining and the gesture; the chat's own scrolling is untouched. Nothing in src/ reloads the page
// itself (grep: no location.reload / RefreshControl), so the browser gesture is the only way it can happen.
// This pins the rule in the page shell. It cannot prove the phone: that is checked on the phone (?debug=tap).
//
//   node --experimental-strip-types scripts/verify-no-pull-to-refresh.ts   (in npm test)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

/** True when the page shell carries the rule on BOTH html and body (the root scroller and the viewport are distinct). */
const shellStopsPullToRefresh = (html: string) => /html\s*,\s*body\s*\{[^}]*overscroll-behavior-y\s*:\s*none/.test(stripComments(html));

const shell = readFileSync(join(root, 'src/app/+html.tsx'), 'utf8');
check('the page shell turns off pull-to-refresh on html and body', shellStopsPullToRefresh(shell));
mustCatch('the rule removed is caught', !shellStopsPullToRefresh(shell.replace('overscroll-behavior-y:none', '')));
mustCatch('the rule only on body (the root scroller still chains) is caught', !shellStopsPullToRefresh(shell.replace('html,body{overscroll-behavior-y:none}', 'body{overscroll-behavior-y:none}')));
mustCatch('the rule only inside a comment is caught', !shellStopsPullToRefresh(shell.replace("'html,body{overscroll-behavior-y:none}'", "'x'/* html,body{overscroll-behavior-y:none} */")));

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ a fast flick to the top cannot reload the page');
