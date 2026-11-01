// THE RENT PERIOD THE USER WROTE IN THIS MESSAGE WINS OVER THE MODEL'S READING (found live 2026-10-11).
//
// «شقة شهرية في الخبر» then «بحدود ٥٠ ألف بالسنة»: the agent answered `annual` 7 times in 8 and `monthly` once — the model carried the
// OLD period over the user's NEW words, which searched the monthly pool with a yearly budget. The user's words are the source, so
// code reads them (statedRentPeriod) and aligns a contradicting basis (alignBasisWithStatedPeriod). EXECUTED here, then wiring pinned.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statedRentPeriod, alignBasisWithStatedPeriod } from '../supabase/functions/agent/postModel.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nThe rent period the user wrote wins\n');

const T: Array<[string, 'monthly' | 'annual' | null]> = [
  ['بحدود ٥٠ ألف بالسنة', 'annual'], ['شقة سنوية في الدمام', 'annual'], ['إيجار سنوي', 'annual'], ['around 50k per year', 'annual'], ['60,000 a year', 'annual'], ['50000/year', 'annual'],
  ['خلها ٤٠٠٠ بالشهر', 'monthly'], ['شقة شهرية في الخبر', 'monthly'], ['monthly rent', 'monthly'], ['5000 per month', 'monthly'], ['5,000 a month', 'monthly'], ['5000/month', 'monthly'],
  ['شقة في الرياض', null], ['ابي شقة ٣ غرف', null], ['شهري ٥٠٠٠ أو سنوي ٥٠ ألف', null], ['monthly or yearly, whatever', null], ['', null],
];
const bad = T.filter(([t, w]) => statedRentPeriod(t) !== w);
check('annual words → annual, monthly words → monthly, both or neither → no decision', bad.length === 0, bad.map(([t]) => `${t} → ${statedRentPeriod(t)}`).join(' | '));
check('a basis that contradicts the stated period is replaced; other bases are untouched',
  alignBasisWithStatedPeriod('monthly_rent', 'annual') === 'annual_rent' && alignBasisWithStatedPeriod('annual_rent', 'monthly') === 'monthly_rent'
  && alignBasisWithStatedPeriod('monthly_rent', 'monthly') === 'monthly_rent' && alignBasisWithStatedPeriod('monthly_rent', null) === 'monthly_rent'
  && alignBasisWithStatedPeriod('full_price', 'annual') === 'full_price' && alignBasisWithStatedPeriod('daily_rent', 'monthly') === 'daily_rent');

const edge = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
const wire = windowBetween(edge, 'const statedPeriod = statedRentPeriod(text);', 'if (deal !== "Rent") rentPeriod = undefined;', 'index.ts');
const wired = (src: string) => /const basis = alignBasisWithStatedPeriod\(String\(out\.pricing_basis \?\? ""\), statedPeriod\);/.test(src) && /const rp = statedPeriod \?\? String\(out\.rent_period \?\? ""\);/.test(src);
check('the edge reads the period from the user\'s message first, and aligns the basis with it', wired(wire));
mustCatch('the model\'s rent_period winning over the user\'s words again', !wired(wire.replace('statedPeriod ?? String(out.rent_period ?? "")', 'String(out.rent_period ?? "")')));
mustCatch('the contradicting basis being kept', !wired(wire.replace('alignBasisWithStatedPeriod(String(out.pricing_basis ?? ""), statedPeriod)', 'String(out.pricing_basis ?? "")')));
check('a Buy search keeps NO rent period (the existing rule still runs after)', /if \(deal !== "Rent"\) rentPeriod = undefined;/.test(edge));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the rent period the user wrote wins');
