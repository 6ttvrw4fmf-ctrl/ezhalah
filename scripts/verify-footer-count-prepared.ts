// THE «متابعة» FOOTER NUMBER IS PREPARED DURING THE SEARCH WAIT — NEVER GUESSED, NEVER STALE.
//
// Owner 2026-09-21: card opens instantly (#3449/#3478), but the footer number still took ~2.9s —
// measured live: card open fires exactly one RPC, apartment_guided_counts_ar, uncached. Root cause:
// that RPC IS already called in the background (rankQuestions resolving the advanced pool, or the
// scope-tier's own zero-tick total) but nothing remembered the answer, so the identical later call
// from the card paid for it again. Fix: a remembered cache on fetchApartmentGuidedCounts (same
// pattern as settledScopeCounts) plus a fire-and-forget, SERIAL priming walk that primes the OPENING
// total and each of the first question's own option ticks — so the first tap is instant too.
//
// EXPLICIT OWNER CONSTRAINTS THIS FILE ENFORCES: no hardcoding, no estimating, no caching an
// incorrect/stale number, no weakening the counting logic. Every check below is aimed at one of
// those four.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { windowBetween } from './lib/sourceWindow.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

const root = join(import.meta.dirname, '..');
const remote = stripComments(readFileSync(join(root, 'src/data/remote.ts'), 'utf8'));
const af = stripComments(readFileSync(join(root, 'src/data/advancedFilters.ts'), 'utf8'));
const agentRaw = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const agent = stripComments(agentRaw);

console.log('\nThe «متابعة» footer number is prepared during the wait, never faked (owner 2026-09-21)\n');

// ── 1. remote.ts: fetchApartmentGuidedCounts computes the REAL number, only a LEARNED one is kept ─
const gc = windowBetween(remote, 'export async function fetchApartmentGuidedCounts(',
  '\nexport async function fetchGuidedLiveCount(', 'src/data/remote.ts');
