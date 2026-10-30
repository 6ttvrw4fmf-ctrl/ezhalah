// The two liveness CHECKING alarms skip DORMANT sites (2026-10-30).
//
// A dormant site's source is down at its own end; its listings are already out of search
// (production_ready = false) and it returns by itself on the first crawl that saves rows. On 2026-10-30
// five such sites (sadin, senan, snam, almuteb, moftah — 196 hidden listings) kept six P1 alarms open and
// read «0% checked», which hid the real gaps. This check fails if the newest definition of either detector
// stops skipping dormant sites, or if ops_platform_is_dormant() stops reading platform_registry.status.
//   node --experimental-strip-types scripts/verify-liveness-alarms-skip-dormant-sites.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
type Mig = { f: string; s: string };
const migs: Mig[] = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

const body = (ms: Mig[], fn: string): { f: string; b: string } | null => {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\s*\([^)]*\)[\s\S]*?as\s+(\$[a-z]*\$)([\s\S]*?)\1`, 'i');
  let out: { f: string; b: string } | null = null;
  for (const m of ms) { const x = re.exec(m.s); if (x) out = { f: m.f, b: x[2] }; }
  return out;
};

export function problems(ms: Mig[]): string[] {
  const p: string[] = [];
  const helper = body(ms, 'ops_platform_is_dormant');
  if (!helper) p.push('ops_platform_is_dormant() is never defined');
  else if (!/platform_registry/.test(helper.b) || !/status\s*=\s*'dormant'/.test(helper.b)) p.push(`${helper.f}: ops_platform_is_dormant() no longer reads platform_registry.status = 'dormant'`);
  const sla = body(ms, 'mon_detect_liveness_verification_sla');
  if (!sla) p.push('mon_detect_liveness_verification_sla() is never defined');
  else {
    if (!/if\s+public\.ops_platform_is_dormant\(r\.platform\)\s+then(?:\s*--[^\n]*)*\s+perform\s+public\.mon_resolve_key/i.test(sla.b)) p.push(`${sla.f}: the SLA alarm no longer skips (and clears) dormant sites`);
    if (!/mon_raise\('P1',\s*'liveness_verification_sla'/.test(sla.b)) p.push(`${sla.f}: the SLA alarm no longer raises for served sites`);
  }
  const sf = body(ms, 'mon_detect_liveness_checking_shortfall');
  if (!sf) p.push('mon_detect_liveness_checking_shortfall() is never defined');
  else {
    const skips = (sf.b.match(/not\s+public\.ops_platform_is_dormant\(s\.platform\)/g) ?? []).length;
    if (skips < 3) p.push(`${sf.f}: the shortfall alarm skips dormant sites in ${skips} of its 3 reads (fleet list, stalled loop, stalled resolver)`);
    if (!/mon_raise\('P1',\s*'liveness_checking_stalled'/.test(sf.b)) p.push(`${sf.f}: the stalled alarm no longer raises for served sites`);
  }
  return p;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const real = problems(migs);
check('both liveness checking alarms skip dormant sites and still raise for served ones', real.length === 0, real.join('; '));

// Each mutation edits the migration that holds THAT function's newest definition (a later file may only mention the
// helper without redefining the alarm — 20261030063149 does — so "the newest file that names it" is the wrong target).
const swapIn = (fn: string, from: string, to: string) => {
  const t = migs.find((m) => m.f === body(migs, fn)!.f)!;
  const s = t.s.replace(from, to);
  if (s === t.s) throw new Error(`mutation was a no-op in ${t.f}`);
  return migs.map((m) => (m.f === t.f ? { f: m.f, s } : m));
};
mustCatch('the SLA alarm grading dormant sites again', problems(swapIn('mon_detect_liveness_verification_sla', 'if public.ops_platform_is_dormant(r.platform) then', 'if false then')).length > 0);
mustCatch('the stalled loop grading dormant sites again', problems(swapIn('mon_detect_liveness_checking_shortfall', "where not s.injected and s.shape = 'STALLED' and not public.ops_platform_is_dormant(s.platform)\n  loop", "where not s.injected and s.shape = 'STALLED'\n  loop")).length > 0);
mustCatch('the helper reading the wrong status', problems(swapIn('ops_platform_is_dormant', "pr.status = 'dormant'", "pr.status = 'retired'")).length > 0);
mustCatch('a later redefinition without the skip', problems([...migs, { f: '29990101000000_x.sql', s: "create or replace function public.mon_detect_liveness_verification_sla() returns integer language plpgsql as $function$ begin perform public.mon_raise('P1', 'liveness_verification_sla', 'x','y','{}'); return 0; end $function$;" }]).length > 0);

if (failed) { console.error(`\n❌ verify-liveness-alarms-skip-dormant-sites: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-liveness-alarms-skip-dormant-sites: dead, hidden sites do not raise checking alarms; served sites still do.');
