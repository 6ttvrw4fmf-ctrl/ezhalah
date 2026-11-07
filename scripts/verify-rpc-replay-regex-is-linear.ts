// The rpcReplay declaration readers must stay linear on declaration-SHAPED text that is not a declaration.
//
// 2026-11-07: migration 20261107213742 carries `position('k constant text := ''bedrooms_not_captured_fleet''' in src)`.
// exprDeclRe's `(seg \s* (\|\|)?)+` let `bedrooms_not_captured_fleet` split into exponentially many identifier runs
// before failing on the missing `;`, and verify-nonprice-price-monitor.ts was killed at CI's 600 s cap on the
// mirror PR. This check EXECUTES the real replay over that exact text (and a longer one) under a time budget,
// and proves the readers still read a genuine `||` declaration.
//
// Run: node --experimental-strip-types scripts/verify-rpc-replay-regex-is-linear.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replayFunction } from './lib/rpcReplay.ts';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpcreplay-'));
fs.writeFileSync(path.join(dir, '20990101000000_def.sql'),
  "create or replace function public.f_lin() returns int language sql as $$ select 1 /*NEEDLE*/ $$;\n");
const trap = "do $$ begin if position('k constant text := ''" + 'a_b_c_d_e_f_g_h_i_j_k_l_m_n_o_p_q_r_s_t_u_v_w_x_y_z_'.repeat(4) +
  "''' in src) = 0 then raise notice 'x'; end if; end $$;\n";
// The trap sits in the SAME migration as the patch, as in 20261107213742: that is the file the readers scan.
fs.writeFileSync(path.join(dir, '20990101000002_patch.sql'),
  "do $$ declare n text := E'/*NEEDLE*/'; r text := n || E' + 1'; s text; begin s := replace(s, n, r); " +
  "-- public.f_lin pg_get_functiondef execute\nend $$;\n" + trap);
// …and the inline-argument shape that migration really uses, with an occurrence probe that must NOT patch.
fs.writeFileSync(path.join(dir, '20990101000003_inline.sql'),
  "do $$ declare src text; out_def text; begin src := pg_get_functiondef('public.f_lin()'::regprocedure);\n" +
  "out_def := replace(src, E'+ 1 $$', E'+ 1 ' || E'+ 2 $$');\n" +
  "if (length(out_def) - length(replace(out_def, '+ 2', ''))) / 3 <> 1 then raise exception 'x'; end if;\n" +
  "execute out_def; end $$;\n");

// …and ORDER across arms: an inline patch that CREATES the anchor a later variable-pair patch needs, in one file.
fs.writeFileSync(path.join(dir, '20990101000004_order.sql'),
  "do $$ declare n2 text := E'+ Q $$'; r2 text := E'+ 3 $$'; src text; out_def text; begin\n" +
  "src := pg_get_functiondef('public.f_lin()'::regprocedure);\n" +
  "out_def := replace(src, E'+ 2 $$', E'+ 2 + Q $$');\n" +
  "out_def := replace(out_def, n2, r2);\n" +
  "execute out_def; end $$;\n");

// CodeRabbit on #11148, three more ways replay order could go wrong, one fixture each:
// (6) also carries a commented-out replace(), which SQL never runs; (6) a LATER duplicate of an inline pair (here an occurrence
// probe) must not displace the earlier executing one; (7) a patch TABLE runs where its loop is, not where it is
// declared, so an inline patch between the two can create a row's anchor.
fs.writeFileSync(path.join(dir, '20990101000006_dedup.sql'),
  "do $$ declare n6 text := E'+ R $$'; r6 text := E'+ S $$'; a6 text := E'+ 3 $$'; b6 text := E'+ 3 + R $$';\n" +
  "src text; out_def text; k int; begin src := pg_get_functiondef('public.f_lin()'::regprocedure);\n" +
  "out_def := replace(src, E'+ 3 $$', E'+ 3 + R $$');\n" +
  "out_def := replace(out_def, n6, r6);\n" +
  "-- out_def := replace(out_def, E'+ 3 $$', E'+ 3 + BAD $$');\n" +
  "k := length(replace(out_def, a6, b6));\n" +
  "execute out_def; end $$;\n");
