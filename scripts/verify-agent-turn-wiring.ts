// Regression + mutation guard for the WIRING between index.ts's resolved turn fields and the single
// decision authority (supabase/functions/agent/turnWiring.ts's buildTurnDecision()), extracted in the
// round-2 fix for "UNTESTED WIRING / FOOLABLE REGEX". decide.ts's own ladder is covered in isolation
// by scripts/verify-agent-decide-turn.ts; THIS script covers the GLUE that feeds it — the exact seam
// round 1 proved was untested and only guarded by a source-regex a plausible mutation could pass.
//
// PER THE STANDING "NEVER TEST A COPY OF PRODUCTION CODE" RULE, this imports and EXECUTES the real
// buildTurnDecision() — never a hand-typed reimplementation.
//
//   node --experimental-strip-types scripts/verify-agent-turn-wiring.ts   (auto-discovered by npm test)

import { buildTurnDecision, type TurnWiringInput } from '../supabase/functions/agent/turnWiring.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// prevQuery carries an ALREADY-ESTABLISHED property type (owner, 2026-09-06: "location + property
// type ⇒ search"). Supplied here rather than in each `text`, deliberately: every case below tests
// PRICE/AF/ask_about grounding, and putting a type word into their texts would change what they
// test. An earlier turn having established the type is also the realistic shape — the client always
// sends prevQuery. Cases that specifically test a MISSING type override prevQuery themselves.
const base: TurnWiringInput = {
  text: '', out: { type: '', af: {}, amenities: [] }, prevQuery: { type: 'Apartment' } as never,
  location: '', regionPin: undefined, districtPin: undefined,
  ambiguityReply: null, askCount: 0, price: '', detPrice: '', detailStr: '',
};

console.log('\n(c) THE MANDATORY CASE, executed end-to-end through the REAL WIRING (not decide.ts directly)\n');
{
  // The bedroom-word-without-word guard (index.ts, ahead of this call) turns «أبي بيت كبير» into
  // detail:"" + ask_about:["size"] — reproduced here as out.ask_about the same shape index.ts hands
  // buildTurnDecision by way of prevQuery on a LATER turn. THIS turn has nothing else established.
  const r = buildTurnDecision({ ...base, text: 'أبي بيت كبير', askCount: 0 });
  check('(c) wiring: fresh-turn-only signal, nothing persisted -> message, NOT listings',
    r.decision.kind === 'message' && r.decision.askCount === 1, JSON.stringify(r.decision));

  // Once ask_about SURVIVED into prevQuery (a prior turn), it counts as real signal even before the
  // budget is spent — PR #1382's fix staying fixed, exercised through the wiring this time.
  const carried = buildTurnDecision({ ...base, text: 'بيت كبير في الرياض', location: 'الرياض', prevQuery: { type: 'Apartment', askAbout: ['size'] }, askCount: 1 });
  check('(c) wiring: PRIOR-turn ask_about (via prevQuery) counts as signal -> listings',
    carried.decision.kind === 'listings', JSON.stringify(carried.decision));
}


