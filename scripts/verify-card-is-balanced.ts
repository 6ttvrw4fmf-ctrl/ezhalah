// EVERY CARD CARRIES THE SAME FEW LINES (owner 2026-11-13: «I don't like how it shows the licence number … balance it»).
// The phone card follows the laptop card's 2026-10-11 rule: at most 3 of the source's key facts (age, facade, street width,
// plan, usage — exactly as published) and at most 3 extras then «+N». No licence or ad number on the card — those stay on
// the site's own page. What the Advanced Filter asked for is still ALL visible in «مطابق لطلبك» (never capped).
// pickKeyFacts() is EXECUTED (lifted from ResultCard); the wiring is read with a mutation for each fact.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname ?? '.', '..');
const FILE = join(root, 'src/components/ResultCard.tsx');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Row = { key: string; label: string; value: string };
const m = await liftSymbols(FILE, [
  { header: 'const KEY_FACT_ORDER', endsWith: /;$/ },
  { header: 'const CARD_FACT_CAP', endsWith: /;$/ },
  { header: 'export function pickKeyFacts' },
], ['pickKeyFacts']);
const pick = m.pickKeyFacts as (rows: Row[]) => Row[];

const rows: Row[] = [
  { key: 'rega_ad_license_number', label: 'رقم رخصة الإعلان', value: '7201175825' },
  { key: 'ad_number', label: 'رقم الإعلان', value: '36167' },
  { key: 'plan_number', label: 'رقم المخطط', value: '2880' },
  { key: 'street_width', label: 'عرض الشارع', value: '25' },
  { key: 'facade', label: 'الواجهة', value: 'جنوبية' },
  { key: 'property_age', label: 'عمر العقار', value: '4' },
  { key: 'total_floors', label: 'إجمالي الطوابق', value: '2' },
];
const got = pick(rows).map((r) => r.key);
check('at most 3 key facts, in the fixed order (age, facade, street…)', JSON.stringify(got) === JSON.stringify(['property_age', 'facade', 'street_width']), JSON.stringify(got));
check('the licence and the ad number never reach the card', !got.includes('rega_ad_license_number') && !got.includes('ad_number')
  && pick(rows.slice(0, 2)).length === 0);
check('a card with only a plan number shows the plan number', JSON.stringify(pick([rows[2]]).map((r) => r.key)) === '["plan_number"]');

const CARD = readFileSync(FILE, 'utf8');
function wiring(src: string): string[] {
  const out: string[] = [];
  if (!/const visible = pickKeyFacts\(all\);/.test(src)) out.push('the facts panel shows every source row again');
  if (!/const FACT_ORDER = KEY_FACT_ORDER;/.test(src)) out.push('the laptop card has its own fact list again');
  if (!/\{visible\.slice\(0, CARD_CHIP_CAP\)\.map\(\(f\) => \{/.test(src) || !/testID="card-feature-more"/.test(src)) out.push('the phone card shows every extra again (no «+N»)');
  if (!/const CARD_CHIP_CAP = 3;/.test(src) || !/const CARD_FACT_CAP = 3;/.test(src)) out.push('a cap is no longer 3');
  if (!/\{evidence\.map\(\(c, i\) =>/.test(src) || /evidence\.slice\(/.test(src)) out.push('Advanced Filter picks are capped in «مطابق لطلبك»');
  return out;
}
const w = wiring(CARD);
check(`the card wiring keeps every card balanced${w.length ? ' → ' + w.join('; ') : ''}`, w.length === 0);
mustCatch('every source row shown again', wiring(CARD.replace('const visible = pickKeyFacts(all);', 'const visible = all;')).length > 0);
mustCatch('every extra shown again', wiring(CARD.replace('{visible.slice(0, CARD_CHIP_CAP).map((f) => {', '{visible.map((f) => {')).length > 0);
mustCatch('Advanced Filter picks capped', wiring(CARD.replace('{evidence.map((c, i) =>', '{evidence.slice(0, 3).map((c, i) =>')).length > 0);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nevery card: ≤3 key facts, no licence, ≤3 extras + «+N», all Advanced Filter picks visible');
