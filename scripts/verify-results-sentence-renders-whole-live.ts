// ops_incident #347 — PRODUCTION VERIFICATION, and the permanent live watch for its class.
//
// THE DEFECT (measured on production 2026-09-19, الرياض/إيجار): after the SECOND «عرض المزيد» press
// the Results-Found sentence froze one tick short of its end and STAYED there for 90s+, rendering a
// LONE HIGH SURROGATE — half an emoji, a ▯ box — as its final character:
//     "لقينا لك 72,470 نتيجة تطابق بحثك \ud83c"   (34 of 35 UTF-16 code units)
// Three parts made it: the sentence was re-picked on transcript rebuild (which restarts the
// typewriter), `Typer` sliced by UTF-16 CODE UNIT so a frame could land inside a surrogate pair, and
// `runTypewriter`'s finish() never committed under the 500-card render load. It is also the ROOT
// CAUSE of #331: the sentence on screen was not any shipped template, so the pool-derived count
// parser correctly read null and «عرض المزيد» reported its headline moving 21,384 → null.
//
// WHY THIS CHECK IS LIVE AND NOT OFFLINE. Both code fixes are already pinned offline (PR #3232's
// per-message pin, PR #3271's glyph-stepped reveal in `src/lib/typedReveal.ts`). What no offline
// check can see is the thing that actually produced the broken glyph: a REAL browser, under a REAL
// 500-card mount, starving a REAL timer. Every unit was individually correct and only the RENDERED
// result was wrong — so the assertion has to be made against rendered text, in production, after the
// same two presses a user makes. This is the §40 "barriers read SOURCE and query the DATABASE; they
// are blind in exactly the place users live" argument, applied to the one defect that proved it.
//
// WHAT IT ASSERTS, on the sentence the user is actually left looking at:
//   1. NO unpaired UTF-16 surrogate (the ▯ box — the literal #347 symptom);
//   2. STABLE across a long idle (read twice, ~45s apart) — a sentence still revealing is not a
//      defect; a sentence frozen incomplete forever is;
//   3. its count is READABLE and carries the RPC's own total (this is #331's assertion: the
//      displayed sentence must be a whole shipped template, never a truncated prefix of one).
//
// Home: scripts/test-exclusions.txt → .github/workflows/live-search-sweep.yml. It needs production
// AND a browser, so it must not sit in the hermetic required suite (SEARCH_MATCH_QA_ENGINEER.md,
// "the required suite is HERMETIC"). A harness crash exits 2 and is never reported as a product
// failure (§40.7).
//
// Run: PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium node --experimental-strip-types \
//        scripts/verify-results-sentence-renders-whole-live.ts
//
// MUTATION-PROOF-EXEMPT: this file contributes NO verdict logic of its own — it drives production
// and hands the reading to sentenceProblems() (scripts/lib/resultsSentenceHealth.ts), which IS
// mutation-proven, per-PR and hermetically, in verify-results-sentence-renders-whole.ts against both
// of #347's verbatim production renderings, #331's no-template-matched shape, the never-committing
// freeze, an unreadable count, and a sentence quoting the wrong total. A mutation proof HERE would
// have to fake a browser and a 500-card mount, which would prove something about the fake rather
// than about production — and the one thing this file exists to observe is the real render.

// THE ENDPOINT IS RESOLVED THROUGH THE ONE SHARED RESOLVER, and seeded into the environment BEFORE
// the sweep helpers are loaded. `resolvePublicSupabase` falls back to the publishable constants, so
// this check cannot be silently gated by a repo secret that happens to be unset — which is exactly
// how two barriers in this repo never ran at all (scripts/verify-live-checks-self-sufficient.ts).
// The sweep harness reads these names at MODULE LOAD, and ESM imports are hoisted above ordinary
// statements, so the helpers below must be pulled in with a dynamic import AFTER the seed — a
// static import would read the environment before this line had a chance to set it.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
const PUBLIC = resolvePublicSupabase(process.env);
process.env.EXPO_PUBLIC_SUPABASE_URL ||= PUBLIC.url;
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= PUBLIC.key;

// Reuse the sweep's OWN helpers rather than reimplementing them: every §41 trap (the pinned browser
// and proxy flags, the deal/period chip ordering, committing a real city option, «بحث» below the
// fold on mobile) is already solved there, and a second copy would re-learn them the hard way. The
// first draft of this file did exactly that and died on the period chip — because clicking «إيجار»
// alone leaves COMBINED mode, which deliberately has no period selector at all (§40.2).
const { withPage, setDeal, pickCity, runSearch, sleep } =
  await import('../e2e/live-sweep/sweep.mjs' as string) as any;