// NOTE (2026-09-04): a search now REQUIRES a real place — nationwide was removed from the product,
// so a turn with no city can no longer resolve to `listings`. Every fixture below that asserts
// `-> listings` therefore carries a location; that is the only change. What each check is really
// about (the noise guard, ask_about provenance, prevQuery field names) is untouched, and the
// no-location half is pinned explicitly at the end of this file.
console.log('\n(1) NOISE-GUARD GAP — a FABRICATED type/price/af with zero textual grounding must not, alone, trigger an immediate search\n');
{
  // Vague utterance, no type word anywhere — a model that fabricates type="Apartment" anyway must
  // not get an immediate search out of it.
  const hallucinatedType = buildTurnDecision({ ...base, text: 'ورني شي حلو', out: { type: 'Apartment', af: {}, amenities: [] } });
  check('(1) fabricated type, no type word in text -> message, not listings',
    hallucinatedType.decision.kind === 'message', JSON.stringify(hallucinatedType.decision));

  // A GENUINE type statement must still search immediately (askCount=0, nothing else) — the locked
  // contract this fix must not break.
  const realType = buildTurnDecision({ ...base, text: 'أبغى فيلا في الرياض', location: 'الرياض', out: { type: 'Villa', af: {}, amenities: [] } });
  check('(1) real type word in text -> listings immediately (locked contract preserved)',
    realType.decision.kind === 'listings', JSON.stringify(realType.decision));

  // A price the model invented with no digit anywhere in the text.
  const hallucinatedPrice = buildTurnDecision({ ...base, text: 'ابغى شي مناسب', price: '500000', detPrice: '' });
  check('(1) fabricated price, no digit in text -> message, not listings',
    hallucinatedPrice.decision.kind === 'message', JSON.stringify(hallucinatedPrice.decision));

  // A genuinely stated price (detPrice grounded) must still search immediately.
  const realPrice = buildTurnDecision({ ...base, text: 'بميزانية ٥٠٠ الف في الرياض', location: 'الرياض', price: '500000', detPrice: '500000' });
  check('(1) real digit-backed price -> listings immediately',
    realPrice.decision.kind === 'listings', JSON.stringify(realPrice.decision));

  // An AF object the model invented with zero digits/keywords anywhere in the text.
  const hallucinatedAf = buildTurnDecision({ ...base, text: 'ابغى شي مناسب', out: { type: '', af: { ratingMin: '9.0' }, amenities: [] } });
  check('(1) fabricated af, no digit/keyword in text -> message, not listings',
    hallucinatedAf.decision.kind === 'message', JSON.stringify(hallucinatedAf.decision));

  // A genuinely stated AF fact (a number present) must still search immediately.
  const realAf = buildTurnDecision({ ...base, text: 'تقييمها ٩ فما فوق في الرياض', location: 'الرياض', out: { type: '', af: { ratingMin: '9.0' }, amenities: [] } });
  check('(1) real digit-backed af -> listings immediately',
    realAf.decision.kind === 'listings', JSON.stringify(realAf.decision));

  // Budget exhausted must still search regardless of grounding (owner mandate: missing optional
  // information must not block it) — the guard only affects the SIGNAL gate, never the budget floor.
  const exhausted = buildTurnDecision({ ...base, text: 'ورني شي حلو في الرياض', location: 'الرياض', out: { type: 'Apartment', af: {}, amenities: [] }, askCount: 2 });
  check('(1) budget exhausted -> listings even with an ungrounded field', exhausted.decision.kind === 'listings');
  // …but the budget floor never manufactures a NATIONWIDE search: with no place named, an exhausted
  // budget asks for the city instead of searching every city in the Kingdom (owner, 2026-09-04).
  const exhaustedNoPlace = buildTurnDecision({ ...base, text: 'ورني شي حلو', out: { type: 'Apartment', af: {}, amenities: [] }, askCount: 2 });
  check('(1) budget exhausted with NO place -> message, never a nationwide search',
    exhaustedNoPlace.decision.kind === 'message', JSON.stringify(exhaustedNoPlace.decision));
}

