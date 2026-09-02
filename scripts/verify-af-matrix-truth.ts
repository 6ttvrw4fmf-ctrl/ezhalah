// ONE TRUTH ACROSS THE WHOLE CERTIFIED ADVANCED-FILTER MATRIX — the offline half.
//
// THE OWNER'S INVARIANT, verbatim: «What the AF UI says + what the user selects + what the backend
// applies + what the returned listings actually satisfy must all be the same truth.»
//
// Every earlier AF barrier proves that on a slice: one cohort, one option, one journey. This file
// walks the WHOLE matrix — every scope (each clean type, each group) × every deal/period mode ×
// every question the real pool offers there × every option its real resolveOptions() defines — and
// for every cell executes the real production code (lifted, never copied; see scripts/lib/
// afMatrix.ts) against a MEANING table that was written independently of that code.
//
// What this half proves without a network (its live twin, verify-af-matrix-truth-live.ts, proves
// the numbers against production and the real DB for the same cells):
//   §1 the gate agrees with the certification TABLE on every (type, mode, question) — and a type
//      with no cohort (Chalet, Camp, …) offers nothing in any mode;
//   §2 SELECTION = PREDICATE: the option's real apply() + the real rpcAdvancedFilterParams() yield
//      exactly the meaning's params — nothing dropped, nothing extra; two options of one field
//      combine as the field's rule says (OR for directions, ALL-of for amenities); two different
//      fields intersect;
//   §3 COUNT WIRING: the count column each option reads is the column its meaning names, and the
//      «did not mention» caption derives from exactly the columns that partition the scope;
//   §4 REMOVAL: the real withoutFacet() returns the base predicate — every AF field cleared;
//   §5 TRENDING CARRY: the real rpcAllNarrowingParams() forwards every option's predicate, and the
//      RESULTS path spreads the ONE param builder rather than a hand-typed copy of it;
//   §6 RE-CERTIFICATION: moving a committed option to every other mode and every other type keeps
//      it exactly when the TABLE certifies it there (token-by-token for amenities) and drops it
//      otherwise — UNKNOWN never becomes No on the new cohort;
//   §7 the licence arm, EXECUTED from the clause mirror: false never admits a silent row; and no sender;
//   §8 bothDeals (agent-only) can never reach the Filter store, so its Trending check does not apply.
//
// MUTATION RECORD (2026-09-02, each built on a scratch worktree, confirmed RED, restored GREEN —
// the number is how many of the 28,061 assertions went red):
//   COUNTS      bathrooms «2» reads cnt_bath3 ..................................... 16 red (§3)
//   PREDICATES  p_bath_min dropped from rpcAdvancedFilterParams ..................... 88 red (§2)
//               wrong field sent (p_age_min: q.ageMax) ............................. 155 red (§2)
//   OR/AND      direction apply() replaces instead of unioning ....................... 21 red (§2)
//               addAmenities replaces the bag (ALL-of lost) .......................... 31 red (§2)
//   DROPPED     sanitizer allowlist loses 'directions' .............................. 168 red (§4)
//   STALE       withoutFacet() is a no-op ............................................ 742 red (§4)
//   TRENDING    rpcAllNarrowingParams stops forwarding AF params .................... 742 red (§5)
//   RESULTS     spread removed, original left as a decoy comment ....................... 1 red (§5)
//               hand-typed copy re-added beside the builder ............................ 1 red (§5)
//   NULL        «غير مفروشة» sends no predicate (NULL rows served as unfurnished) ....... 8 red (§2)
//   sweep       tidy-up reindex (withoutFacet removes index+1) ....................... 742 red (§4)
//               helper extracted, not called (reconcile skips certifiedFacets) ... 16,963 red (§6)
//               early return on an empty facet list (last chip never clears) ....... 742 red (§4)
//               cohortAllowsCombined uses OR ...................................... 9,674 red (§1)
//               «10+ years» silently capped at 20 .................................... 31 red (§2)
//               furnished caption reads the wrong column .............................. 8 red (§3)
//               furnished chip pushed on an uncertified cohort ....................... 90 red (§4)
// The matrix size is printed on every run — a shrinking matrix is a finding, so the floor below is
// asserted, never just logged.
import { join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripComments } from './lib/stripComments.ts';
import {
  loadLifted, buildMatrix, recorder, allScopes, MODES, tableAllows, inMode, optionMeaning, fieldMeaning, sortedJson, paramsAcross,
  type Cell, type Mode, type Scope,
} from './lib/afMatrix.ts';
import { sanitizeForFilterRestore, AF_PREDICATE_FIELDS } from '../src/lib/searchDefaults.ts';
import { reconcileCommittedAf, withoutFacet } from '../src/lib/afCarry.ts';
import { COHORT_QUESTIONS, certifiedAmenityKeys } from '../src/lib/afCohorts.ts';
import { ALL_CLEAN_TYPES, CLEAN_MACRO, groupsOf } from '../src/data/propertyTypes.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0, passed = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) { passed++; return; }
  failed++; console.log(`  ❌ FAIL  ${msg}`);
};
const section = (s: string) => console.log(`\n── ${s}`);
const same = (a: unknown, b: unknown) => sortedJson(a) === sortedJson(b);

