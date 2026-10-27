// A READER LESSON REACHES THE ADS IT WAS LEARNED FOR (owner 2026-10-27: «add guards … so the new coming ads we
// don't face same issue»).
//
// The word reader (scrapers/facts/word_checker.py) learned new words three days running, and none of it reached the
// ~415k ads it had already read: the nightly re-reads only new or changed text. ops_ai_facts_reader_gaps listed
// ~20k residential ads missing an Advanced Filter fact for no reason but age. The fix has three parts and this
// barrier pins all three, each with a mutation it must catch:
//   1. words.py stamps every overlay row with READER_VERSION (a hash of word_checker.py + normalize.py), records the
//      version it runs as (text_facts_reader_version_seen) and asks text_facts_todo for p_reader_version;
//   2. the latest migration that defines text_facts_todo re-reads a row an OTHER version read, and drops the old
//      signature (a second overload is the PGRST203 outage shape);
//   3. facts-words.yml runs on a push to main that touches the reader, on 8 shards.
// The lag alarm itself (mon_detect_text_facts check 7) lives in the same migration and is checked there.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

export const wordsStampsAndAsks = (py: string): boolean =>
  /def _reader_version\(\)[\s\S]{0,200}W\.__file__, N\.__file__/.test(py) &&
  /READER_VERSION = _reader_version\(\)/.test(py) &&
  /"reader_version": READER_VERSION/.test(py) &&
  /rpc\("text_facts_reader_version_seen", \{"p_version": READER_VERSION\}\)/.test(py) &&
  /rpc\("text_facts_todo", \{[\s\S]{0,300}"p_reader_version": READER_VERSION/.test(py);

export const todoRereadsOtherVersions = (sql: string): boolean =>
  /drop function if exists public\.text_facts_todo\(text, bigint, integer, integer, integer\)/.test(sql) &&
  /p_reader_version text default null/.test(sql) &&
  /\$5 is not null and f\.reader_version is distinct from \$5/.test(sql) &&
  /using p_after, p_limit, p_shard, p_shards, p_reader_version/.test(sql) &&
  /text_facts_reader_version_lag/.test(sql);

export const workflowRereadsOnLesson = (yml: string): boolean => {
  const push = /\n  push:\n    branches: \[main\]\n    paths:\n((?:      - .+\n)+)/.exec(yml);
  if (!push) return false;
  const paths = push[1];
  return paths.includes('scrapers/facts/word_checker.py') && paths.includes('scrapers/common/normalize.py') &&
    /SHARDS: \$\{\{ inputs\.shards \|\| \(github\.event_name == 'push' && '8'\) \|\| '1' \}\}/.test(yml);
};

const PY = readFileSync(join(root, 'scrapers', 'facts', 'words.py'), 'utf8');
const WF = readFileSync(join(root, '.github', 'workflows', 'facts-words.yml'), 'utf8');
const migDir = join(root, 'supabase', 'migrations');
const todoFile = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create (or replace )?function public\.text_facts_todo\(/.test(readFileSync(join(migDir, f), 'utf8'))).pop() ?? '';
const SQL = todoFile ? readFileSync(join(migDir, todoFile), 'utf8') : '';

console.log('A reader lesson re-reads the ads read before it');
check('words.py stamps READER_VERSION on every overlay row and asks text_facts_todo for it', wordsStampsAndAsks(PY));
check(`the latest text_facts_todo (${todoFile || 'none'}) re-reads rows another reader version read`, todoRereadsOtherVersions(SQL));
check('facts-words.yml re-reads on a push to main that touches the reader, on 8 shards', workflowRereadsOnLesson(WF));

mustCatch('the overlay row losing its reader_version', !wordsStampsAndAsks(PY.replace('"reader_version": READER_VERSION', '')));
mustCatch('text_facts_todo called without the version', !wordsStampsAndAsks(PY.replace('"p_reader_version": READER_VERSION', '')));
mustCatch('the version hashing word_checker.py alone (normalize.py changes unseen)',
  !wordsStampsAndAsks(PY.replace('W.__file__, N.__file__', 'W.__file__,')));
mustCatch('the todo clause dropped', !todoRereadsOtherVersions(SQL.replace('$5 is not null and f.reader_version is distinct from $5', 'false')));
mustCatch('a second overload left behind (no drop of the old signature)',
  !todoRereadsOtherVersions(SQL.replace('drop function if exists public.text_facts_todo(text, bigint, integer, integer, integer)', '')));
mustCatch('the push trigger losing the reader path',
  !workflowRereadsOnLesson(WF.replace('      - scrapers/facts/word_checker.py\n', '')));
mustCatch('the push re-read falling back to one shard',
  !workflowRereadsOnLesson(WF.replace("(github.event_name == 'push' && '8')", "(github.event_name == 'push' && '1')")));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a reader lesson reaches the ads read before it, and the lag has an alarm');
