// A LIVE ROBOT MUST TAP THE RENT-PERIOD BUTTON BY THE WORD THE SITE SHOWS (2026-10-31, 🔬).
// The owner renamed the short-stays button «شهري» → «إقامات قصيرة» on 2026-10-25 (src/i18n.tsx 'Short stays').
// Two browser robots kept tapping «شهري», so af-live-truth-check's Gathern short-stays journey died at
// setup («control never rendered: شهري») on every run for six days — the exact journey that would have
// shown the «نوع الوحدة» / استديو count falling 3,719 → 1 (🦅 Falcon 10-30). A robot that cannot reach its
// screen proves nothing, and its red hides the real failure beside it.
// This check reads the shipped Arabic label from src/i18n.tsx and fails on any robot that taps the
// rent-period button by a word the site no longer renders. The REQUEST value p_rent_period='شهري' is
// untouched and is not a tap, so RPC-only robots are out of scope by construction.
//
//   node --experimental-strip-types scripts/verify-live-robots-tap-the-shipped-rent-period-label.ts  (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
const shipped = /'Short stays':\s*'([^']+)'/.exec(i18n)?.[1] ?? '';
check(`the shipped short-stays label is read from src/i18n.tsx («${shipped}»)`, shipped.length > 0);

// A tap of the period button: tap('X') / tap("X"), or X inside a `deal: [ … ]` tap list.
const RETIRED = ['شهري'];
const offences = (src: string, retired: string[]): string[] => {
  const out: string[] = [];
  for (const w of retired) {
    if (w === shipped) continue;
    const tapCall = new RegExp(`\\btap\\(\\s*['"]${w}['"]`);
    const dealList = new RegExp(`\\bdeal:\\s*\\[[^\\]]*['"]${w}['"][^\\]]*\\]`);
    if (tapCall.test(src)) out.push(`tap('${w}')`);
    if (dealList.test(src)) out.push(`deal: [… '${w}' …]`);
  }
  return out;
};

const files: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); }
    else if (/\.(ts|mjs|js)$/.test(e.name) && e.name !== 'verify-live-robots-tap-the-shipped-rent-period-label.ts') files.push(rel);
  }
};
walk('scripts'); walk('e2e');
check(`robots scanned (${files.length} files under scripts/ and e2e/)`, files.length > 50);

const bad = files.flatMap((f) => offences(readFileSync(join(root, f), 'utf8'), RETIRED).map((o) => `${f}: ${o}`));
check(`no robot taps the retired word${bad.length ? ` — ${bad.join(' · ')}` : ''}`, bad.length === 0);

// The two robots fixed today must tap the shipped label.
for (const f of ['scripts/verify-af-live-truth.ts', 'scripts/verify-af-option-card-truth-live.ts']) {
  check(`${f} taps «${shipped}»`, readFileSync(join(root, f), 'utf8').includes(`'${shipped}'`));
}

mustCatch("the 10-25..10-31 deal list (deal: ['إيجار', 'شراء', 'شهري', 'سنوي'])",
  offences("deal: ['إيجار', 'شراء', 'شهري', 'سنوي'], city: 'الرياض'", RETIRED).length > 0);
mustCatch("a bare tap('شهري')", offences("await tap('إيجار'); await tap('شهري');", RETIRED).length > 0);
check('a request value p_rent_period: \'شهري\' is NOT a tap (no false alarm)',
  offences("{ p_deal: 'إيجار', p_rent_period: 'شهري' }", RETIRED).length === 0);
check('the shipped label passes', offences(`deal: ['إيجار', 'شراء', '${shipped}', 'سنوي']`, RETIRED).length === 0);

console.log(failed ? `\n✗ ${failed} FAILED` : '\n✓ every live robot taps the rent-period button the site renders');
process.exit(failed ? 1 : 0);