const L = await loadLifted(ROOT);
const rec = recorder();
const cells = await buildMatrix(L, { guided: rec.row, age: rec.row });
const certified = cells.filter((c) => c.fields.length);
const nOptions = certified.reduce((n, c) => n + c.fields.reduce((m, f) => m + f.options.length, 0), 0);
const nFields = certified.reduce((n, c) => n + c.fields.length, 0);
console.log(`\nAF matrix: ${allScopes().length} scopes × ${MODES.length} modes = ${cells.length} cells · ` +
  `${certified.length} certified cells · ${nFields} (cell, field) · ${nOptions} options`);
// THE FLOOR. 149 (cell, field) pairs and 886 options were measured on 2026-09-02 from the real
// pool (742 before the 8 rich amenity chips joined every residential amenities cell: 742 + 8 × 18). Fewer means a certification silently vanished (or the lift stopped finding the pool).
assert(nFields >= 149 && nOptions >= 886, `the matrix did not shrink below the measured floor (149 fields / 886 options; now ${nFields} / ${nOptions})`);
assert(L.questions.length >= 9, `the real pool was lifted (${L.questions.length} questions)`);

// ── §1 gate == table; no cohort ⇒ nothing ────────────────────────────────────────────────────────
section('§1 the gate agrees with the certification TABLE on every (type, mode, question)');
const IDS = L.questions.map((q) => q.id);
for (const cell of cells) {
  const offered = new Set(cell.fields.map((f) => f.question.id));
  const expected = new Set(IDS.filter((id) => cell.scope.types.every((t) => tableAllows(t, cell.mode, id))));
  // direction/unit_subtype refuse to re-ask once committed; on a bare scope that guard is inert.
  assert(same([...offered].sort(), [...expected].sort()),
    `${cell.scope.kind} ${cell.scope.label} / ${cell.mode.mode}: pool offers [${[...offered]}] but the table certifies [${[...expected]}]`);
}
for (const type of ALL_CLEAN_TYPES.filter((t) => !COHORT_QUESTIONS[t])) {
  for (const cell of cells.filter((c) => c.scope.kind === 'type' && c.scope.label === type)) {
    assert(cell.fields.length === 0, `${type} has no cohort and must offer NOTHING in ${cell.mode.mode}`);
  }
}

