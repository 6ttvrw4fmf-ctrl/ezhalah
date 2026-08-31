// Barrier: A CLARIFICATION MAY PAUSE EXECUTION — IT MAY NEVER ERASE STATE.
// Owner ruling 2026-08-30, verbatim: "A clarification question may pause execution, but it must
// NEVER erase information the user already provided."
//
// THE BUG. «شقة شهرية في الرياض تقييمها ٩.٥» needs a city-vs-region question, and asking it threw
// away Apartment + monthly + rating 9.5 completely: the edge answered kind:"message" with no query,
// the client's message branch dropped whatever it did send, and the UI only recorded state from
// LISTINGS turns. The answer «منطقة الرياض» then had one word to rebuild a whole request from.
//
// GENERIC BY CONSTRUCTION. Nothing below is per-field. The field list is derived from STICKY_FIELDS,
// so a new sticky field is covered the day it is added — a hand-written list would rot silently.
//
// Executes the REAL merge and the REAL AF registry; pins the wiring that feeds them.
import { readFileSync } from 'node:fs';
import { mergeConversationState, STICKY_FIELDS, DEFAULTED_FIELDS } from '../src/lib/conversationState.ts';
import { applyAfIntents } from '../src/lib/afIntents.ts';
import { cohortAllows } from '../src/lib/afCohorts.ts';
import { emptyQuery } from '../src/lib/searchDefaults.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const J = (v: unknown) => JSON.stringify(v);

// The state «شقة شهرية في منطقة الرياض تقييمها ٩.٥» produces, with rating certified (monthly).
const understood = (): any => {
  const base: any = { ...emptyQuery(), type: 'Apartment', category: 'Residential',
                      deal: 'Rent', rentPeriod: 'monthly', location: 'منطقة الرياض' };
  return applyAfIntents(base, { rating: '9.5' }).q;
};

// ── 1. THE CLARIFICATION TURN ITSELF KEEPS EVERYTHING ───────────────────────────
{
  const before = understood();
  check('the setup is real: rating is certified and applied', (before as any).ratingMin === 9.5);
  // A clarification turn states nothing new — the model asked a question.
  const during = mergeConversationState(before, { ...emptyQuery() } as any, []);
  for (const f of ['type', 'rentPeriod', 'location', 'ratingMin', 'category', 'deal']) {
    check(`a clarification keeps ${f}`, J((during as any)[f]) === J((before as any)[f]),
      `${J((before as any)[f])} -> ${J((during as any)[f])}`);
  }
}

// ── 2. ANSWERING THE CLARIFICATION MERGES INTO THE PREVIOUS STATE ───────────────
{
  const before = understood();
  // «منطقة الرياض» — the answer states a location and nothing else.
  const answer: any = { ...emptyQuery(), location: 'منطقة الرياض' };
  const after: any = mergeConversationState(before, answer, ['location']);
  check('answering a clarification keeps the property type', after.type === 'Apartment');
  check('answering a clarification keeps the rental period', after.rentPeriod === 'monthly');
  check('answering a clarification keeps the AF rating', after.ratingMin === 9.5);
  check('answering a clarification applies the answer', after.location === 'منطقة الرياض');
}

// ── 3. NEW EXPLICIT INFORMATION OVERRIDES THE OLD ──────────────────────────────
{
  const before = understood();
  const changed: any = mergeConversationState(before,
    { ...emptyQuery(), location: 'جدة', rentPeriod: 'annual' } as any,
    ['location', 'rentPeriod']);
  check('an explicit change to the location wins', changed.location === 'جدة');
  check('an explicit change to the period wins', changed.rentPeriod === 'annual');
  check('unrelated state still survives the change', changed.type === 'Apartment' && changed.ratingMin === 9.5);
}

// ── 4. NO STICKY FIELD MAY BE SILENTLY RESET — derived, not hand-listed ────────
// Every sticky field gets a value; a turn that states NOTHING must not clear any of them.
{
  const prev: any = { ...emptyQuery(), type: 'Apartment', category: 'Residential', deal: 'Rent',
    rentPeriod: 'monthly', location: 'منطقة الرياض', detail: '3', priceInput: '5000',
    bathMin: 2, ratingMin: 9.5, reviewsMin: 10, amenities: ['elevator'], furnishedPref: true,
    directions: ['شمال'], streetWidthMin: 20, unitSubtypes: ['استديو'], areaMin: 100, areaMax: 300,
    priceMin: 1000, priceMax: 9000, bothDeals: false, priceIsAnnual: false, districts: ['النرجس'],
    regionPin: 'منطقة الرياض', districtPin: undefined, sources: ['gathern'], priceBand: null,
    priceOriginal: undefined, contextSize: undefined, ageMin: 1, ageMax: 2, isNewConstruction: false,
  };
  const silent = mergeConversationState(prev, { ...emptyQuery() } as any, []);
  for (const f of STICKY_FIELDS) {
    const had = (prev as any)[f];
    if (had === undefined || had === null) continue;         // nothing to preserve
    check(`a silent turn cannot reset ${f}`, J((silent as any)[f]) === J(had),
      `${J(had)} -> ${J((silent as any)[f])}`);
  }
}

