// ─────────────────────────────────────────────────────────────────────────────
// locationAmbiguity — the three LOST cases restored (round-2 fix, "LOST LOCATION-AMBIGUITY CASES").
//
// Round 1 proved the deleted client-side src/app/agent.tsx locationClarification() (removed by this
// consolidation branch, git-shown at commit dd303cb~1) covered more ambiguity shapes than the
// server's loc_classify()-based replacement in index.ts: a bare geography cue with no city, a plain
// (non-twin) region asking whole-region-vs-a-named-city, and an empty-location-with-proximity-phrase
// smart question. Ported here faithfully (see each function's own comment for what was and was not
// carried over, and why) as small, pure, Deno- and plain-Node-importable functions — same
// dependency-light convention as decide.ts and turnWiring.ts, so scripts/verify-agent-location-
// ambiguity.ts can import and execute the REAL logic instead of a re-typed copy of it.
//
// index.ts owns the loc_classify() DB round-trip and the "did we already ask this?" history check;
// these functions take their results as plain inputs and are otherwise pure — no I/O, no Deno APIs.
// ─────────────────────────────────────────────────────────────────────────────

// A bare "whole area" statement in the user's OWN words — same test the deleted client-side
// WHOLE_AREA regex ran, scoped here to just the one branch that needs it.
const WANTS_WHOLE_RE = /كامل|كاملة|بالكامل|كلها|كل\s*(?:ال)?منطق/;

/**
 * RESTORED CASE 1 — a plain region with no same-named city (e.g. «عسير», «المنطقة الشرقية»;
 * `region_or_city` in index.ts already handles the same-name-as-a-city twins like الرياض/جازان).
 * Ported from the deleted locationClarification()'s `lm.kind === 'region'` branch: ask whole-region
 * vs. a named city, unless the user already said "كاملة" this turn.
 *
 * Deliberately WITHOUT the old branch's "مثل جدة وأبها" example-cities hint: that came from a
 * client-only ranked-by-inventory city list (topCitiesInRegion) with no server-side RPC equivalent;
 * the question is still complete and correct without the hint (ponytail: add a top-cities-by-region
 * RPC if the hint is missed).
 *
 * @param nm the region's canonical Arabic name (loc_classify's `name`, kind === 'region')
 * @param text this turn's raw user message
 */
export function plainRegionQuestion(nm: string, text: string): string | null {
  if (WANTS_WHOLE_RE.test(text)) return null;
  return `تقصد ${nm} كاملة، أو مدينة معيّنة؟`;
}

// A generic "near <phrase>" construct — Arabic + English. Deliberately NOT the deleted client's full
// structured {relationship, category, name} proximity parser (src/data/proximity.ts, client-only,
// keyword-categorized): a plain "near X" match is enough to ask a question that echoes the user's own
// words instead of a generic one (ponytail: promote to the real category parser if it under-fires).
const NEAR_PHRASE_RE = /((?:قريب(?:ة)?\s*من|بالقرب\s*من|قرب|جنب|جانب|بجانب|near|close\s+to|next\s+to)\s+[^\n.!؟?]{2,40})/iu;

// A bare geography cue (sea/mountain/desert) — mirrors index.ts's own system-prompt wording for this
// exact dimension ("near the sea / beach / coast / corniche / waterfront", "mountains / cool weather
// / highlands", "desert / edge of town / open land").
const GEOGRAPHY_CUE_RE = /بحر|شاطئ|ساحل|كورنيش|واجهة\s*بحرية|جبل|جبال|مرتفعات|صحراء|أطراف\s*(?:المدينة|البلد)|أرض\s*مفتوحة/;

/**
 * RESTORED CASES 2 & 3 — the model correctly left `location` "" (per its own prompt instructions for
 * a geography/proximity cue with no city), but the deleted client-side locationClarification() still
 * asked a SPECIFIC question for these two shapes rather than falling through to the model's generic
 * reply. Ported from its `if (!loc)` branch. The old KINGDOM_WIDE early-return there needs no port —
 * an explicit "everywhere in the Kingdom" statement already makes both regexes below not match (or,
 * for a random unrelated message, matches neither), which is exactly "no ambiguity, proceed".
 *
 * Checked in priority order: a NAMED proximity phrase (more specific — echo it) beats a bare
 * geography cue (less specific — ask generically).
 *
 * @param text this turn's raw user message (location has already been resolved to "" by the caller)
 */
export function emptyLocationQuestion(text: string): string | null {
  const near = text.match(NEAR_PHRASE_RE);
  if (near) return `في أي مدينة تبحث عن عقار ${near[1].trim()}؟`;
  if (GEOGRAPHY_CUE_RE.test(text)) return "تقصد في أي مدينة أو منطقة؟";
  return null;
}