// ── §2 SELECTION = PREDICATE ─────────────────────────────────────────────────────────────────────
section('§2 selecting an option sends exactly its meaning — nothing dropped, nothing extra');
for (const cell of certified) {
  const tag = `${cell.scope.label}/${cell.mode.mode}`;
  for (const f of cell.fields) {
    const fm = fieldMeaning(f.question.id);
    assert(!!fm, `${tag}: field "${f.question.id}" has a stated meaning (combine rule, partition, caption columns)`);
    for (const o of f.options) {
      const m = optionMeaning(f.question.id, o.key);
      if (!m) { assert(false, `${tag}: option ${f.question.id}=${o.key} has NO stated meaning — an unspecified option cannot be certified`); continue; }
      const sent = L.rpcAdvancedFilterParams(f.question.apply(cell.query, [o.key]));
      assert(same(sent, m.params), `${tag}: ${f.question.id}=${o.key} sends ${JSON.stringify(sent)}, meaning ${JSON.stringify(m.params)}`);
    }
    // two options of ONE field
    if (fm && f.options.length >= 2) {
      const [a, b] = f.options;
      const ma = optionMeaning(f.question.id, a.key)!, mb = optionMeaning(f.question.id, b.key)!;
      const both = L.rpcAdvancedFilterParams(f.question.apply(cell.query, [a.key, b.key]));
      if (f.question.selection === 'multi') {
        assert(same(both, fm.paramsBoth(ma.params, mb.params)),
          `${tag}: ${f.question.id}=[${a.key},${b.key}] sends ${JSON.stringify(both)} (${fm.combine.toUpperCase()} of both)`);
      } else {
        // a single-select ladder takes ONE answer; the first key wins and the second is not smuggled in
        assert(same(both, ma.params), `${tag}: single-select ${f.question.id} given two keys applies only the first (${JSON.stringify(both)})`);
      }
    }
  }
  // two DIFFERENT fields intersect: every param of both, no interference
  if (cell.fields.length >= 2) {
    const [A, B] = cell.fields;
    const ma = optionMeaning(A.question.id, A.options[0].key)!, mb = optionMeaning(B.question.id, B.options[0].key)!;
    const q2 = B.question.apply(A.question.apply(cell.query, [A.options[0].key]), [B.options[0].key]);
    assert(same(L.rpcAdvancedFilterParams(q2), paramsAcross(ma.params, mb.params)),
      `${tag}: ${A.question.id}=${A.options[0].key} ∧ ${B.question.id}=${B.options[0].key} sends both predicates (${JSON.stringify(L.rpcAdvancedFilterParams(q2))})`);
  }
}

// ── §3 COUNT WIRING ──────────────────────────────────────────────────────────────────────────────
section('§3 every option reads the count column its meaning names; captions derive from the partition');
for (const cell of certified) {
  const tag = `${cell.scope.label}/${cell.mode.mode}`;
  for (const f of cell.fields) {
    const fm = fieldMeaning(f.question.id);
    if (!fm) continue;
    for (const o of f.options) {
      const m = optionMeaning(f.question.id, o.key);
      if (m) assert(o.count === m.cntCol, `${tag}: ${f.question.id}=${o.key} reads ${String(o.count)}, meaning ${m.cntCol}`);
    }
    assert(f.resolved.total === fm.totalCol, `${tag}: ${f.question.id} total reads ${String(f.resolved.total)}, meaning ${fm.totalCol}`);
    // OFFERED == CERTIFIED, token by token (owner ruling 2026-09-02, GAP 1): every amenity token the
    // cohort certifies must be a chip on this card, and no chip may be uncertified. Before this the
    // 8 rich tokens were certified for chat and absent here — a predicate a sentence could commit
    // that no card could show. `furnished` rides the amenities card on exactly the condition
    // certifiedAmenityKeys() mirrors, so the two lists must be identical, not merely nested.
    if (f.question.id === 'amenities') {
      const offered = f.options.map((o) => o.key).sort();
      const certifiedKeys = certifiedAmenityKeys(cell.query).sort();
      assert(same(offered, certifiedKeys), `${tag}: amenities card offers [${offered}] but the cohort certifies [${certifiedKeys}]`);
    }
    if (fm.unknownCols) {
      const r2 = recorder();
      let cols: string[];
      if (f.resolved.unknownOf) { f.resolved.unknownOf(r2.row); cols = [...r2.reads]; }
      else cols = typeof f.resolved.unknownCount === 'string' ? [f.resolved.unknownCount] : [];
      assert(same(cols.sort(), [...fm.unknownCols].sort()),
        `${tag}: ${f.question.id} «did not mention» derives from [${cols}], meaning [${fm.unknownCols}]`);
    } else {
      assert(f.resolved.unknownCount === null, `${tag}: ${f.question.id} has no truthful unknown count and must claim none (got ${String(f.resolved.unknownCount)})`);
    }
  }
}

