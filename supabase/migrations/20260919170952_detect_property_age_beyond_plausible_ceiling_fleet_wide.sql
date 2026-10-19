-- A property_age past a plausible ceiling is a field-overrun artifact, fleet-wide.
--
-- WHY. On 2026-09-19 two ksaaqar rows stored property_age = 100. The source said «سنتين» (2) and
-- «سنة» (1); the spec block read «عمر العقار : سنتين حدود وأطوال العقار : 100 …» and the label
-- «حدود وأطوال العقار» was missing from the parser's list, so the age value ran on and swallowed
-- the 100 from the boundaries-and-lengths field. Repaired in 20260919073453. The parser fix is
-- locked by hermetic tests, but the repair-guard barrier's whole thesis is that a parser guard can
-- silently decay to a weaker rule and re-corrupt on the next sweep (the 2026-08-23 aqarmonthly
-- incident). This is the standing runtime watch that thesis demands.
--
-- It is a SHAPE detector and platform-agnostic: property_age in this inventory is "years since
-- built", and across all 96,885 aged active listings on 2026-09-19 the MAXIMUM was 47, with zero
-- above 60. A stored age past 80 is therefore not a real old building in this data — it is a number
-- that came from somewhere else on the page. The ceiling is 80: a wide margin over the real max of
-- 47, and it fires on the 100 the ksaaqar defect produced.
--
-- P1, on the daily roster: an implausible age only appears when a scraper is added or changed and
-- re-sweeps, so there is no sub-minute event needing the 300s fast lane.

create or replace function public.mon_detect_property_age_beyond_ceiling()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}'; q text := ''; t record;
  ceiling constant int := 80;
begin
  for t in select table_name from information_schema.tables ti
            where table_schema = 'public' and table_name ~ '_(residential|commercial)_listings$'
              and exists (select 1 from information_schema.columns c
                          where c.table_schema = 'public' and c.table_name = ti.table_name
                            and c.column_name = 'property_age')
            order by table_name
  loop
    q := q || format(
      'select %L::text src, id, property_age from public.%I where property_age is not null and active union all ',
      t.table_name, t.table_name);
  end loop;
  if q = '' then
    raise exception 'no listing tables with property_age found - refusing to report clean from an empty scan';
  end if;

  create temp table if not exists _age_ceiling (src text, id bigint, property_age numeric) on commit drop;
  execute 'insert into _age_ceiling ' || left(q, length(q) - 11);

  for rec in
    select split_part(src, '_', 1) as platform, src, count(*) as offenders,
           max(property_age) as worst
      from _age_ceiling
     where property_age > ceiling
     group by 1, 2
     order by 1, 2
  loop
    live_keys := live_keys || ('property_age_beyond_ceiling:' || rec.src);
    n := n + public.mon_raise('P1', 'property_age_beyond_ceiling', rec.platform,
      'property_age_beyond_ceiling:' || rec.src,
      jsonb_build_object(
        'why', rec.src || ' has ' || rec.offenders || ' active listing(s) with property_age above '
             || ceiling || ' (worst ' || rec.worst || '). Real "years since built" in this fleet '
             || 'tops out at 47; a value this high is almost always a parse artifact — the age field '
             || 'ran on and swallowed a number from an adjacent spec-block field (the ksaaqar '
             || '«حدود وأطوال العقار» overrun, 2026-09-19).',
        'expected', 'no active property_age above ' || ceiling,
        'adjudicate', 'Read one offending listing live. If the source says a small age and a nearby '
             || 'field holds the stored number, the parser is missing a label between them — add it '
             || 'so the age value terminates, then NULL the artifact (the next sweep rewrites the '
             || 'true age, which is non-NULL). Never clamp the value to the ceiling. If the source '
             || 'genuinely states this age, widen nothing here — record a waiver for that row.',
        'source_table', rec.src, 'offending_rows', rec.offenders, 'worst_age', rec.worst,
        'ceiling', ceiling));
  end loop;

  perform public.mon_resolve_stale_keys('property_age_beyond_ceiling', live_keys);
  return n;
end $function$;

-- Roster into the daily sweep, refusing rather than silently no-opping if the anchor moved.
do $$
declare def text;
begin
  select pg_get_functiondef(oid) into def
    from pg_proc where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace;
  if def is null then
    raise exception 'mon_run_all_detectors() not found - cannot roster the new detector';
  end if;
  if position('mon_detect_property_age_beyond_ceiling' in def) > 0 then
    raise notice 'already rostered'; return;
  end if;
  if position('''mon_detect_price_borrowed_from_chrome''' in def) = 0 then
    raise exception 'roster anchor mon_detect_price_borrowed_from_chrome not found - refusing to splice blind';
  end if;
  def := replace(def, '''mon_detect_price_borrowed_from_chrome''',
                      '''mon_detect_price_borrowed_from_chrome'', ''mon_detect_property_age_beyond_ceiling''');
  execute def;
end $$;

do $$
begin
  if position('mon_detect_property_age_beyond_ceiling' in
      (select pg_get_functiondef(oid) from pg_proc
        where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace)) = 0 then
    raise exception 'ROSTER FAILED: the detector is not reachable from mon_run_all_detectors()';
  end if;
  raise notice 'rostered OK';
end $$;