check('the RPC and its params are untouched — the counting logic itself is not weakened',
  /supabase\.rpc\('apartment_guided_counts_ar', \{/.test(gc)
  && /\.\.\.rpcCountFilterParams\(q\)/.test(gc) && /\.\.\.rpcAdvancedFilterParams\(q\)/.test(gc));
check('a cache hit returns the object verbatim — no derived, summed, or rounded number',
  /if \(hit && Date\.now\(\) - hit\.at < COUNT_MEMORY_TTL_MS\) return hit\.c;/.test(gc));
check('only a LEARNED answer is remembered — never a timeout, error, or "nothing" result',
  /const c = \(data as GuidedCounts\[\]\)\[0\];\s*settledGuidedCounts\.set\(ck, \{ at: Date\.now\(\), c \}\);\s*return c;/.test(gc));
{
  const setAt = gc.indexOf('settledGuidedCounts.set(');
  const failExits = [...gc.matchAll(/return (?:PROBE_FAILED|null);/g)].map((m) => m.index!);
  check('every failure exit sits BEFORE the memory write (a failure can never be cached)',
    setAt > 0 && failExits.every((i) => i < setAt));
  const wouldPass = (src: string) => {
    const s2 = src.indexOf('settledGuidedCounts.set(');
    const f2 = [...src.matchAll(/return (?:PROBE_FAILED|null);/g)].map((m) => m.index!);
    return s2 > 0 && f2.every((i) => i < s2);
  };
  const mutated = 'if (error) return PROBE_FAILED; settledGuidedCounts.set(ck, { at: Date.now(), c: null as any });' +
    gc.slice(gc.indexOf('if (error) return PROBE_FAILED;') + 'if (error) return PROBE_FAILED;'.length);
  mustCatch('a failure being written to the memory', !wouldPass(mutated));
}
check('the cache key is the FULL serialized query — a different selection is always a cache miss',
  /const ck = JSON\.stringify\(q\);/.test(gc));
mustCatch('a cache keyed on something narrower than the whole query (e.g. only the scope)',
  !/const ck = JSON\.stringify\(q\);/.test(gc.replace('const ck = JSON.stringify(q);', 'const ck = q.city;')));
check('the memory shares the same TTL as the scope-count cache — one number for what "fresh" means',
  /const COUNT_MEMORY_TTL_MS = 120_000;/.test(remote)
  && (remote.match(/COUNT_MEMORY_TTL_MS/g) ?? []).length >= 3);
check('a background caller can ask for a LONGER budget than the card\'s own 4s, via a real parameter',
  /timeoutMs: number = AGE_COUNT_TIMEOUT_MS,/.test(gc) && /timeoutMs,\s*\);/.test(gc));

// ── 2. advancedFilters.ts: the card's own call site is UNCHANGED; a background twin exists ────────
check('liveResultCount (the card\'s own footer call) is untouched in shape — no new required arg',
  /export async function liveResultCount\(q: SearchQuery, timeoutMs\?: number\): Promise<number \| null> \{/.test(af)
  && /return c\.cnt_selected;/.test(af));
check('primeLiveResultCount calls the SAME function with the background budget — not a second implementation',
  /export const primeLiveResultCount = \(q: SearchQuery\): Promise<number \| null> =>\s*liveResultCount\(q, BACKGROUND_COUNT_TIMEOUT_MS\);/.test(af));

// ── 3. agent.tsx: priming is fire-and-forget, SERIAL, and abandons a superseded walk ───────────────
const prime = windowBetween(agentRaw, 'const primeFooterCounts = async (', '\n  const assessNarrowing = async', 'src/app/agent.tsx');
check('primeFooterCounts primes the OPENING total before walking the ticks',
  /primeLiveResultCount\(scoped\)\.catch/.test(prime));
check('the tick walk is a for-loop with an AWAIT inside — one candidate at a time, never Promise.all',
  /for \(const k of keys\) \{[\s\S]*?await primeLiveResultCount/.test(prime) && !/Promise\.all/.test(prime));
{
  const isSerial = (src: string) =>
    /for \(const k of keys\) \{[\s\S]*?await primeLiveResultCount/.test(src) && !/Promise\.all/.test(src);
  check('(sanity) the real code IS detected as serial by this predicate', isSerial(prime));
  const mutant = 'await Promise.all(keys.map((k) => primeLiveResultCount(question.apply(scoped, [k]))));';
  mustCatch('the walk firing every candidate concurrently (the exact #3420 contention shape)', !isSerial(mutant));
}
check('every hop checks the SAME generation key the passive effect uses — a superseded walk stops',
  /if \(afPrefetchRef\.current\?\.key !== key\) return;/.test(prime));
mustCatch('the supersession check being dropped (a stale walk keeps spending DB time forever)',
  !/if \(afPrefetchRef\.current\?\.key !== key\) return;/.test(prime.replace('if (afPrefetchRef.current?.key !== key) return;\n      ', '')));
check('primeFooterCounts is called for BOTH kinds of first question — a scope tier and the advanced pool',
  (agent.match(/primeFooterCounts\(/g) ?? []).length === 2);
check('scope-tier priming uses the tier\'s OWN resolved options — never a guessed or hardcoded list',
  /primeFooterCounts\(scopeQuestionFor\(tier\), scoped, res\.options\.map\(\(o\) => o\.key\), key\)/.test(agent));
check('advanced-pool priming uses the SAME winner the yes-verdict is based on — offer and prime cannot disagree',
  /const winner = ranked\?\.find\(\(r\) => offersMeaningfulNarrowing\(r\.total, r\.options\)\);/.test(agent)
  && /primeFooterCounts\(winner\.question, scoped, winner\.options\.map\(\(o\) => o\.key\), key\)/.test(agent));
check('priming is fire-and-forget — it does not delay the yes/no verdict the button depends on',
  /primeFooterCounts\([^;]*\);\s*return 'yes';/.test(agent) || (() => {
    const y1 = agent.indexOf("res.options.length > 1");
    const seg = agent.slice(y1, y1 + 260);
    return /primeFooterCounts\([^;]*\);\s*return 'yes';/.test(seg);
  })());

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — the footer number may be late, wrong, stale, or spent unsafely\n`
  : '\n✓ the footer number is prepared during the wait, real, never stale, and primed without contention\n');
process.exit(failed ? 1 : 0);