// ── §4 REMOVAL ───────────────────────────────────────────────────────────────────────────────────
section('§4 removing an option through the real withoutFacet() returns the base predicate');
const facetOf = (id: string, keys: string[]) => ({ id, keys, labels: keys.map((k) => `#${k}`) });
for (const cell of certified) {
  const tag = `${cell.scope.label}/${cell.mode.mode}`;
  for (const f of cell.fields) {
    for (const o of f.options) {
      const committed = f.question.apply(cell.query, [o.key]);
      const stored = sanitizeForFilterRestore({ ...committed, afFacets: [facetOf(f.question.id, [o.key])] } as SearchQuery);
      const back = reconcileCommittedAf(inMode(stored, cell.mode), L.questions);
      assert(same(L.rpcAdvancedFilterParams(back), L.rpcAdvancedFilterParams(committed)),
        `${tag}: ${f.question.id}=${o.key} survives the store round-trip (${JSON.stringify(L.rpcAdvancedFilterParams(back))})`);
      const removed = withoutFacet(back, 0, L.questions);
      const still = AF_PREDICATE_FIELDS.filter((k) => (removed as Record<string, unknown>)[k] !== undefined);
      assert(same(L.rpcAdvancedFilterParams(removed), {}) && still.length === 0 && removed.afFacets?.length === 0,
        `${tag}: removing ${f.question.id}=${o.key} clears its predicate (sends ${JSON.stringify(L.rpcAdvancedFilterParams(removed))}; still set: [${still}])`);
    }
  }
}

