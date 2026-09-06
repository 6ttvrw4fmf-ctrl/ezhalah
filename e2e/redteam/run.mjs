// ROUTINE #9 — the per-run chain walk. L1→L8 on production, one action at a time.
//
// Each chain asserts the equalities of docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md §0:
//   user action = frontend request = RPC parameters = DB truth set
//               = displayed count = returned IDs = card evidence = continuation
//
// A layer this run could not REACH is printed and counted separately — never folded into the passes
// (PART 7: "a rule this run could not reach is not a rule this run proved").

import { chain, tap, setDeal, setPeriod, pickCity, runSearch, visibleState, oracleCount, oracleFilterFromRequest, sleep, BASE } from './chain.mjs';

const PLANS = [
  // Never Riyadh-heavy (§40.2). Deliberately spread across deal × period × region × viewport.
  { id: 'rent-default-jeddah',   deal: 'إيجار', period: null,   city: 'جدة',    mobile: false },
  { id: 'rent-default-dammam',   deal: 'إيجار', period: null,   city: 'الدمام', mobile: true  },
  { id: 'rent-monthly-jeddah',   deal: 'إيجار', period: 'شهري', city: 'جدة',    mobile: false },
  { id: 'rent-annual-makkah',    deal: 'إيجار', period: 'سنوي', city: 'مكة',    mobile: false },
  { id: 'rent-monthly-khobar',   deal: 'إيجار', period: 'شهري', city: 'الخبر',  mobile: true  },
  { id: 'buy-jeddah',            deal: 'بيع',   period: null,   city: 'جدة',    mobile: false },
  { id: 'buy-madinah',           deal: 'بيع',   period: null,   city: 'المدينة المنورة', mobile: true },
  { id: 'buy-taif',              deal: 'بيع',   period: null,   city: 'الطائف', mobile: false },
  { id: 'both-jeddah',           deal: 'both',  period: null,   city: 'جدة',    mobile: false },
  { id: 'both-dammam',           deal: 'both',  period: null,   city: 'الدمام', mobile: true  },
  { id: 'both-makkah',           deal: 'both',  period: null,   city: 'مكة',    mobile: false },
  { id: 'rent-default-buraidah', deal: 'إيجار', period: null,   city: 'بريدة',  mobile: false },
];

const ONLY = process.env.RT_ONLY ? process.env.RT_ONLY.split(',') : null;
const results = [];

