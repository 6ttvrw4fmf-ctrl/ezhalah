// 🦅 Falcon 2026-10-16 — the two reasons journey-sweep was red for 19 days, each locked so it cannot return.
//
// 1. THE MIC / MODEL-LINE THEFT (a real product defect). The agent composer's «شاهين 2.2» line sits 3px
//    under the 34px mic. Its centred 44px tap overlay grew 10px UP and took the mic's bottom edge (a press
//    on the mic opened the model menu; measured on production at 375px). TAP44_DOWN re-anchors that
//    overlay to the control's top edge so it grows DOWN only. This checks the rule's shape, that it ships
//    in buildThemeCss(), and that the model selector carries the marker.
//
// 2. THE BLIND WATCH (a harness defect that read as a product one). The expired-token journey stopped
//    polling after three identical reads (~4 s) while the product holds the guest gate up to
//    GETSESSION_TIMEOUT_MS after mount; on production the gate opened between 8 and 15 s, after the journey
//    had stopped looking. The watch must read the product's bound and may not end before it.
//
//   node --experimental-strip-types scripts/verify-tap44-down-and-gate-watch.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAP44, TAP44_DOWN, TAP44_DOWN_CSS, buildThemeCss } from '../src/theme/palette.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`);
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

// ── 1. the directional rule ─────────────────────────────────────────────────────────────────────────
const attr = `data-${Object.keys(TAP44_DOWN)[0].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const ruleOk = (css: string) => {
  const m = css.match(/^\[([a-z0-9-]+)\]::after\{(.*)\}$/);
  if (!m || m[1] !== attr) return false;
  const d = Object.fromEntries(m[2].split(';').filter(Boolean).map((p) => p.split(':').map((x) => x.trim())));
  return d.top === '0' && d.transform === 'translate(-50%,0)' && !('height' in d) && !('background' in d);
};
check(`TAP44_DOWN_CSS re-anchors the [${attr}] overlay to the top edge`, ruleOk(TAP44_DOWN_CSS), TAP44_DOWN_CSS);
const theme = buildThemeCss();
const ships = (t: string, rule: string) => t.split('\n').includes(rule)
  && t.indexOf(rule) > t.indexOf('[data-tap44]::after');   // after the base rule, so it wins the tie
check('TAP44_DOWN_CSS ships in buildThemeCss(), after the base TAP44 rule', ships(theme, TAP44_DOWN_CSS));

const sel = readFileSync(join(root, 'src/components/AgentModelSelector.tsx'), 'utf8');
const carries = (src: string) => /dataSet=\{\{\s*\.\.\.TAP44,\s*\.\.\.TAP44_DOWN\s*\}\}/.test(src);
check('the agent model selector carries TAP44 + TAP44_DOWN', carries(sel));
check('TAP44 itself is unchanged', JSON.stringify(TAP44) === '{"tap44":"1"}');

mustCatch('the overlay centred again (translate(-50%,-50%))',
  !ruleOk(TAP44_DOWN_CSS.replace('translate(-50%,0)', 'translate(-50%,-50%)')));
mustCatch('the top anchor dropped', !ruleOk(TAP44_DOWN_CSS.replace('top:0;', '')));
mustCatch('the selector renamed away from the marker', !ruleOk(TAP44_DOWN_CSS.replace(attr, 'data-tap-down')));
mustCatch('the rule dropped from the theme', !ships(theme.replace(TAP44_DOWN_CSS, ''), TAP44_DOWN_CSS));
mustCatch('the rule placed BEFORE the base rule (the base would win the tie)',
  !ships(`${TAP44_DOWN_CSS}\n${theme.replace(TAP44_DOWN_CSS, '')}`, TAP44_DOWN_CSS));
mustCatch('the selector losing the down marker', !carries(sel.replace('...TAP44, ...TAP44_DOWN', '...TAP44')));

// ── 2. the gate watch reads the product's bound and cannot end before it ───────────────────────────
const run = readFileSync(join(root, 'e2e/journeys/run.mjs'), 'utf8');
const body = (src: string) => {
  const i = src.indexOf("JOURNEYS['expired-token-still-opens-the-gate']");
  return i < 0 ? '' : src.slice(i, src.indexOf('JOURNEYS[', i + 10));
};
const watches = (src: string) => {
  const b = body(src);
  return /src\/lib\/sessionRestore\.ts/.test(b) && /GETSESSION_TIMEOUT_MS/.test(b)
    && /const minWatch = Math\.ceil\(\(boundMs \+ \d[\d_]*\) \/ 1000\)/.test(b)
    && /for \(let i = 0; i < 40 && \(stable < 3 \|\| i < minWatch\); i\+\+\)/.test(b);
};
check('the expired-token watch reads GETSESSION_TIMEOUT_MS and cannot stop before it', watches(run));
const restore = readFileSync(join(root, 'src/lib/sessionRestore.ts'), 'utf8');
const bound = Number((restore.match(/GETSESSION_TIMEOUT_MS\s*=\s*([\d_]+)/) || [])[1]?.replace(/_/g, ''));
check('the product bound is readable the way the journey reads it', Number.isFinite(bound) && bound > 0, String(bound));
check('the watch (bound + margin) still fits inside the 40-read budget', Math.ceil((bound + 10_000) / 1000) < 40);

mustCatch('the old three-reads exit', !watches(run.replace('(stable < 3 || i < minWatch)', 'stable < 3')));
mustCatch('a hard-coded floor instead of the product constant',
  !watches(run.replace(/GETSESSION_TIMEOUT_MS/g, 'FOUR_SECONDS')));

console.log(failed ? `\n${failed} check(s) failed` : '\nTAP44_DOWN and the gate watch are both locked');
process.exit(failed ? 1 : 0);