// ── §5 TRENDING CARRY + the results path ─────────────────────────────────────────────────────────
section('§5 the Trending count request and the results request carry the predicate the builder built');
for (const cell of certified) {
  for (const f of cell.fields) {
    for (const o of f.options) {
      const q1 = f.question.apply(cell.query, [o.key]);
      const af = L.rpcAdvancedFilterParams(q1), trending = L.rpcAllNarrowingParams(q1);
      const dropped = Object.keys(af).filter((k) => sortedJson(trending[k]) !== sortedJson(af[k]));
      assert(dropped.length === 0, `${cell.scope.label}/${cell.mode.mode}: Trending drops ${f.question.id}=${o.key} (${dropped.join(',')})`);
    }
  }
}
{
  // The results path used to re-type the 11 AF params by hand next to the shared builder. A hand
  // copy silently stops carrying a 12th predicate — every count surface would narrow and the
  // results would not (the WIDENING direction). Pinned by COUNTING in the comment-stripped literal:
  // the spread appears once, and no `p_<af>:` key is typed there at all.
  const remote = stripComments(readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8'));
  const start = remote.indexOf('const baseRpcParams = {');
  let depth = 0, end = -1;
  for (let i = remote.indexOf('{', start); i < remote.length; i++) {
    if (remote[i] === '{') depth++;
    else if (remote[i] === '}' && --depth === 0) { end = i; break; }
  }
  const literal = start >= 0 && end > 0 ? remote.slice(start, end + 1) : '';
  assert(literal.length > 0, 'the results request literal (baseRpcParams) is still locatable in src/data/remote.ts');
  assert((literal.match(/\.\.\.rpcAdvancedFilterParams\(q\)/g) ?? []).length === 1,
    'the results path spreads rpcAdvancedFilterParams(q) exactly once');
  const afKeys = new Set(Object.keys(L.rpcAdvancedFilterParams({
    ...certified[0].query, amenities: ['x'], bathMin: 1, furnishedPref: true, streetWidthMin: 1, directions: ['x'],
    ratingMin: 1, reviewsMin: 1, unitSubtypes: ['x'], ageMin: 1, ageMax: 1, isNewConstruction: true,
  } as SearchQuery)));
  const typed = [...literal.matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((m) => m[1]).filter((k) => afKeys.has(k));
  assert(typed.length === 0, `no AF param is hand-typed in the results literal beside the builder (found: ${typed.join(', ') || 'none'})`);
}

// ── §6 RE-CERTIFICATION on every transition ──────────────────────────────────────────────────────
section('§6 moving a committed option to another mode/type keeps it iff the TABLE certifies it there');
const typeScopes = allScopes().filter((s) => s.kind === 'type');
const offeredKeys = (scope: Scope, mode: Mode, id: string): Set<string> => {
  const c = cells.find((x) => x.scope.kind === scope.kind && x.scope.label === scope.label && x.mode.mode === mode.mode)!;
  return new Set(c.fields.find((f) => f.question.id === id)?.options.map((o) => o.key) ?? []);
};
let transitions = 0;
for (const cell of certified.filter((c) => c.scope.kind === 'type')) {
  for (const f of cell.fields) {
    for (const o of f.options) {
      const committed = f.question.apply(cell.query, [o.key]);
      const stored = sanitizeForFilterRestore({ ...committed, afFacets: [facetOf(f.question.id, [o.key])] } as SearchQuery);
      const targets: { scope: Scope; mode: Mode }[] = [
        ...MODES.filter((m) => m.mode !== cell.mode.mode).map((mode) => ({ scope: cell.scope, mode })),
        ...typeScopes.filter((s) => s.label !== cell.scope.label).map((scope) => ({ scope, mode: cell.mode })),
      ];
      for (const t of targets) {
        transitions++;
        // the Filter screen's own edits, written onto the raw store: mode toggles and the type row
        const moved = inMode({ ...stored, category: t.scope.category, typeGroups: groupsOf(t.scope.types), types: t.scope.types } as SearchQuery, t.mode);
        const back = reconcileCommittedAf(moved, L.questions);
        const listed = t.scope.types.every((ty) => tableAllows(ty, t.mode, f.question.id));
        // amenities are certified per TOKEN: kept iff the new cell's own card can offer the token
        const keep = listed && (f.question.id !== 'amenities' || offeredKeys(t.scope, t.mode, 'amenities').has(o.key));
        const want = keep ? L.rpcAdvancedFilterParams(f.question.apply(inMode({ ...t.scope.query, typeGroups: groupsOf(t.scope.types), types: t.scope.types } as SearchQuery, t.mode), [o.key])) : {};
        assert(same(L.rpcAdvancedFilterParams(back), want) && (back.afFacets?.length ?? 0) === (keep ? 1 : 0),
          `${cell.scope.label}/${cell.mode.mode} ${f.question.id}=${o.key} → ${t.scope.label}/${t.mode.mode}: expected ${keep ? 'KEPT' : 'DROPPED'} (table ${listed ? 'lists' : 'does not list'} it), got ${JSON.stringify(L.rpcAdvancedFilterParams(back))} with ${back.afFacets?.length ?? 0} chip(s)`);
      }
    }
  }
}
console.log(`  ${transitions} transitions executed`);
assert(transitions > 5000, `the transition sweep really ran (${transitions})`);

// ── §7 the dormant NULL→NO arm stays dormant ─────────────────────────────────────────────────────
section('§7 p_has_license=false admits only an explicit unlicensed fact (none exists ⇒ nothing) — executed from the mirror; and nothing sends it');
const files: string[] = [];
{
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e)) files.push(p); } };
  walk(join(ROOT, 'src')); walk(join(ROOT, 'supabase', 'functions'));
}
{
  // af_eligibility_clause() (fixed 2026-09-02, migration 20260902220100; the OLD arm was
  // `(s.license_number is not null) = p_has_license`) — with false, every
  // row whose source simply never published a number is served as "no licence" (100% of the "no"
  // answer on شقة/إيجار/سنوي is NULL — measured 2026-09-02). That is UNKNOWN → No in the predicate
  // itself and needs a clause change; until then no client or edge path may reach it. COUNTED over
  // comment-stripped source: a decoy comment cannot satisfy or defeat this.
  const senders = files.filter((p) => /\bp_has_license\b/.test(stripComments(readFileSync(p, 'utf8'))));
  assert(senders.length === 0, `no client/edge source sends p_has_license (found in: ${senders.map((p) => p.slice(ROOT.length + 1)).join(', ')})`);

  // THE ARM ITSELF, EXECUTED (owner ruling 2026-09-02, migration 20260902220100): lift the licence
  // arm out of the clause mirror and RUN it — never grep for the fixed spelling, a comment could
  // satisfy that. The SQL boolean arm is a pure expression over one row and one parameter, so a
  // mechanical token map (is null / is not null / and / or / s.col) turns it into JS verbatim; the
  // old arm `(s.license_number is not null) = p_has_license` maps too, and with false it returns
  // TRUE for a NULL row — which is exactly the assertion below going red.
  const mirror = readFileSync(join(ROOT, 'sql/mirrors/af_eligibility_clause.sql'), 'utf8');
  const armMatch = mirror.match(/and \((p_has_license[^\n]*)\)\n/);
  assert(!!armMatch, 'the clause mirror carries exactly one p_has_license arm');
  if (armMatch) {
    const js = armMatch[1]
      .replace(/\bis not null\b/g, '!= null').replace(/\bis null\b/g, '== null')
      .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bs\.(\w+)/g, 'row.$1')
      .replace(/(?<![=!<>])=(?!=)/g, '===');   // SQL equality (the old arm's `= p_has_license`) → strict equality
    assert(!/\b(is|and|or|s\.)\b/.test(js), `the licence arm translated completely: ${js}`);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const arm = new Function('p_has_license', 'row', `return (${js});`) as (p: boolean | null, row: { license_number: string | null }) => unknown;
    const silent = { license_number: null }, published = { license_number: '1234567890' };
    assert(arm(false, silent) === false, `p_has_license=false admits a SILENT row (arm: ${armMatch[1]})`);
    assert(arm(false, published) === false, `p_has_license=false admits a published number (no explicit negative exists in canonical data; arm: ${armMatch[1]})`);
    assert(arm(true, published) === true && !arm(true, silent), 'p_has_license=true admits exactly a published number');
    assert(arm(null, silent) === true && arm(null, published) === true, 'p_has_license=null is no filter');
  }
}

