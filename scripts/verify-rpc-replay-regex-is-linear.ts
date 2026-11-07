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

const t0 = Date.now();
const out = replayFunction(dir, 'f_lin');
const ms = Date.now() - t0;
ok(ms < 5000, `replay over a declaration-shaped non-declaration finishes fast (${ms} ms)`);
ok(!!out.body && out.body.includes('/*NEEDLE*/ + 1'), 'a genuine `||` E-string declaration is still read and replayed');
ok(!!out.body && out.body.includes('+ 1 + 2 $$'), 'an assigned inline `replace(src, E\'…\', E\'…\' || E\'…\')` is replayed');
ok(!!out.body && out.body.includes('+ 2'), 'the occurrence probe `length(replace(x, \'+ 2\', \'\'))` is NOT read as a patch');
ok(out.unresolved.length === 0, `nothing left unresolved (${JSON.stringify(out.unresolved)})`);

fs.rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`\n❌ rpc-replay-regex-is-linear: ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ rpc-replay-regex-is-linear: passed.');
