// THE AGENT HELPS WITH PERSONAL CONTEXT BUT NEVER RECOMMENDS (owner 2026-10-11).
//
// Owner: «users may say personal preferences — a family of 5, a taste — your job is helping the user, tell them everyone
// has a different taste». Rules in the prompt (SYSTEM): a head-count → ask which bedrooms (two options, never a guess);
// a taste word → «taste differs, judge from each listing»; a need one of our filters serves → offer that filter; facts
// about the person → city only. NEVER name or pick a district (the old LIFESTYLE line did) and never say the results suit
// the user (PRD §7: neutral search, no recommendations). Measured on DeepSeek V4.1 Flash, 30 personal messages: 30/30 no
// «suits you» claim, 30/30 one emoji, 30/30 no bedroom guess, 29/30 taste line, 30/30 elevator offer, 30/30 no district.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const index = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '❌'} ${name}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nAgent: personal context is helped, never recommended\n');

const system = windowBetween(index, 'const SYSTEM = `', '`;', 'index.ts');
const ctx = (src: string) => src.split('\n').find((l) => l.startsWith('PERSONAL CONTEXT (owner 2026-10-11)')) ?? '';
const has = (src: string) => {
  const c = ctx(src);
  return /never guess for them/.test(c) && /never say the results suit them/.test(c)
    && /COUNT of people/.test(c) && /leave bedrooms empty and ask which bedrooms/.test(c)
    && /TASTE words/.test(c) && /taste differs between people/.test(c)
    && /NEED one of our filters can serve/.test(c) && /never claim a filter we do not have/.test(c)
    && /never ask about property type, budget or district/.test(c);
};
check('the prompt has the personal-context rule: head-count → ask bedrooms, taste → differs, need → offer a filter', has(system));
mustCatch('the rule being deleted', !has(system.replace('PERSONAL CONTEXT (owner 2026-10-11)', 'NOTE')));
mustCatch('the «leave bedrooms empty» guard being dropped (the model would guess beds from family size)', !has(system.replace('leave bedrooms empty and ask which bedrooms', 'set the bedrooms')));
mustCatch('the taste line being dropped', !has(system.replace('taste differs between people', 'taste is shared')));
mustCatch('the no-recommendation line being dropped', !has(system.replace('never say the results suit them', 'say the results suit them')));

const lifestyle = system.split('\n').find((l) => l.startsWith('LIFESTYLE')) ?? '';
const cityOnly = (l: string) => /CITY ONLY/.test(l) && /NEVER name, pick or suggest a DISTRICT/.test(l) && !/Al Malqa|Al Yasmin|Al Narjis|Hittin|Al Olaya/.test(l);
check('the LIFESTYLE line only ever picks a city, never a district', cityOnly(lifestyle));
mustCatch('a district name coming back into the lifestyle line', !cityOnly(lifestyle + ' family → Al Malqa'));
mustCatch('the city-only guard being dropped', !cityOnly(lifestyle.replace('CITY ONLY', 'any place')));

const personal = system.split('\n').find((l) => l.startsWith('PERSONAL INFO')) ?? '';
check('PERSONAL INFO no longer turns a family size into a larger home', !/family of 6 → larger home/.test(personal) && /relocating → search the destination city/.test(personal));
mustCatch('«family of 6 → larger home» coming back', /family of 6 → larger home/.test(personal + ' family of 6 → larger home'));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ agent: personal context helped, never recommended');
