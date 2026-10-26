-- Companion to 20261025082809 (haraj «اكثر من عشر سنوات» NULL → 10): a live haraj ad whose own REGA licence states
-- an age never shows none.
--
-- The repair fixed 1,052 rows and the parser fix stops new ones, but a one-shot repair is a claim that decays unless
-- something watches it. This watches OUR claim: an ACTIVE haraj row whose stored licence «عمر العقار» is non-empty
-- while property_age is NULL — the exact state 983 live ads sat in until today (the source stated an age, the
-- Advanced Filter could not see it). P2, hourly; 0 rows at creation. Never fix by inventing an age: read the licence
-- value through scrapers/haraj/parse.age_of, and if it is genuinely unreadable, say so in the alert.
create or replace function public.mon_detect_haraj_stated_age_not_stored()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_open boolean; r int := 0;
begin
  select (select count(*) from public.haraj_residential_listings
           where active and property_age is null and nullif(btrim(additional_info->'rega_facts'->>'عمر العقار'), '') is not null)
       + (select count(*) from public.haraj_commercial_listings
           where active and property_age is null and nullif(btrim(additional_info->'rega_facts'->>'عمر العقار'), '') is not null)
    into v_rows;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'haraj_stated_age_not_stored' and resolved_at is null);
  if v_rows = 0 then
    if v_open then perform public.mon_resolve('haraj_stated_age_not_stored', 'haraj'); end if;
  elsif not v_open then
    r := public.mon_raise('P2', 'haraj_stated_age_not_stored', 'haraj', 'haraj_stated_age_not_stored',
      jsonb_build_object('rows', v_rows,
        'values', (select jsonb_agg(jsonb_build_object('licence_age', v, 'rows', n) order by n desc)
                     from (select additional_info->'rega_facts'->>'عمر العقار' v, count(*) n
                             from (select additional_info from public.haraj_residential_listings
                                    where active and property_age is null and nullif(btrim(additional_info->'rega_facts'->>'عمر العقار'), '') is not null
                                   union all
                                   select additional_info from public.haraj_commercial_listings
                                    where active and property_age is null and nullif(btrim(additional_info->'rega_facts'->>'عمر العقار'), '') is not null) u
                            group by 1 limit 20) z),
        'why', 'A live haraj ad''s own REGA licence states «عمر العقار» but we store no age, so the Advanced Filter cannot find it '
               || '(the 2026-10-25 class: «اكثر من عشر سنوات» was dropped to NULL). Teach scrapers/haraj/parse.age_of the value '
               || '(REGA''s open top bucket is 10: the AF clause reads a haraj 10 as ≥ 10) and backfill from the stored licence value. '
               || 'Never invent an age for a value that is not a number of years.'));
  end if;
  return r;
end $function$;
revoke all on function public.mon_detect_haraj_stated_age_not_stored() from public, anon, authenticated;
grant execute on function public.mon_detect_haraj_stated_age_not_stored() to service_role;

-- Roster (an unrostered detector is decoration). Needle-edit of the LIVE body, read in this same step.
do $roster$
declare d text; anchor text := '''mon_detect_district_carries_ad_block_text'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_haraj_stated_age_not_stored''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_haraj_stated_age_not_stored'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_haraj_stated_age_not_stored''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF: a planted «stated but NULL» row is counted, inside a rolled-back sub-transaction; 0 today; not orphaned.
do $proof$
declare base bigint; planted bigint; lid bigint;
  q constant text := $q$select (select count(*) from public.haraj_residential_listings
           where active and property_age is null and nullif(btrim(additional_info->'rega_facts'->>'عمر العقار'), '') is not null)
       + (select count(*) from public.haraj_commercial_listings
           where active and property_age is null and nullif(btrim(additional_info->'rega_facts'->>'عمر العقار'), '') is not null)$q$;
begin
  execute q into base;
  if base <> 0 then raise exception 'PROOF: % live haraj ads still state an age we do not store — the repair did not hold', base; end if;
  select id into lid from public.haraj_residential_listings
   where active and property_age = 10 and additional_info->'rega_facts'->>'عمر العقار' = 'اكثر من عشر سنوات' limit 1;
  if lid is null then raise exception 'PROOF: no backfilled row to plant on'; end if;
  begin
    update public.haraj_residential_listings set property_age = null where id = lid;
    execute q into planted;
    if planted <> base + 1 then raise exception 'PROOF: the planted NULL age was not counted (% vs %)', planted, base; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select property_age from public.haraj_residential_listings where id = lid) is distinct from 10 then
    raise exception 'PROOF: the planted row was not rolled back';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_haraj_stated_age_not_stored') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: 0 live haraj ads state an unstored age; a planted one is caught; rostered';
end $proof$;

-- The repair joins the registry that keeps re-verifying it.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values ('20261025082809', 'haraj_rega_open_age_is_ten_plus_backfill',
  'No active haraj ad (residential or commercial) whose stored REGA licence «عمر العقار» is non-empty has a NULL property_age. '
  || 'REGA''s open top bucket «اكثر من عشر سنوات» is stored as 10, which the AF clause reads as ≥ 10 with no upper end (20261025072931).',
  'mon_detect_haraj_stated_age_not_stored', 'quality-repair session 2026-10-25 (author of the repair)', now(), 'holds',
  jsonb_build_object('rows_repaired', 1052, 'active_rows_now_10_plus', 984,
    'listing_age_resolved_haraj_10_plus', '1,159 → 2,143', 'listing_age_resolved_haraj_under_10', '6,143 unchanged',
    'forward_fix', 'scrapers/haraj/parse.age_of, executed by scripts/verify-open-age-bucket-never-answers-up-to.ts (red on the pre-fix parser)',
    'detector_on_roster', true))
on conflict (repair_version) do nothing;
