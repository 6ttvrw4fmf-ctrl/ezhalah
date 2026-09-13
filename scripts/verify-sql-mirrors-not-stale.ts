// Regression guard (2026-08-08) for sql/mirrors/ drifting away from the live production objects.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// sql/mirrors/*.sql must stay byte-exact with the live object. Nothing enforced that, and on
// 2026-08-08 senior audit run #7 found TWO of the three mirrors stale at once:
//
//   * aqar_parse.sql — 3 days behind. Migration 20260805190111 taught production to honour an
//     explicit «غير مفروش», but the mirror still showed the old
//     `case when txt ~ 'مؤثث|مفروش' then true else null end`, i.e. it claimed aqar can never
//     record "not furnished".
//   * listing_native_location_v1.sql — missing the ENTIRE `satel` native branch (both UNION ALL
//     arms) and still carrying a superseded pg_get_viewdef rendering: 11,245 chars vs 13,385 live.
//
// Neither had any user impact — the live objects were correct — but a mirror is what an agent
// session READS to reason about the parser and the location pipeline, so a stale one is how a
// session talks itself into "fixing" something that is not broken, or misses something that is.
//
// This runs offline (no DB, no network) and enforces two properties:
//   (A) SELF-CONSISTENCY — each mirror records the md5 of the production text it was verified
//       against, and that md5 must still match the file's own body. You cannot edit a mirror body
//       without re-deriving the md5, and the only honest way to derive it is from production.
//   (B) NOT-OLDER-THAN-PRODUCTION — the mirror's newest `Refreshed`/`Re-verified` date must be at
//       least the date of the newest migration that mentions the object. Migrations are the thing
//       that changes these objects, so a mirror older than the last migration touching it is
//       stale-by-construction. This is what would have caught aqar_parse on 08-05.
//
// (B) matches on any MENTION, not just a literal CREATE OR REPLACE, because several migrations
// needle-edit a function body via regexp_replace — 20260805190111 changed aqar_parse without ever
// spelling out `CREATE OR REPLACE FUNCTION public.aqar_parse`, which is precisely why a
// CREATE-only heuristic would have missed the real drift.
//
// …BUT A COMMENT IS NOT A CHANGE (2026-09-13, routine #5). "Any mention" was reading the migration
// file RAW, so a migration that merely NAMES an object while explaining itself marked that object's
// mirror stale. Measured: 20260913111514 edits only `af_field_registry` rows and mentions
// `af_eligibility_clause` twice, in prose, to say where an undeclared predicate lives — and
// af_eligibility_clause.sql (verified 2026-09-06, md5 unchanged, production untouched) went RED,
// failing the REQUIRED npm test on a PR that could not have changed it. That is the hermetic suite
// failing an unrelated diff, and the remedy it invites — re-dating a mirror nobody re-verified — is
// worse than the false positive.
//
// So (B) now asks the same question the repo already asks of a migration elsewhere: does it name the
// object in EXECUTED SQL? (`isGuarded`, scripts/lib/repairClassifier.ts — "a comment does not
// count".) Nothing the rule was built for is lost: a regexp_replace needle-edit names the object
// inside an executed string literal, and a CREATE/ALTER/DROP names it in executed DDL. Only prose
// stops counting. Mutation-proven at the bottom of this file.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { stripSqlComments } from './lib/repairClassifier.ts';

const MIRRORS_DIR = 'sql/mirrors';
const MIGRATIONS_DIR = 'supabase/migrations';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-sql-mirrors-not-stale: every sql/mirrors file must carry the md5 of the');
console.log('  production text it mirrors, and must not predate the last migration touching it.');

const mirrors = readdirSync(MIRRORS_DIR).filter((f) => f.endsWith('.sql'));
check('sql/mirrors contains at least one mirror', mirrors.length > 0);

// version prefix (YYYYMMDDHHMMSS) -> YYYY-MM-DD, for every migration, once.
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({
    file: f,
    date: f.slice(0, 8),
    // EXECUTED SQL only — see the note on (B) above. The raw text is kept so a future rule that
    // genuinely needs prose has it, and so the mutation proofs can show the two differ.
    raw: readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'),
    body: stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')),
  }));