fs.writeFileSync(path.join(dir, '20990101000007_table.sql'),
  "do $$ declare ed text[][] := array[['+ U $$', '+ V $$']]; src text; out_def text; begin\n" +
  "src := pg_get_functiondef('public.f_lin()'::regprocedure);\n" +
  "-- ed holds the edits; ed is applied below\n" +
  "out_def := replace(src, E'+ S $$', E'+ S + U $$');\n" +
  "for i in 1..array_length(ed, 1) loop out_def := replace(out_def, ed[i][1], ed[i][2]); end loop;\n" +
  "execute out_def; end $$;\n");

// One predicate per claim, used by the real assertion AND by its mutation proof below.
const inlinePatched = (b: string | null) => !!b && b.includes('+ 1 + 2');
const probeSurvived = (b: string | null) => !!b && b.includes('+ 2');
const orderKept = (b: string | null) => !!b && b.includes('+ 1 + 2 + 3');
const commentIgnored = (b: string | null) => !!b && !b.includes('BAD');
const dedupAfterSort = (b: string | null) => !!b && b.includes('+ 3 + S');
const tableAtUse = (b: string | null) => !!b && b.includes('+ S + V $$');

const t0 = Date.now();
const out = replayFunction(dir, 'f_lin');
const ms = Date.now() - t0;
ok(ms < 5000, `replay over a declaration-shaped non-declaration finishes fast (${ms} ms)`);
ok(!!out.body && out.body.includes('/*NEEDLE*/ + 1'), 'a genuine `||` E-string declaration is still read and replayed');
ok(inlinePatched(out.body), 'an assigned inline `replace(src, E\'…\', E\'…\' || E\'…\')` is replayed');
ok(probeSurvived(out.body), 'the occurrence probe `length(replace(x, \'+ 2\', \'\'))` is NOT read as a patch');
ok(orderKept(out.body), `patches apply in SQL order across arms (${JSON.stringify(out.body?.match(/\+ 1[^$]*\$\$/)?.[0])})`);
ok(commentIgnored(out.body), 'a commented-out replace() is not applied');
ok(dedupAfterSort(out.body), 'a later duplicate of an inline pair does not displace the earlier executing one');
ok(tableAtUse(out.body), `a patch table applies where its loop runs (${JSON.stringify(out.body?.match(/\+ 1[^$]*\$\$/)?.[0])})`);
ok(out.unresolved.length === 0, `nothing left unresolved (${JSON.stringify(out.unresolved)})`);

// Mutation proofs: each predicate above, applied to a deliberately broken input, must say "broken".
const mustCatch = (label: string, caught: boolean) => ok(caught, `(mutation) catches ${label}`);
mustCatch('a replay that skipped the inline patch', !inlinePatched('select 1 /*NEEDLE*/ + 1 $$'));
mustCatch('a replay that applied the later patch first and dropped it', !orderKept('select 1 /*NEEDLE*/ + 1 + 2 + Q $$'));
mustCatch('a replay that applied a commented-out patch', !commentIgnored('select 1 + 3 + BAD $$'));
mustCatch('a replay whose later duplicate displaced the inline pair', !dedupAfterSort('select 1 + 3 + R $$'));
mustCatch('a replay that ran the table at its declaration', !tableAtUse('select 1 + S + U $$'));
mustCatch('a replay that read the occurrence probe as a patch (the needle deleted)', !probeSurvived('select 1 /*NEEDLE*/ + 1  $$'));
// The hang itself is proven by running this file against the OLD rpcReplay.ts: it does not finish
// (killed at a 20 s timeout, exit 124, 2026-11-07); CI killed the real barrier at 600 s.

fs.rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`\n❌ rpc-replay-regex-is-linear: ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ rpc-replay-regex-is-linear: passed.');