console.log('\n(5) ARABIC \\b IS A NO-OP — أرض/ارض/دور/محل must ground like every other type word\n');
{
  // No prevQuery here (unlike `base`) — any established type below can ONLY have come from THIS
  // turn's own saidTypeWord grounding, never the "type established on an earlier turn" fallback.
  const noPrior: TurnWiringInput = { ...base, prevQuery: null };

  // THE LIVE REPRO (2026-09-11): bare "أرض" alone got the generic "tell me what you're looking
  // for" fallback — the model correctly classified type="Residential Land", but \bأرض\b never
  // matched the literal text "أرض" (JS \b is ASCII-only; no boundary exists next to Arabic script),
  // so the noise-guard threw the correctly-classified type away.
  const land = buildTurnDecision({ ...noPrior, text: 'أرض', out: { type: 'Residential Land', af: {}, amenities: [] } });
  check('(5) bare "أرض" grounds type (was: silently dropped, "\\bأرض\\b" never matches)',
    land.establishedState.type === 'Residential Land', JSON.stringify(land.establishedState.type));

  // THE SECOND LIVE REPRO: "أرض في جدة السعر يكون حوالي 800 المتر" (location + price both grounded
  // fine) still got asked "وش نوع العقار اللي تدور عليه؟ (شقة، فيلا، أرض، عمارة، مكتب، محل…)" —
  // "أرض" listed right there in the question it was asked BECAUSE "أرض" didn't ground.
  const landWithCity = buildTurnDecision({ ...noPrior, text: 'أبغى أرض في جدة السعر يكون حوالي 800 المتر', location: 'جدة', out: { type: 'Residential Land', af: {}, amenities: [] } });
  check('(5) "أرض في جدة ... 800 المتر" grounds type -> listings (was: message asking for type again)',
    landWithCity.decision.kind === 'listings' && landWithCity.establishedState.type === 'Residential Land',
    JSON.stringify(landWithCity.decision));

  const landNoHamza = buildTurnDecision({ ...noPrior, text: 'ابغى ارض في الرياض', location: 'الرياض', out: { type: 'Residential Land', af: {}, amenities: [] } });
  check('(5) bare "ارض" (no hamza) grounds type', landNoHamza.establishedState.type === 'Residential Land');

  const floor = buildTurnDecision({ ...noPrior, text: 'عندي دور واحد فقط في جدة', location: 'جدة', out: { type: 'Floor', af: {}, amenities: [] } });
  check('(5) bare "دور" (floor) grounds type', floor.establishedState.type === 'Floor');

  const shop = buildTurnDecision({ ...noPrior, text: 'أبغى محل تجاري في الدمام', location: 'الدمام', out: { type: 'Shop', af: {}, amenities: [] } });
  check('(5) bare "محل" (shop) grounds type', shop.establishedState.type === 'Shop');

  // THE DEFINITE ARTICLE (attaches with no space — «الأرض»/«المحل»/«الدور» are the ORDINARY way to
  // say "the land/shop/floor", not an edge case): must ALSO ground, not just the bare noun.
  const theLand = buildTurnDecision({ ...noPrior, text: 'ابغى الأرض اللي بجدة', location: 'جدة', out: { type: 'Residential Land', af: {}, amenities: [] } });
  check('(5) "الأرض" (definite article, no space) grounds type too', theLand.establishedState.type === 'Residential Land');
  const theShop = buildTurnDecision({ ...noPrior, text: 'أبغى المحل اللي في السوق بالرياض', location: 'الرياض', out: { type: 'Shop', af: {}, amenities: [] } });
  check('(5) "المحل" (definite article, no space) grounds type too', theShop.establishedState.type === 'Shop');

  // THE EXACT FALSE-POSITIVE \b WAS ORIGINALLY REACHED FOR (must stay negative, or the fix just
  // trades a false-negative for a worse false-positive): "دور" as a bare \b-wrapped substring would
  // have matched this app's OWN tagline verb تدور and the common noun دورة (bathroom/session).
  const tagline = buildTurnDecision({ ...noPrior, text: 'تدور على عقار في الرياض', location: 'الرياض', out: { type: 'Floor', af: {}, amenities: [] } });
  check('(5) "تدور" (verb, app tagline) must NOT ground type — fabricated type stays dropped',
    tagline.establishedState.type === null, JSON.stringify(tagline.establishedState.type));
  const bathroom = buildTurnDecision({ ...noPrior, text: 'فيها 3 دورات مياه في الرياض', location: 'الرياض', out: { type: 'Floor', af: {}, amenities: [] } });
  check('(5) "دورات مياه" (bathrooms) must NOT ground type', bathroom.establishedState.type === null);
  const flooring = buildTurnDecision({ ...noPrior, text: 'نوع الأرضية بلاط في الرياض', location: 'الرياض', out: { type: 'Residential Land', af: {}, amenities: [] } });
  check('(5) "الأرضية" (flooring — a different word, not «land» + «ال») must NOT ground type',
    flooring.establishedState.type === null, JSON.stringify(flooring.establishedState.type));
}

console.log('\n(4) establishedState FIELD-NAME BUG — a REAL prevQuery (SearchQuery shape) must be read correctly\n');
{
  // A REAL SearchQuery shape (src/data/search.ts): priceInput/priceMin/priceMax, never `.price`; flat
  // AF keys like ratingMin/bathMin, never a nested `.af`. Nothing established THIS turn.
  const realPrevQuery = {
    // type established on an earlier turn (owner 2026-09-06: location + type ⇒ search); this case
    // is about an earlier-turn PRICE surviving into hasEnoughToSearch, not about the type.
    deal: 'Rent', location: '', category: null, type: 'Apartment', detail: null,
    location: 'الرياض', priceInput: '720000', priceBand: null, ratingMin: 9.0, bathMin: 2,
  };
  const r = buildTurnDecision({ ...base, text: 'وش رايك', prevQuery: realPrevQuery, askCount: 0 });
  check('(4) an earlier-turn price (priceInput) is visible to hasEnoughToSearch() -> listings',
    r.decision.kind === 'listings', JSON.stringify(r.decision));
  check('(4) establishedState.price actually carries the real prevQuery value, not undefined',
    r.establishedState.price === '720000', JSON.stringify(r.establishedState.price));
  check('(4) establishedState.af actually carries the flat AF facts (ratingMin/bathMin), not null',
    JSON.stringify(r.establishedState.af) === JSON.stringify({ ratingMin: 9.0, bathMin: 2 }),
    JSON.stringify(r.establishedState.af));

  // Same shape but with only priceMin/priceMax set (the Filter-form pair) — still visible.
  const rangeOnly = buildTurnDecision({
    ...base, text: 'وش رايك',
    prevQuery: { deal: 'Buy', type: 'Apartment', location: 'الرياض', priceMin: '400000', priceMax: '900000' },
  });
  check('(4) priceMin/priceMax (no priceInput) also carries forward', rangeOnly.decision.kind === 'listings');
}

