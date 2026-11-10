// A REPAIR MUST BE ASKED ABOUT ITS REGISTRY ROW BEFORE IT IS APPLIED, NOT PAGED ABOUT IT AFTER.
//
// repair-enrollment-guard.yml paged `seam_check_failed` seven times in seven days (2026-11-03 → 11-10):
// a session applied a listing repair, nobody wrote its ops_repair_guarantee_registry row, and the
// first the author heard of the rule was the page. check-migration-before-apply.ts now refuses a
// repair until the author promises the row. This EXECUTES that tool on real files — exit codes, not
// source text — so the gate cannot be removed, or turned into a print, while this stays green.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOOL = join(import.meta.dirname, 'check-migration-before-apply.ts');
const dir = mkdtempSync(join(tmpdir(), 'repair-gate-'));
type Ran = { code: number | null; out: string };
const exec = (file: string, ...args: string[]): Ran => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', file, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const tool = (...args: string[]): Ran => exec(TOOL, ...args);
let n = 0;
const run = (sql: string, ...flags: string[]): Ran => {
  const f = join(dir, `candidate-${n++}.sql`);
  writeFileSync(f, sql);
  return tool(f, ...flags);
};

const REPAIR = `update public.dealapp_residential_listings set active = false where id = 22045812 and active;`;
const LOOP = `do $$ declare t text; begin foreach t in array array['vmksa_residential'] loop
  execute format('update public.%I_listings set active = false where id = 1', t); end loop; end $$;`;
const PLAIN = `create or replace function public.f() returns int language sql as $f$ select 1 $f$;`;

const cases: [string, number, Ran, RegExp?][] = [
  ['a listing repair with no promise is refused', 1, run(REPAIR), /ops_repair_guarantee_registry/],
  ['a looped (dynamic) listing repair is refused', 1, run(LOOP), /ops_repair_guarantee_registry/],
  ['the same repair, enrolment promised, is allowed', 0, run(REPAIR, '--repair-will-be-enrolled')],
  ['the unattended path is told, not blocked', 0, run(REPAIR, '--repair-warn-only'), /REPAIR/],
  ['a migration that touches no listing row is not asked', 0, run(PLAIN)],
  ['its own self-test passes', 0, tool('--self-test')],
];
let bad = 0;
for (const [name, want, got, must] of cases) {
  const ok = got.code === want && (!must || must.test(got.out));
  if (!ok) { bad++; console.error(`  FAIL  ${name} — exit ${got.code}, wanted ${want}\n${got.out.slice(0, 400)}`); }
  else console.log(`  PASS  ${name}`);
}

// MUTATION PROOF: the same tool with its refusal turned into a warning must be CAUGHT — the first case
// above (exit 1 wanted) has to go red on it. The mutant is a real copy, executed, then removed.
const mustCatch = (what: string, caught: boolean) => {
  if (!caught) bad++;
  console.log(`  ${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
const src = readFileSync(TOOL, 'utf8');
const mutated = src.replace("? 'warn' : 'refuse'", "? 'warn' : 'warn'");
const MUTANT = join(import.meta.dirname, `.repair-gate-mutant-${process.pid}.ts`);
try {
  writeFileSync(MUTANT, mutated);
  const f = join(dir, 'mutant-candidate.sql');
  writeFileSync(f, REPAIR);
  mustCatch('a tool that only warns about an unpromised repair', mutated !== src && exec(MUTANT, f).code !== 1);
} finally { rmSync(MUTANT, { force: true }); }

if (bad) { console.error(`\n❌ ${bad} case(s) failed`); process.exit(1); }
console.log('\n✓ a repair is asked for its registry row before the apply');
