// P1 SPEED (owner 2026-10-23): the six AF RPCs must plan EACH call with its own values.
//
// As LANGUAGE sql they were planned once with unknown arguments (PostgREST passes them through
// json_to_record), so every «p_cities is null or …» branch stayed in the plan and every call — a
// one-district count included — seq-scanned all of search_listings_ar. location_search_candidates_ar
// alone: 459,896 calls at a 1,305 ms mean. Migration *_af_rpcs_plan_each_call_with_its_own_values.sql
// re-renders them as plpgsql + plan_cache_mode = force_custom_plan through the template, and puts a
// CHECK constraint on af_rpc_templates so a template without that header cannot be saved again.
// This file guards the migration's shape and that no later migration takes the guard away.
//   node --experimental-strip-types scripts/verify-af-rpcs-plan-each-call.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const file = files.filter((f) => /^\d{14}_af_rpcs_plan_each_call_with_its_own_values\.sql$/.test(f)).at(-1);
if (!file) { console.log('FAIL  migration *_af_rpcs_plan_each_call_with_its_own_values.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const later = files.filter((f) => f > file).map((f) => ({ f, s: readFileSync(join(dir, f), 'utf8') }));

const HEADER = String.raw`E' LANGUAGE plpgsql\n STABLE\n SET plan_cache_mode TO ''force_custom_plan''\nAS $function$\n#variable_conflict use_column\nbegin\n'`;

function problems(s: string): string[] {
  const fail: string[] = [];
  if (!s.includes(`hdr_new constant text := ${HEADER};`)) fail.push('the template header is not plpgsql + force_custom_plan + #variable_conflict use_column');
  if (!/add constraint af_rpc_templates_plan_each_call\s+check \(position\(E' LANGUAGE plpgsql\\n STABLE\\n SET plan_cache_mode TO ''force_custom_plan''\\nAS \$function\$\\n#variable_conflict use_column\\nbegin\\n' in template\) > 0\)/.test(s)) fail.push('no CHECK constraint keeps the header in every template');
  if (!/update public\.af_rpc_templates set template = tpl/.test(s)) fail.push('the template is not the thing being edited');
  if (!/perform public\.rebuild_af_filter_rpcs\(\);/.test(s)) fail.push('the RPCs are not re-rendered through rebuild_af_filter_rpcs()');
  if (/create\s+or\s+replace\s+function/i.test(s)) fail.push('hand-edits an AF RPC (forbidden — go through the template)');
  if (!/if n <> 1 then/.test(s)) fail.push('no fail-closed header count');
  if (!/l\.lanname = 'plpgsql' and p\.proconfig @> array\['plan_cache_mode=force_custom_plan'\]/.test(s)) fail.push('no apply-time assertion that every RPC came back plpgsql + force_custom_plan');
  if (!/if after_probe is distinct from before_probe then/.test(s)) fail.push('no apply-time proof that the results are unchanged');
  return fail;
}

function undone(ms: { f: string; s: string }[]): string[] {
  return ms.filter(({ s }) => /drop\s+constraint\s+(if\s+exists\s+)?af_rpc_templates_plan_each_call/i.test(s)
    || /af_rpc_templates[\s\S]*LANGUAGE sql\\n STABLE\\nAS \$function\$/.test(s) && /set template\s*=/.test(s) && !/LANGUAGE plpgsql/.test(s))
    .map(({ f }) => f);
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const p = problems(sql);
check('the AF RPCs are re-rendered to plan each call with its own values, guarded by a table constraint', p.length === 0, p.join('; '));
const u = undone(later);
check('no later migration drops the guard or puts LANGUAGE sql back into a template', u.length === 0, u.join(', '));

mustCatch('the generic plan back (force_custom_plan → auto)', problems(sql.replaceAll('force_custom_plan', 'auto')).length > 0);
mustCatch('names resolving to RETURNS TABLE variables (use_column removed)', problems(sql.replaceAll('#variable_conflict use_column\\n', '')).length > 0);
mustCatch('the CHECK constraint removed', problems(sql.replace('add constraint af_rpc_templates_plan_each_call', 'add constraint some_other_name')).length > 0);
mustCatch('no before/after result proof', problems(sql.replace('if after_probe is distinct from before_probe then', 'if false then')).length > 0);
mustCatch('a hand-edit instead of the template', problems(sql + '\ncreate or replace function public.top_cities_by_deal_ar() returns void language sql as $$ $$;').length > 0);
mustCatch('a later migration dropping the guard', undone([{ f: '29990101000000_x.sql', s: 'alter table public.af_rpc_templates drop constraint af_rpc_templates_plan_each_call;' }]).length > 0);
mustCatch('a later migration writing LANGUAGE sql back into a template',
  undone([{ f: '29990101000000_y.sql', s: "update public.af_rpc_templates set template = replace(template, x, E' LANGUAGE sql\\n STABLE\\nAS $function$');" }]).length > 0);

if (failed) { console.error(`\n❌ verify-af-rpcs-plan-each-call: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-af-rpcs-plan-each-call: every AF RPC is planned with its own values.');