// ── 5. A DEFAULT IS STILL NOT AN ANSWER (the regression that started this) ──────
{
  const prev: any = { ...emptyQuery(), type: 'Apartment', category: 'Residential', deal: 'Rent',
                      rentPeriod: 'monthly', location: 'الرياض', ratingMin: 9.5 };
  const next: any = { ...emptyQuery(), type: 'Apartment', category: 'Residential', deal: 'Rent', location: 'الرياض' };
  const merged: any = mergeConversationState(prev, next, ['deal', 'category']);   // period NOT stated
  check('an unstated period does not fall back to the annual default', merged.rentPeriod === 'monthly',
    `got ${merged.rentPeriod}; a monthly-only ratingMin would ride into an annual search`);
  check('DEFAULTED_FIELDS still covers the defaulted normal-filter fields',
    (DEFAULTED_FIELDS as readonly string[]).includes('rentPeriod')
    && (DEFAULTED_FIELDS as readonly string[]).includes('deal')
    && (DEFAULTED_FIELDS as readonly string[]).includes('category'));
}

// ── 6. CLARIFY → ANSWER → SEARCH == SAID PERFECTLY IN ONE SENTENCE ─────────────
// The strongest statement of the rule: the detour must not change the destination.
{
  const oneShot = understood();
  // The same request, but split by a clarification: turn 1 understood everything except the
  // resolved location, turn 2 answers only the location.
  const turn1: any = applyAfIntents(
    { ...emptyQuery(), type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'monthly', location: 'الرياض' } as any,
    { rating: '9.5' }).q;
  const turn2: any = mergeConversationState(turn1, { ...emptyQuery(), location: 'منطقة الرياض' } as any, ['location']);
  const keys = ['type', 'category', 'deal', 'rentPeriod', 'location', 'ratingMin', 'reviewsMin'];
  const a = Object.fromEntries(keys.map((k) => [k, (oneShot as any)[k]]));
  const b = Object.fromEntries(keys.map((k) => [k, turn2[k]]));
  check('a clarification detour reaches the SAME final query as one clear sentence',
    J(a) === J(b), `one-shot ${J(a)} vs clarified ${J(b)}`);
}

// ── 7. AN UNSUPPORTED FILTER IS STILL REFUSED, AND STILL SAID ──────────────────
{
  const annual: any = { ...emptyQuery(), type: 'Apartment', category: 'Residential',
                        deal: 'Rent', rentPeriod: 'annual', location: 'الرياض' };
  check('rating is genuinely uncertified on annual rent', !cohortAllows(annual, 'rating'));
  const r = applyAfIntents(annual, { rating: '9.5' });
  check('an uncertified filter is not applied', (r.q as any).ratingMin === undefined);
  check('an uncertified filter is still reported', r.rejected.includes('rating'));
  const agent = readFileSync('src/data/agent.ts', 'utf8');
  check('the refusal still reaches the user as the Arabic notice', /rejectionNotice\(\)/.test(agent));
}

// ── 8. THE WIRING THAT FEEDS ALL OF THE ABOVE ─────────────────────────────────
{
  // Decomment first: the file DOCUMENTS `kind: "message"` in prose, and counting that comment made
  // this check report 5-of-6 against a file where all 5 real returns were already correct. Assert on
  // code — the same trap this repo keeps hitting from the other direction.
  const edge = readFileSync('supabase/functions/agent/index.ts', 'utf8')
    .split('\n').map((l) => l.split('//')[0]).join('\n');
  const msgReturns = [...edge.matchAll(/kind:\s*"message"/g)].length;
  const withState = [...edge.matchAll(/query:\s*understoodState\(\)/g)].length
                  + [...edge.matchAll(/kind:\s*"message",\s*\n\s*reply:[\s\S]{0,300}?query:\s*\{/g)].length;
  check('every clarification the edge sends carries the state it understood',
    withState >= msgReturns, `${withState} of ${msgReturns} message returns carry state`);
  const client = readFileSync('src/data/agent.ts', 'utf8');
  check('the client merges a clarification through the same pipeline as a search',
    /d\.kind === 'message'[\s\S]{0,900}certifyAfOnMergedState\([\s\S]{0,200}mergeConversationState\(/.test(client));
  const ui = readFileSync('src/app/agent.tsx', 'utf8');
  check('the UI records state from a paused turn, not only a searching one',
    /turn\.query\) lastQueryRef\.current = turn\.query;/.test(ui)
    && !/turn\.kind === 'listings' && turn\.query\) lastQueryRef/.test(ui));
}

console.log(
  failures === 0
    ? `\n✓ a clarification pauses the search and keeps every one of ${STICKY_FIELDS.length} sticky fields`
    : `\n✗ ${failures} clarification-state check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