for (const file of mirrors) {
  const objectName = file.replace(/\.sql$/, '');
  const raw = readFileSync(`${MIRRORS_DIR}/${file}`, 'utf8');

  // Header = the leading run of comment/blank lines; body = everything after it.
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('--') || !lines[i].trim())) i++;
  const header = lines.slice(0, i).join('\n');
  let body = lines.slice(i).join('\n');
  if (body.endsWith('\n')) body = body.slice(0, -1); // the file's own trailing newline

  console.log(`  ${file}:`);

  // ── (A) self-consistency ─────────────────────────────────────────────────────────────────────
  const recorded = header.match(/md5[^:]*:\s*([0-9a-f]{32})/i);
  check(`    header records a verified md5`, !!recorded);
  if (recorded) {
    // pg_get_functiondef() ends with a newline, pg_get_viewdef() does not — accept either, so the
    // recorded digest is always the digest of the REAL production text for that object kind.
    const bare = createHash('md5').update(body).digest('hex');
    const withNl = createHash('md5').update(`${body}\n`).digest('hex');
    check(
      `    recorded md5 still matches the file body`,
      recorded[1].toLowerCase() === bare || recorded[1].toLowerCase() === withNl,
      `header=${recorded[1].slice(0, 8)}… body=${bare.slice(0, 8)}…/${withNl.slice(0, 8)}…`,
    );
  }

  // ── (B) not older than the last migration that touched the object ────────────────────────────
  const dates = [...header.matchAll(/(?:Refreshed|Re-verified)\s+(\d{4})-(\d{2})-(\d{2})/g)].map(
    (m) => `${m[1]}${m[2]}${m[3]}`,
  );
  check(`    header carries a Refreshed/Re-verified date`, dates.length > 0);

  const touching = migrations.filter((m) => new RegExp(`\\b${objectName}\\b`).test(m.body));
  if (dates.length > 0 && touching.length > 0) {
    const mirrorDate = dates.sort().at(-1)!;
    const newest = touching.map((m) => m.date).sort().at(-1)!;
    const newestFile = touching.filter((m) => m.date === newest).map((m) => m.file).sort().at(-1)!;
    const fmt = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    check(
      `    not older than the newest migration touching it`,
      mirrorDate >= newest,
      `mirror ${fmt(mirrorDate)} vs ${newestFile} (${fmt(newest)})`,
    );
  } else if (dates.length > 0) {
    console.log(`    (no migration mentions ${objectName} — date check not applicable)`);
  }
}

// ── MUTATION PROOFS for (B)'s "a comment is not a change" rule (2026-09-13) ────────────────────
// EXECUTED against the real predicate, not asserted about it. Each case is a migration body shaped
// like one the tree actually contains; `touches()` is the exact expression the loop above uses.
console.log('\n  mutation proof — (B) counts EXECUTED SQL and ignores prose\n');
const touches = (obj: string, sql: string) => new RegExp(`\\b${obj}\\b`).test(stripSqlComments(sql));
const OBJ = 'aqar_parse';

check('    a CREATE OR REPLACE of the object still counts',
  touches(OBJ, `create or replace function public.${OBJ}() returns void as $$ begin end $$;`));
check('    a regexp_replace needle-edit still counts (the 20260805190111 shape this rule exists for)',
  touches(OBJ, `do $$ begin\n  perform 1;\n  tpl := regexp_replace(prosrc, 'x', 'y');\nend $$;\n-- touches ${OBJ}\nselect pg_get_functiondef('public.${OBJ}()'::regprocedure);`));
check('    a DROP still counts', touches(OBJ, `drop function if exists public.${OBJ}();`));
check('    the object named inside an executed STRING LITERAL still counts',
  touches(OBJ, `do $$ begin execute 'alter function public.${OBJ}() owner to postgres'; end $$;`));
check('    a line comment that only MENTIONS the object does NOT count (the false positive)',
  !touches(OBJ, `-- see public.${OBJ} for where the parse happens\nupdate public.af_field_registry set ui_exposed = true;`));
check('    a block comment that only mentions it does NOT count',
  !touches(OBJ, `/* background: public.${OBJ} owns this\n   and nothing here changes it */\nupdate public.af_field_registry set ui_exposed = true;`));
check('    …and the RAW text of that same migration DOES mention it — so the two really differ, '
  + 'i.e. the proof above is not passing because the string was empty',
  /\baqar_parse\b/.test(`-- see public.${OBJ} for where the parse happens\nupdate public.af_field_registry set ui_exposed = true;`));
check('    a migration that mentions nothing at all does not count',
  !touches(OBJ, 'update public.af_field_registry set ui_exposed = true;'));

console.log('');
if (failures > 0) {
  console.error(`❌ verify-sql-mirrors-not-stale: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-sql-mirrors-not-stale: all checks passed.');
