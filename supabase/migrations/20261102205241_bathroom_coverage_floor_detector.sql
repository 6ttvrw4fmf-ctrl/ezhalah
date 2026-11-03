-- BATHROOM COVERAGE HAS A FLOOR PER SITE (backlog 1168: «add a detector with a minimum coverage per site that repairs
-- first»). The repair is the nightly word reader (facts-words) + the hourly sync merge; this watches that both keep
-- working. Floors = each site's apartment coverage on 2026-11-02 after the fill, minus 3 points (sites with ≥ 500 served
-- apartments). mon_detect_bathroom_coverage() raises P2 per site that falls under its floor, and P3 when ads whose own
-- words state a count (overlay) still show none in search more than a sync later (the merge stopped carrying them).
create table if not exists public.ops_bathroom_coverage_floor (
  platform text primary key,
  floor_pct numeric not null,
  measured_pct numeric not null,
  measured_at timestamptz not null default now()
);
alter table public.ops_bathroom_coverage_floor enable row level security;
revoke all on public.ops_bathroom_coverage_floor from anon, authenticated;

insert into public.ops_bathroom_coverage_floor (platform, floor_pct, measured_pct)
select platform, greatest(0, round(100.0 * count(*) filter (where bathrooms > 0) / count(*), 1) - 3),
       round(100.0 * count(*) filter (where bathrooms > 0) / count(*), 1)
  from public.search_listings_ar
 where production_ready and type_ar = 'شقة'
 group by platform having count(*) >= 500
on conflict (platform) do nothing;

create or replace function public.mon_detect_bathroom_coverage()
returns integer
language plpgsql
set search_path = public
as $$
declare n integer := 0; r record; v_unserved integer;
begin
  for r in
    select f.platform, f.floor_pct, c.pct
      from public.ops_bathroom_coverage_floor f
      join (select platform, round(100.0 * count(*) filter (where bathrooms > 0) / count(*), 1) pct
              from public.search_listings_ar where production_ready and type_ar = 'شقة' group by platform) c
        on c.platform = f.platform
  loop
    if r.pct < r.floor_pct then
      n := n + public.mon_raise('P2', 'bathroom_coverage_below_floor', r.platform, 'bathroom_coverage_below_floor:' || r.platform,
             jsonb_build_object('platform', r.platform, 'coverage_pct', r.pct, 'floor_pct', r.floor_pct,
                                'why', 'apartment bathroom coverage fell under its floor — check the facts-words reader and the sync merge'));
    else
      perform public.mon_resolve_key('bathroom_coverage_below_floor', 'bathroom_coverage_below_floor:' || r.platform);
    end if;
  end loop;

  select count(*) into v_unserved
    from public.listing_text_facts_af tf
    join public.search_listings_ar s on s.source_table = tf.source_table and s.listing_id = tf.listing_id
    join public.listing_text_facts lf on lf.source_table = tf.source_table and lf.listing_id = tf.listing_id
   where tf.bathrooms is not null and s.production_ready and s.bathrooms is null
     and s.type_ar <> 'عمارة' and lf.read_at < now() - interval '2 hours';
  if v_unserved > 100 then
    n := n + public.mon_raise('P3', 'bathroom_text_not_served', null, 'bathroom_text_not_served',
           jsonb_build_object('unserved', v_unserved, 'why', 'ads whose own words state a bathroom count still show none in search 2 h after the read — the sync merge (af_rule_b_num) stopped carrying them'));
  else
    perform public.mon_resolve_key('bathroom_text_not_served', 'bathroom_text_not_served');
  end if;
  return n;
end $$;
revoke all on function public.mon_detect_bathroom_coverage() from public, anon, authenticated;

do $mig$
declare
  d text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  needle constant text := 'fns text[] := array[';
begin
  if position('mon_detect_bathroom_coverage' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'mon_run_all_detectors: roster needle not found exactly once';
  end if;
  execute replace(d, needle, needle || E'\n    ''mon_detect_bathroom_coverage'',');
  if position('mon_detect_bathroom_coverage' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'mon_run_all_detectors: roster entry did not land';
  end if;
end
$mig$;
