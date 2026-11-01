// A STATED DEAL CLOSES «RENT OR BUY?» (found live 2026-10-11 in the owner's real-user test).
//
//   turn 1  «ابغى شقة»                        → the question is open: bothDeals:true
//   turn 2  «الرياض ٢ غرف إيجار سنوي»          → the agent answers deal:Rent, bothDeals:false, rentPeriod:annual
//   the app showed «إيجار أو شراء (سنوي)» and the FIRST CARD WAS A FOR-SALE APARTMENT (SAR 736,468).
//
// The merge only lets a defaulted field through when the turn STATED it. statedKeys() counted `deal` but not
// `bothDeals`, so the old «open» flag was rescued over the user's explicit «rent». Executed here on the REAL
// statedKeys (lifted from src/data/agent.ts) and the REAL mergeConversationState.
import { join } from 'node:path';
import { mergeConversationState } from '../src/lib/conversationState.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA stated deal closes «rent or buy?»\n');

const lifted = await liftSymbols(join(ROOT, 'src/data/agent.ts'), [{ header: 'export function statedKeys(' }], ['statedKeys'],
  'type BackendQuery = any;');
const statedKeys = lifted.statedKeys as (b: any) => string[];

const q = (o: object) => ({ deal: 'Rent', bothDeals: false, rentPeriod: 'annual', location: '', type: '', ...o }) as any;
const turn1b = { deal: 'Rent', bothDeals: true, type: 'Apartment' };                         // «ابغى شقة»: deal unstated
const turn2b = { deal: 'Rent', bothDeals: false, rentPeriod: 'annual', location: 'الرياض', type: 'شقة' }; // «… إيجار سنوي»
const prev = q({ bothDeals: true, type: 'Apartment' });
const next = q({ bothDeals: false, location: 'الرياض', type: 'Apartment' });

const run = (stated: (b: any) => string[]) => mergeConversationState(prev, next, stated(turn2b));
check('after «ابغى شقة» then «… إيجار سنوي», the search is RENT only (not «rent or buy»)', (run(statedKeys) as any).bothDeals === false && (run(statedKeys) as any).deal === 'Rent', JSON.stringify(run(statedKeys)));
check('a single stated deal counts `bothDeals` as stated', statedKeys(turn2b).includes('bothDeals') && statedKeys(turn2b).includes('deal'));
mustCatch('the old statedKeys (deal counted, bothDeals not)', (run(() => ['deal', 'rentPeriod', 'category']) as any).bothDeals === true);

check('an UNSTATED deal still leaves the question open (turn 1 stays «rent or buy»)', statedKeys(turn1b).includes('bothDeals') && mergeConversationState(null, prev, statedKeys(turn1b)) === prev);
const buy = { deal: 'Buy', bothDeals: false };
check('«للبيع» closes it the same way', statedKeys(buy).includes('bothDeals') && (mergeConversationState(q({ bothDeals: true }), q({ deal: 'Buy', bothDeals: false }), statedKeys(buy)) as any).deal === 'Buy');
check('a turn that says nothing about the deal carries the earlier answer forward', (mergeConversationState(q({ deal: 'Rent', bothDeals: false }), q({ bothDeals: true }), []) as any).bothDeals === false);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a stated deal closes «rent or buy?»');
