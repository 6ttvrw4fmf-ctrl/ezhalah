// mon_detect_text_facts' "new ads the AI never read" check must stay cheap enough to finish.
//
// THE DEFECT (2026-11-03, alerts cron_timeout_abort:189 + cron_fail:189). mon-text-facts was killed by
// statement_timeout inside its SECOND call to ops_ai_facts_unread_new(): section 8 counted the tables with
// one full pass and, when that count was non-zero, built the alert's detail with another identical pass.
// Under it, facts_ai_is_read() looks a key up in listing_facts (25.7 M rows) and must walk every
// word-checker row of that key before it reaches an AI row — ~47 per key on gathern against 2 AI rows,
// one more per fact per nightly word run, so the cost grows without bound.
//
// THE RULE, three parts, all read from the committed migrations:
//   1. the latest text of section 8 calls ops_ai_facts_unread_new() exactly ONCE;
//   2. a partial index over the AI rows (model not like 'word-checker%') keyed by (platform, listing_key)
//      is declared in a committed migration;
//   3. the detector checks that index is present AND valid (a failed concurrent build leaves an INVALID
//      index that reads as "exists" to a careless check) and raises when it is not.
// Mutation: the pre-fix tree (everything before the patch) fails part 1.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const IDX = 'listing_facts_ai_read_idx';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// The live text of section 8 as of a file list: the last file that defines mon_detect_text_facts or
// patches its section 8 decides. For a patch the replacement (the text after the last anchor) is what runs.
function section8Calls(files: string[]): number | null {
  let calls: number | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    const def = sql.search(/create\s+or\s+replace\s+function\s+public\.mon_detect_text_facts\s*\(/i);
    const patch = sql.includes("pg_get_functiondef('public.mon_detect_text_facts()'");
    if (def < 0 && !patch) continue;
    if (def >= 0) {
      const body = sql.slice(def);
      const s8 = body.indexOf('-- 8. every new ad');
      if (s8 < 0) continue;
      const end = body.indexOf('-- 5. the nightly reader', s8);
      calls = (body.slice(s8, end < 0 ? undefined : end).match(/ops_ai_facts_unread_new\(\)/g) ?? []).length;
    }
    if (patch) {
      // A patch is single-pass when its replacement aggregates the detail in the same select ("into n, d")
      // and swaps the second call for that variable.
      calls = /into n, d\s+from public\.ops_ai_facts_unread_new\(\) g/.test(sql) && sql.includes("$a$'detail', d,$a$") ? 1 : 2;
    }
  }
  return calls;
}

console.log('verify-ai-facts-unread-check-stays-cheap: one pass, index-backed, index self-checked.');

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const calls = section8Calls(files);
check('section 8 is committed', calls !== null);
check('section 8 calls ops_ai_facts_unread_new() exactly once', calls === 1, `calls it ${calls} times`);

const all = files.map((f) => readFileSync(join(MIG, f), 'utf8'));
const idxDecl = all.find((s) => new RegExp(`create index concurrently if not exists ${IDX} on public\\.listing_facts \\(platform, listing_key[^)]*\\) where model not like 'word-checker%'`).test(s));
check(`${IDX} is declared: (platform, listing_key, …) over AI rows only`, Boolean(idxDecl));
check('the detector raises when the index is missing OR invalid',
  all.some((s) => s.includes(`c.relname = '${IDX}' and i.indisvalid`) && s.includes("'ai_facts_read_index_missing'")));

const patchIdx = files.findLastIndex((f) => readFileSync(join(MIG, f), 'utf8').includes("pg_get_functiondef('public.mon_detect_text_facts()'"));
if (patchIdx >= 0) {
  const before = section8Calls(files.slice(0, patchIdx));
  check('mutation: the pre-fix tree is caught calling it twice', before === 2, `pre-fix count ${before}`);
}

if (failures) {
  console.log(`\n❌ verify-ai-facts-unread-check-stays-cheap: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-ai-facts-unread-check-stays-cheap: passed.');
