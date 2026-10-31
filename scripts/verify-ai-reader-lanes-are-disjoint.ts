// THE AI READER'S PARALLEL LANES NEVER SHARE AN AD (owner 2026-10-29: «make sure we capture it all»).
//
// The backlog runs in up to 16 lanes at once (facts-extract.yml `lanes`). Lane k of n must be handed only ids with
// id % n = k by facts_ai_todo_ids, so every unread ad belongs to exactly one lane: none read twice (paid twice), none
// skipped. This pins the three places that make that true, each with a mutation it must catch:
//   1. the latest migration defining facts_ai_todo_ids filters x.id % p_shards = p_shard, and the old four-argument
//      signature was dropped and never recreated after that drop (a second overload is the PGRST203 outage shape);
//   2. scrapers/facts/extract.py passes p_shard / p_shards from --shard;
//   3. the workflow gives each matrix lane its own k with the same n.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// MEANING, NOT WORDING (2026-10-31): this used to also require the drop line and the exact `p_limit, p_shards,
// p_shard);` tail in the LATEST file, so a correct later migration (20261031080211: the picker gained a ninth format
// argument and had no overload left to drop) failed the suite and, through its mirror PR, blocked every deploy.
export const sqlSplitsByLane = (sql: string): boolean =>
  /p_shard integer default 0, p_shards integer default 1/.test(sql) &&
  /and x\.id %% %7\$s = %8\$s/.test(sql) &&
  /p_limit, p_shards, p_shard[,)]/.test(sql) &&
  /p_shards not between 1 and 32 or p_shard < 0 or p_shard >= p_shards/.test(sql);

const DROP_OLD = /drop function if exists public\.facts_ai_todo_ids\(text, integer, text, text\);/;
const DEFINES = /create (or replace )?function public\.facts_ai_todo_ids\(/;
const DEFINES_WITH_LANES = /create (or replace )?function public\.facts_ai_todo_ids\([^)]*p_shard integer/;
/** Across the migrations in order: the four-argument picker was dropped, and no later migration recreates it. */
export const oldSignatureGone = (files: { name: string; sql: string }[]): boolean => {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const at = sorted.map((f) => DROP_OLD.test(f.sql)).lastIndexOf(true);
  if (at < 0) return false;
  return sorted.slice(at).every((f) => !DEFINES.test(f.sql) || DEFINES_WITH_LANES.test(f.sql));
};

export const scriptPassesLane = (py: string): boolean =>
  /params\.update\(\{"p_shard": shard\[0\], "p_shards": shard\[1\]\}\)/.test(py) &&
  /sample_silent\(table, n, args\.seed, args\.mode, lane_of\(args\.shard\)\)/.test(py);

export const workflowGivesEachLaneItsK = (yml: string): boolean =>
  /SHARD: \$\{\{ matrix\.lane \}\}\/\$\{\{ needs\.lanes\.outputs\.n \}\}/.test(yml) &&
  /--shard "\$SHARD"/.test(yml) &&
  /lane: \$\{\{ fromJSON\(needs\.lanes\.outputs\.list\) \}\}/.test(yml);

const migDir = join(root, 'supabase', 'migrations');
const FILES = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(join(migDir, name), 'utf8') }));
const file = FILES.filter((f) => DEFINES.test(f.sql)).pop()?.name ?? '';
const SQL = file ? readFileSync(join(migDir, file), 'utf8') : '';
const PY = readFileSync(join(root, 'scrapers', 'facts', 'extract.py'), 'utf8');
const WF = readFileSync(join(root, '.github', 'workflows', 'facts-extract.yml'), 'utf8');

console.log("The AI reader's parallel lanes never share an ad");
check(`the latest facts_ai_todo_ids (${file || 'none'}) hands lane k only ids with id % n = k`, sqlSplitsByLane(SQL));
check('the old four-argument picker was dropped and no later migration recreates it', oldSignatureGone(FILES));
check('extract.py passes its --shard lane to the picker', scriptPassesLane(PY));
check('facts-extract.yml gives every matrix lane its own k with one n', workflowGivesEachLaneItsK(WF));

mustCatch('the lane filter dropped from the picker', !sqlSplitsByLane(SQL.replace('and x.id %% %7$s = %8$s', '')));
mustCatch('the old picker signature never dropped',
  !oldSignatureGone(FILES.map((f) => ({ ...f, sql: f.sql.replace('drop function if exists public.facts_ai_todo_ids(text, integer, text, text);', '') }))));
mustCatch('the old picker signature recreated after the drop (a second overload)',
  !oldSignatureGone([...FILES, { name: '99999999999999_x.sql', sql: 'create or replace function public.facts_ai_todo_ids(p_table text, p_limit integer, p_mode text, p_seed text) returns setof bigint language sql as $$ select 1 $$;' }]));
mustCatch('the lane arguments not handed to the query',
  !sqlSplitsByLane(SQL.replace(/p_limit, p_shards, p_shard([,)])/, 'p_limit$1')));
mustCatch('the script not passing the lane', !scriptPassesLane(PY.replace('params.update({"p_shard": shard[0], "p_shards": shard[1]})', 'pass')));
mustCatch('every lane given the same k', !workflowGivesEachLaneItsK(WF.replace('SHARD: ${{ matrix.lane }}/', 'SHARD: 0/')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log("\n✓ the AI reader's parallel lanes never share an ad");