// The POOL-DERIVED parser the sweep itself uses. `resultsFoundCount` returns null when no SHIPPED
// template matched the rendered text — which is precisely #347's signature and precisely why #331
// read its «عرض المزيد» headline as null. Deriving the matchers from the shipped pool (rather than
// writing a loose /لقينا.*(\d+)/) is what makes "truncated one glyph short" detectable at all.
const { resultsFoundCount, resultsSentenceSource } =
  await import('../e2e/lib/resultsSentence.mjs' as string) as any;
// The SHARED verdict — see scripts/lib/resultsSentenceHealth.ts. The hermetic half mutation-proves
// this exact function against #347's recorded renderings.
import { sentenceProblems } from './lib/resultsSentenceHealth.ts';

// The sentence is drawn from a rotating pool of FORTY shipped templates, and only some of them open
// with «لقينا». An earlier cut of this file located it with a hardcoded `lastIndexOf('لقينا')` and
// reported "no Results-Found sentence rendered at all" on 2 of 4 production runs — a confident,
// total, FALSE defect against a page that was rendering perfectly, just in a different template.
// Its own tell was that the body text was 9,071 chars in the "missing" run and 9,074 in the healthy
// one: a 40-character sentence cannot go missing and leave the length unchanged. §41.15/§41.19 —
// when the oracle and the product disagree by the WHOLE thing, suspect the oracle's ability to NAME
// it first. The pool is the only correct way to name it.
const SENTENCE_RE = new RegExp(resultsSentenceSource(), 'g');

const SEARCH_RPC = 'location_search_candidates_ar';