for (const plan of (ONLY ? PLANS.filter((p) => ONLY.includes(p.id)) : PLANS)) {
  const r = { id: plan.id, plan, layers: {}, notReached: [], findings: [] };
  try {
    await chain(plan, async ({ page, wire, responses }) => {
      // ── L1 USER ACTION ──────────────────────────────────────────────────────────────────────────
      await setDeal(page, plan.deal);
      await setPeriod(page, plan.period);
      const picked = await pickCity(page, plan.city);
      if (!picked) { r.notReached.push('L1: city suggestion never offered — harness, UNDETERMINED'); return; }
      const settled = await runSearch(page);
      if (!settled) r.notReached.push('L5: the app never printed a settled sentence within the budget — harness');

      // ── L1 (read back from the app's OWN summary, not from what we clicked) ─────────────────────
      const vis = await visibleState(page);
      r.layers.L1 = { summaryFound: vis.summaryFound, city: vis.city, deal: vis.deal, region: vis.region };

      // ── L2/L3 FRONTEND REQUEST + RPC PARAMETERS (off the wire) ─────────────────────────────────
      // Only p_limit > 1 requests are RESULT searches; autocomplete reuses the RPC at p_limit 1 (§41.5).
      const res = wire.results.filter((p) => Number(p.p_limit ?? 0) > 1);
      const last = res[res.length - 1];
      if (!last) { r.notReached.push('L2: no results RPC with p_limit>1 was captured'); return; }
      r.layers.L2 = {
        p_rent_period: last.p_rent_period ?? null, p_deal: last.p_deal ?? null,
        p_tables: Array.isArray(last.p_tables) ? last.p_tables.length : null,
        p_city: last.p_city ?? null, p_limit: last.p_limit,
      };
      const allCounts = wire.counts.map((c) => ({ rpc: c.rpc, p_rent_period: c.post.p_rent_period ?? null,
        p_deal: c.post.p_deal ?? null, p_tables: Array.isArray(c.post.p_tables) ? c.post.p_tables.length : null }));
      r.layers.L3_counts = allCounts;

      // ── THE #9 EQUALITY: every count RPC must carry the SAME period scope as the results RPC ──
      // COMPARE LIKE WITH LIKE. The count RPCs fire on every keystroke and every toggle, so the
      // capture also holds calls made under EARLIER UI states (the default بيع, the transient
      // Buy+Rent between the two toggle presses). Those are not disagreements — they are different
      // questions, correctly asked. Comparing them all reported two false defects on this driver's
      // first run, which is exactly the shape §41.15 forbids: an oracle that accuses the product for
      // its own imprecision is worse than no oracle.
      // So: only the LAST call per RPC, and only where the deal scope MATCHES the results RPC —
      // i.e. the call that describes the same search the user is looking at.
      const comparable = [];
      for (const rpc of [...new Set(allCounts.map((c) => c.rpc))]) {
        const sameDeal = allCounts.filter((c) => c.rpc === rpc && c.p_deal === r.layers.L2.p_deal);
        if (sameDeal.length) comparable.push(sameDeal[sameDeal.length - 1]);
      }
      r.layers.L3_compared = comparable;
      if (!comparable.length) r.notReached.push('L3: no count RPC fired under the final deal scope — nothing to compare');
      for (const c of comparable) {
        if (c.p_rent_period !== r.layers.L2.p_rent_period) {
          r.findings.push(`L3 DISAGREEMENT ${c.rpc}: p_rent_period=${JSON.stringify(c.p_rent_period)}`
            + ` while the results RPC (same p_deal=${JSON.stringify(c.p_deal)}) sent ${JSON.stringify(r.layers.L2.p_rent_period)}`);
        }
        if (c.p_tables !== r.layers.L2.p_tables) {
          r.findings.push(`L3 SCOPE DISAGREEMENT ${c.rpc}: p_tables=${c.p_tables} vs results ${r.layers.L2.p_tables}`);
        }
      }

      // ── L5 DISPLAYED COUNT ─────────────────────────────────────────────────────────────────────
      const m = vis.raw.match(/لقينا\s+([\d,،]+)/);
      r.layers.L5 = m ? Number(m[1].replace(/[,،]/g, '')) : null;
      if (r.layers.L5 === null) r.notReached.push('L5: no «لقينا N» count sentence on screen');

      // ── L6 RETURNED IDS (off the response, never card text) ─────────────────────────────────────
      const rows = (responses[responses.length - 1] || { rows: [] }).rows;
      const ids = rows.map((x) => `${x.source_table}:${x.listing_id}`);
      r.layers.L6 = { returned: ids.length, distinct: new Set(ids).size };
      if (ids.length !== new Set(ids).size) r.findings.push(`L6 DUPLICATES: ${ids.length} rows, ${new Set(ids).size} distinct`);

      // ── L4 DB TRUTH — the INDEPENDENT oracle, built ONLY from the captured request ──────────────
      const tr = oracleFilterFromRequest(last);
      if (tr.unhandled) {
        // The oracle REFUSES rather than guesses (PART 2.2 rule 2): silently dropping a parameter
        // widens the oracle's set until it agrees, which is the agreement-for-the-wrong-reason failure.
        r.notReached.push(`L4: oracle cannot faithfully translate ${tr.unhandled.join(', ')} — chain NOT PROVEN at L4`);
      } else {
        // READ IT TWICE. search_listings_ar is synced continuously (sync-search-listings-ar at :14
        // and the platform writers around it), so a single read taken seconds after the RPC can
        // differ from what the RPC saw by a row or two purely because the index MOVED. A 1-row delta
        // reported as a count defect is the false-product-bug shape §41 exists to prevent. If the two
        // reads disagree, the index was in motion during the window and this chain cannot decide —
        // UNKNOWN, printed, never folded into the passes.
        const truth = await oracleCount(tr.filters);
        await sleep(1500);
        const truth2 = await oracleCount(tr.filters);
        r.layers.L4 = truth;
        r.layers.L4_recheck = truth2;
        if (truth === null || truth2 === null) r.notReached.push('L4: oracle fetch failed — UNKNOWN, not zero');
        else if (truth !== truth2) {
          r.notReached.push(`L4: the index moved during the read (${truth} → ${truth2}) — count comparison UNDECIDABLE this run`);
        } else if (r.layers.L5 !== null && truth !== r.layers.L5) {
          r.findings.push(`L4/L5 COUNT MISMATCH: independent oracle=${truth} (stable across two reads), screen shows ${r.layers.L5}`);
        }
      }

      // ── L8 CONTINUATION — «عرض المزيد» clicked for real, batches compared by id ─────────────────
      const before = new Set(ids);
      const more = await tap(page, 'عرض المزيد', 6000);
      if (!more) { r.notReached.push('L8: «عرض المزيد» not present (set may fit one page)'); return; }
      await sleep(6000);
      // A CONTINUATION IS ONLY A CONTINUATION IF THE REQUEST ADVANCED. If «عرض المزيد» re-issued the
      // SAME body (same p_offset/p_limit), the second response is the same page re-fetched, and
      // scoring its ids as "repeats" accuses the product of a defect the harness invented — the first
      // run of this driver did exactly that. Compare the bodies first, and say so when they match.
      const r2 = responses[responses.length - 1];
      const sameBody = r2 && JSON.stringify(r2.post) === JSON.stringify(last);
      const ids2 = (r2?.rows ?? []).map((x) => `${x.source_table}:${x.listing_id}`);
      const overlap = ids2.filter((i) => before.has(i));
      r.layers.L8 = { batch2: ids2.length, overlapWithBatch1: overlap.length,
        p_offset: r2?.post?.p_offset ?? null, p_limit: r2?.post?.p_limit ?? null, sameRequestBody: !!sameBody };
      if (sameBody) {
        r.notReached.push('L8: «عرض المزيد» produced no NEW results request (same body) — continuation NOT PROVEN');
      } else if (overlap.length) {
        r.findings.push(`L8 PAGINATION REPEAT: ${overlap.length} of ${ids2.length} ids in batch 2 were already in batch 1`
          + ` (batch2 p_offset=${r2?.post?.p_offset}, p_limit=${r2?.post?.p_limit})`);
      }
      const vis2 = await visibleState(page);
      const m2 = vis2.raw.match(/لقينا\s+([\d,،]+)/);
      const total2 = m2 ? Number(m2[1].replace(/[,،]/g, '')) : null;
      if (total2 !== null && r.layers.L5 !== null && total2 !== r.layers.L5) {
        r.findings.push(`L8 TOTAL MOVED across pagination: ${r.layers.L5} → ${total2}`);
      }
    });
  } catch (e) {
    r.notReached.push(`harness: ${e.message}`);   // UNDETERMINED, never a product incident (§6)
  }
  results.push(r);
  console.log(`\n═══ ${r.id} (${plan.deal}/${plan.period ?? 'default'}/${plan.city}/${plan.mobile ? 'mobile' : 'desktop'}) ═══`);
  console.log('  L1 visible :', JSON.stringify(r.layers.L1 ?? null));
  console.log('  L2 results :', JSON.stringify(r.layers.L2 ?? null));
  console.log('  L3 counts  :', JSON.stringify(r.layers.L3_compared ?? null), `(of ${(r.layers.L3_counts ?? []).length} captured)`);
  console.log('  L4 oracle  :', r.layers.L4 ?? '(not reached)');
  console.log('  L5 displayed:', r.layers.L5 ?? '(not reached)');
  console.log('  L6 ids     :', JSON.stringify(r.layers.L6 ?? null));
  console.log('  L8 more    :', JSON.stringify(r.layers.L8 ?? null));
  r.findings.forEach((f) => console.log(`  ‼ FINDING: ${f}`));
  r.notReached.forEach((n) => console.log(`  · not reached: ${n}`));
  await sleep(2500);   // §40.6 envelope: well under 1.5 searches/s, concurrency 1
}

const findings = results.flatMap((r) => r.findings.map((f) => `${r.id}: ${f}`));
const notReached = results.flatMap((r) => r.notReached.map((n) => `${r.id}: ${n}`));
console.log(`\n════════ SUMMARY ════════`);
console.log(`chains run          : ${results.length}`);
console.log(`chains with findings: ${results.filter((r) => r.findings.length).length}`);
console.log(`DISAGREEMENTS       : ${findings.length}`);
findings.forEach((f) => console.log(`  ‼ ${f}`));
console.log(`LAYERS NOT REACHED  : ${notReached.length}`);
notReached.forEach((n) => console.log(`  · ${n}`));