console.log('\n(2) AN UNRESOLVED AMBIGUITY ASKS — it is never downgraded into a nationwide search\n');
{
  // SUPERSEDED 2026-09-05 (owner). This asserted that an exhausted budget CONVERGES to listings and
  // that the wiring CLEARS the unresolved term. Both were true, and together they were the bug:
  // clearing the location makes it absent, and absence is exactly what the results RPC reads as the
  // whole Kingdom. Verified in production — answering the city question with «الرياض» (a twin)
  // produced p_cities/p_districts/p_region_ids all null and 39,015 listings.
  const exhausted = buildTurnDecision({
    ...base, text: 'الهفوف', location: 'الهفوف', ambiguityReply: 'أي منطقة تقصد؟', askCount: 2,
  });
  check('(2) budget exhausted + unresolved ambiguity -> message (asks; never a nationwide search)',
    exhausted.decision.kind === 'message', JSON.stringify(exhausted.decision));
  check('(2) the unresolved term is NOT blanked — blanking it is what produced the nationwide search',
    exhausted.location !== '', JSON.stringify({ location: exhausted.location }));
  // THE EXIT — the loop terminates the moment the user answers, at any askCount.
  const answered = buildTurnDecision({
    ...base, text: 'مدينة الرياض', location: 'مدينة الرياض', ambiguityReply: null, askCount: 50,
  });
  check('(2) THE EXIT: once the twin is answered, the next turn searches (no infinite loop)',
    answered.decision.kind === 'listings', JSON.stringify(answered.decision));
  check('(2) …and it searches the RESOLVED place, not a blank one',
    answered.location === 'مدينة الرياض', JSON.stringify({ location: answered.location }));
  // Budget REMAINING behaves the same way it always did — the change is that the ceiling no longer
  // ends the asking, so these two now hold at every askCount rather than only below the ceiling.
  const stillAsking = buildTurnDecision({
    ...base, text: 'الهفوف', location: 'الهفوف', ambiguityReply: 'أي منطقة تقصد؟', askCount: 0,
  });
  check('(2) budget remaining + unresolved ambiguity -> message (asks first, as designed)',
    stillAsking.decision.kind === 'message');
  check('(2) location is left INTACT while still asking (nothing to clear yet)',
    stillAsking.location === 'الهفوف');
}

console.log('\n(4) establishedState FIELD-NAME BUG — a REAL prevQuery (SearchQuery shape) must be read correctly\n');
{
  // A REAL SearchQuery shape (src/data/search.ts): priceInput/priceMin/priceMax, never `.price`; flat
  // AF keys like ratingMin/bathMin, never a nested `.af`. Nothing established THIS turn.
  const realPrevQuery = {
    // type established on an earlier turn (owner 2026-09-06: location + type ⇒ search); this case
    // is about an earlier-turn PRICE surviving into hasEnoughToSearch, not about the type.
    deal: 'Rent', location: '', category: null, type: 'Apartment', detail: null,
    location: 'الرياض', priceInput: '720000', priceBand: null, ratingMin: 9.0, bathMin: 2,
  };
  const r = buildTurnDecision({ ...base, text: 'وش رايك', prevQuery: realPrevQuery, askCount: 0 });
  check('(4) an earlier-turn price (priceInput) is visible to hasEnoughToSearch() -> listings',
    r.decision.kind === 'listings', JSON.stringify(r.decision));
  check('(4) establishedState.price actually carries the real prevQuery value, not undefined',
    r.establishedState.price === '720000', JSON.stringify(r.establishedState.price));
  check('(4) establishedState.af actually carries the flat AF facts (ratingMin/bathMin), not null',
    JSON.stringify(r.establishedState.af) === JSON.stringify({ ratingMin: 9.0, bathMin: 2 }),
    JSON.stringify(r.establishedState.af));

  // Same shape but with only priceMin/priceMax set (the Filter-form pair) — still visible.
  const rangeOnly = buildTurnDecision({
    ...base, text: 'وش رايك',
    prevQuery: { deal: 'Buy', type: 'Apartment', location: 'الرياض', priceMin: '400000', priceMax: '900000' },
  });
  check('(4) priceMin/priceMax (no priceInput) also carries forward', rangeOnly.decision.kind === 'listings');
}
console.log(failures === 0
  ? '\n✅ verify-agent-turn-wiring: all checks passed.\n'
  : `\n❌ verify-agent-turn-wiring: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