const AR_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
function allNumbers(s: string): number[] {
  const latin = s.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).replace(/[,،٬]/g, '');
  return [...latin.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/**
 * The LAST «لقينا…/ما لقيت…» line in the transcript. §41.19: the results screen is a CHAT, so every
 * earlier search's sentence is still in the document — reading the FIRST match compares two
 * different messages and invents a mismatch. Always last, exactly as visibleState.headline does.
 */
async function readSentence(page: any): Promise<string | null> {
  // Read the page the way the sweep does — `document.body.innerText`, not a per-element query. The
  // first draft queried div/span/p and got null on a perfectly healthy 500-card screen, because the
  // sentence is split across nested nodes; that was a HARNESS failure wearing a product failure's
  // clothes (§40.7), caught only because the sweep had just read the same headline fine.
  const body: string = await page.evaluate(() => document.body.innerText);
  SENTENCE_RE.lastIndex = 0;
  // §41.19 — the results screen is a CHAT: every earlier search's sentence is still in the
  // transcript, so take the LAST match, exactly as visibleState.headline does. Reading the first one
  // compares two different messages and invents a mismatch.
  const all = [...body.matchAll(SENTENCE_RE)].map((m) => m[0]);
  if (process.env.SENTENCE_DEBUG) {
    console.log(`[diag] body len=${body.length} pool matches=${all.length}`);
  }
  return all.length ? all[all.length - 1].trim() : null;
}

/**
 * When no whole template matched, quote the region a human needs in order to tell a TRUNCATED
 * sentence (the #347 defect) from a sentence that simply is not there. Without this the failure
 * message is unactionable, and an unactionable barrier gets loosened instead of investigated.
 */
function truncationEvidence(body: string): string {
  const marks = ['لقينا', 'لقيت', 'عثرنا', 'طلعت', 'نتيجة', 'إعلان'];
  let best = -1;
  for (const m of marks) { const i = body.lastIndexOf(m); if (i > best) best = i; }
  if (best < 0) return '(no results-shaped text found anywhere on the page)';
  const rest = body.slice(best, best + 160);
  const nl = rest.indexOf('\n');
  return JSON.stringify(nl >= 0 ? rest.slice(0, nl) : rest);
}

const fail: string[] = [];
const ok: string[] = [];

async function main() {
  const code = await withPage(false, async (page: any) => {
    let rpcTotal: number | null = null;
    let lastResponseAt = Date.now();
    page.on('response', async (res: any) => {
      if (!res.url().includes(SEARCH_RPC)) return;
      lastResponseAt = Date.now();
      let req: any = {};
      try { req = JSON.parse(res.request().postData() || '{}'); } catch { return; }
      if ((req.p_limit ?? 0) <= 1) return;      // §41.5 — p_limit 1 is autocomplete, not a search
      try {
        const body = await res.json();
        if (Array.isArray(body) && body.length && body[0]?.total_count != null) {
          rpcTotal = Number(body[0].total_count);
        }
      } catch { /* a non-JSON body is not evidence of anything */ }
    });

    // #347's own cohort: الرياض / إيجار — the largest rent pool there is, which is what produced the
    // 500-card mount that starved the reveal.
    await setDeal(page, 'إيجار');
    if (!(await pickCity(page, 'الرياض'))) {
      console.log('HARNESS ERROR: الرياض was not offered — not a product finding (§41.13).');
      return 2;
    }
    await runSearch(page);
    await sleep(6000);

    // TWO presses — 10 → 100 → 500, the exact sequence #347 was measured on. §41.2: never click bare
    // coordinates. §41.3: the pager is the BOTTOM-MOST match, never a card's own «عرض المزيد».
    let presses = 0;
    for (let press = 1; press <= 2; press++) {
      const pager = page.locator('[data-testid="results-load-more"]').last();
      if (!(await pager.count())) break;
      await pager.scrollIntoViewIfNeeded();
      await pager.click();
      presses++;
      // §41.4 — cards drip in, and §"A flat card count is NOT by itself a pagination defect": the
      // discriminator is whether the app is still FETCHING. Settle on both card count and the wire.
      let stable = 0, prev = -1;
      for (let i = 0; i < 150; i++) {
        await sleep(1000);
        const n = await page.evaluate(() =>
          [...document.querySelectorAll('div')]
            .filter((e) => /^#\d+$/.test(((e as HTMLElement).innerText || '').trim())).length);
        if (n === prev && Date.now() - lastResponseAt > 4000) { if (++stable >= 4) break; } else stable = 0;
        prev = n;
      }
    }

    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('div')]
        .filter((e) => /^#\d+$/.test(((e as HTMLElement).innerText || '').trim())).length);

    // Read, idle a long time, read again. #347's sentence stayed frozen for 90s+, so a single read
    // cannot tell a mid-reveal sentence from a permanently dead one.
    const first = await readSentence(page);
    await sleep(45_000);
    const second = await readSentence(page);

    console.log(`\n«عرض المزيد» presses : ${presses}`);
    console.log(`cards on screen      : ${cards}`);
    console.log(`RPC total_count      : ${rpcTotal}`);
    console.log(`sentence @t0         : ${JSON.stringify(first)}`);
    console.log(`sentence @t+45s      : ${JSON.stringify(second)}`);

    if (presses < 2) {
      // Not a product failure by itself — a cohort that ends before two presses simply cannot
      // exercise the 500-card mount this check exists for. Say so rather than passing vacuously.
      console.log('HARNESS/COHORT: fewer than two presses available — the 500-card mount was never ' +
        'reached, so this run proves nothing about #347. Not a product verdict.');
      return 2;
    }

    // THE VERDICT IS THE SHARED PREDICATE'S, not this file's. `sentenceProblems` is the same
    // function the hermetic half mutation-proves against #347's exact recorded renderings, so a
    // green run here is a statement about code that has been watched to go red on the real defect.
    const bodyText: string = await page.evaluate(() => document.body.innerText);
    const problems = sentenceProblems({
      sentence: second,
      earlier: first,
      quoted: resultsFoundCount(bodyText),
      rpcTotal,
      numbersInSentence: second ? allNumbers(second) : [],
      evidence: truncationEvidence(bodyText),
    });

    if (problems.length) { fail.push(...problems); return 1; }
    ok.push('the settled sentence contains no unpaired surrogate — no half-emoji is rendered');
    ok.push('the sentence is stable across a 45s idle — the reveal committed');
    ok.push(`a whole shipped template matched and carries the RPC total ${rpcTotal}`);
    return 0;
  });

  for (const o of ok) console.log(`  ✓ ${o}`);
  for (const f of fail) console.log(`  ❌ ${f}`);

  if (code === 2) process.exit(2);
  if (code === 1) {
    console.log(`\n❌ results-sentence-renders-whole: ${fail.length} failure(s)`);
    process.exit(1);
  }
  console.log('\n✓ results-sentence-renders-whole: the Results-Found sentence survives the 500-card mount');
}

main().catch((e) => {
  // A harness crash is a HARNESS error (§40.7) — exit 2, never a product FAIL.
  console.log(`HARNESS ERROR: ${e?.message || e}`);
  process.exit(2);
});