// ── §8 bothDeals can never reach the Trending surface ────────────────────────────────────────────
section('§8 the bothDeals shape (agent-only) never reaches the Filter store the Trending pool reads');
{
  // ADJUDICATED 2026-09-02 (live matrix run, 2 FAILs): on Apartment/bothDeals and Villa/bothDeals the
  // barrier compared top_cities_by_deal_ar(p_deal=null, no p_tables) against the results body (p_deal
  // =null, p_tables=RES_TABLES): 9,415 vs 5,719 and 4,647 vs 4,627 in الرياض — exactly the two
  // monthly-only sources the annual results scope excludes, not an AF carry defect (with p_tables
  // passed, the RPC returns the committed number). The comparison does not APPLY: Trending exists
  // only on the Filter home (src/app/index.tsx), whose store is written through
  // sanitizeForFilterRestore() alone (agent.tsx writeFilterStore, Sidebar.tsx) — and that allowlist
  // drops bothDeals by design. The live tier logs the skip with this reason. If either fact below
  // changes, the skip must be re-adjudicated: Trending would then advertise a Rent-only number for a
  // Buy∪Rent results body.
  const restored = sanitizeForFilterRestore({ ...certified[0].query, bothDeals: true, deal: 'Rent', afFacets: [] } as SearchQuery);
  assert(restored.bothDeals === undefined, 'sanitizeForFilterRestore drops bothDeals (the only writers of the Filter store go through it)');
  const filterHome = stripComments(readFileSync(join(ROOT, 'src/app/index.tsx'), 'utf8'));
  assert(!/\bbothDeals\b/.test(filterHome), 'the Filter home never reads bothDeals for its Trending scope (effDeal derives from dealCombined only)');
  const writers = files.filter((p) => /setQuery\(\(\) => sanitizeForFilterRestore\(/.test(stripComments(readFileSync(p, 'utf8'))));
  assert(writers.length >= 2, `the store-restore writers still route through sanitizeForFilterRestore (${writers.map((p) => p.slice(ROOT.length + 1)).join(', ')})`);
}

console.log(`\n${passed} assertions passed`);
console.log(failed === 0
  ? '\n✅ verify-af-matrix-truth: the whole certified matrix selects, counts, removes, carries and re-certifies one truth.'
  : `\n❌ verify-af-matrix-truth: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
