-- «إقامات قصيرة» (SHORT STAYS) IS THE RENT POOL FOR GATHERN + AQAR MONTHLY ONLY; EVERY OTHER PER-MONTH RENT IS
-- YEARLY AT ×12 (owner 2026-10-25). docs/ARCHITECTURE.md §20 carries the rule. src/lib/rentPool.ts is the app's
-- half (the card prints «/سنوياً» and keeps the site's own words: «السعر المعلن 3,000 شهرياً»).
-- scripts/verify-short-stays-pool.ts pins that both halves name the same two platforms.
--
-- WHAT CHANGES. search_listings_ar.rent_period_ar is the POOL a listing searches in. Until today it copied the
-- site's word (PERIOD = SOURCE): 3,974 per-month ads from Haraj, DealApp, Aqarcity, Wasalt, Muktamel, Muhaysini …
-- sat under «شهري» beside Gathern's and Aqar Monthly's stay-length units. The owner's rule: in Saudi Arabia every
-- normal rent contract is yearly; «شهري» becomes «إقامات قصيرة» = the two stay-length platforms, and a per-month
-- figure on any other site is a yearly listing. price_annual is ALREADY stored as monthly×12 by every scraper, so
-- nothing is recomputed. The source tables and their rent_period are NOT touched: the site's own word stays the
-- site's own word (that is what the card prints under the yearly price).
--
-- BORN OFF. ops_feature_flags.short_stays_pool starts DISABLED so this can apply before the app ships. While off,
-- rent_pool_ar() returns exactly the pre-2026-10-25 mapping and the drift detector is quiet. To turn it on:
--   update public.ops_feature_flags set enabled = true, reason = '<why>', changed_at = now()
--    where name = 'short_stays_pool';
-- then the next hourly sync_search_listings_ar() run (:22) moves the rows. Same statement with false = the off switch.
--
-- SELF-MIRROR. mon_detect_search_index_diverges_from_sync_source() carries a COPY of the sync's period expression and
-- raises P1 search_index_oracle_stale when the copy no longer appears in the live sync, so both are re-pointed at
-- rent_pool_ar() here, in one migration, with every anchor count asserted.

insert into public.ops_feature_flags (name, enabled, reason)
values ('short_stays_pool', false,
        'owner 2026-10-25: «إقامات قصيرة» = gathern + aqarmonthly only; every other site''s per-month rent pools as yearly (×12). Born OFF; turned on once the app that prints «السعر المعلن … شهرياً» is live. Off = the pre-2026-10-25 PERIOD=SOURCE pool, restored by the next sync_search_listings_ar() run.')
on conflict (name) do nothing;

-- The ONE truth table, in SQL. Mirrors src/lib/rentPool.ts::rentPool.
create or replace function public.rent_pool_ar(p_platform text, p_rent_period text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when not exists (select 1 from public.ops_feature_flags k where k.name = 'short_stays_pool' and k.enabled)
      -- flag OFF: the pre-2026-10-25 mapping, verbatim (PERIOD = SOURCE; the two stay-length platforms default to «شهري»)
      then case p_rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي'
             else case when p_platform in ('gathern','aqarmonthly') then 'شهري' else null::text end end
    when p_platform in ('gathern','aqarmonthly') then 'شهري'
    else case p_rent_period when 'annual' then 'سنوي' when 'monthly' then 'سنوي' else null::text end
  end
$$;
comment on function public.rent_pool_ar(text, text) is
  'The rent POOL (search_listings_ar.rent_period_ar) for a platform + the period the site published. Owner 2026-10-25: «شهري» = «إقامات قصيرة» = gathern + aqarmonthly only; any other platform''s monthly or annual → «سنوي» (price_annual is monthly×12 already); no published period → NULL, never guessed. Behind ops_feature_flags.short_stays_pool; off = the pre-2026-10-25 mapping. App mirror: src/lib/rentPool.ts.';
revoke all on function public.rent_pool_ar(text, text) from public, anon, authenticated;

-- 1. The sync writes the pool through rent_pool_ar(). Both occurrences (the INSERT value and the "would the row
--    change" comparison) are replaced; the count is asserted so a drifted sync fails here, never silently.
do $sync$
declare
  d text; k int;
  old_expr constant text := 'case v.rent_period when ''monthly'' then ''شهري'' when ''annual'' then ''سنوي'' else case when v.platform in (''gathern'',''aqarmonthly'') then ''شهري'' else null::text end end';
  new_expr constant text := 'public.rent_pool_ar(v.platform, v.rent_period)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'sync_search_listings_ar';
  if d is null then raise exception 'sync_search_listings_ar not found'; end if;
  if position(new_expr in d) > 0 then raise notice 'sync_search_listings_ar already writes through rent_pool_ar'; return; end if;
  k := (length(d) - length(replace(d, old_expr, ''))) / length(old_expr);
  if k <> 2 then raise exception 'sync anchor found % times, want 2 — read the live sync before patching', k; end if;
  execute replace(d, old_expr, new_expr);
end $sync$;

-- 2. The index oracle predicts with the same function and self-mirrors on the same text.
do $det$
declare
  d text; k int;
  old_case constant text := 'case a\.rent_period when ''annual'' then ''سنوي'' when ''monthly'' then ''شهري''\s+else case when s\.platform in \(''gathern'',''aqarmonthly''\) then ''شهري'' else null::text end end';
  new_case constant text := 'public.rent_pool_ar(s.platform, a.rent_period)';
  old_lit  constant text := '''else case when v.platform in (''''gathern'''',''''aqarmonthly'''') then ''''شهري'''' else null::text end''';
  new_lit  constant text := '''public.rent_pool_ar(v.platform, v.rent_period)''';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_search_index_diverges_from_sync_source';
  if d is null then raise exception 'mon_detect_search_index_diverges_from_sync_source not found'; end if;
  if position(new_lit in d) > 0 then raise notice 'oracle already mirrors rent_pool_ar'; return; end if;
  k := (select count(*) from regexp_matches(d, old_case, 'g'));
  if k <> 2 then raise exception 'oracle case anchor found % times, want 2', k; end if;
  d := regexp_replace(d, old_case, new_case, 'g');
  k := (length(d) - length(replace(d, old_lit, ''))) / length(old_lit);
  if k <> 2 then raise exception 'oracle self-mirror literal found % times, want 2', k; end if;
  d := replace(d, old_lit, new_lit);
  execute d;
end $det$;

-- 3. The drift detector: while the flag is on, no other site may sit under «شهري» and the two stay-length platforms
--    may sit nowhere else. Quiet (and self-resolving) while the flag is off.
create or replace function public.mon_detect_short_stays_pool_drift()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n int := 0;
  v_on boolean;
  v_other int;
  v_short int;
begin
  select k.enabled into v_on from public.ops_feature_flags k where k.name = 'short_stays_pool';
  if not coalesce(v_on, false) then
    perform public.mon_resolve_key('short_stays_pool_drift', 'short_stays_pool_drift');
    return 0;
  end if;
  select count(*) into v_other from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar = 'شهري'
     and s.platform not in ('gathern','aqarmonthly');
  select count(*) into v_short from public.search_listings_ar s
   where s.production_ready and s.platform in ('gathern','aqarmonthly')
     and s.rent_period_ar is distinct from 'شهري';
  if v_other + v_short > 0 then
    n := n + public.mon_raise('P1', 'short_stays_pool_drift', 'search_index', 'short_stays_pool_drift',
      jsonb_build_object(
        'other_sites_under_short_stays', v_other,
        'stay_length_sites_outside_short_stays', v_short,
        'why', '«إقامات قصيرة» is gathern + aqarmonthly only (owner 2026-10-25); every other site''s per-month rent is a yearly listing at ×12. A row on the wrong side means sync_search_listings_ar() no longer writes through rent_pool_ar(), or a sync has not run since the flag was turned on.',
        'action', 'select rent_pool_ar(platform, rent_period) for a sample row; confirm sync_search_listings_ar() contains public.rent_pool_ar(v.platform, v.rent_period); run the sync. Never widen the pool to clear this.'));
  else
    perform public.mon_resolve_key('short_stays_pool_drift', 'short_stays_pool_drift');
  end if;
  return n;
end $function$;
revoke all on function public.mon_detect_short_stays_pool_drift() from public, anon, authenticated;

-- Roster: insert the new name right before an existing anchor in the live mon_run_all_detectors text, then execute it.
do $roster$
declare d text; anchor text := '''mon_detect_search_index_diverges_from_sync_source'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_short_stays_pool_drift''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_short_stays_pool_drift'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_short_stays_pool_drift''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- PROOF at apply, both flag states, every branch of the truth table; the flag flip lives in a sub-transaction that
-- is always rolled back, so production leaves this block exactly as it entered it (flag OFF).
do $proof$
declare r int; s text;
begin
  -- flag OFF (the state this migration leaves behind): the pre-2026-10-25 mapping, verbatim
  if public.rent_pool_ar('haraj', 'monthly') is distinct from 'شهري' then raise exception 'PROOF off: haraj monthly must still read شهري'; end if;
  if public.rent_pool_ar('gathern', null) is distinct from 'شهري' then raise exception 'PROOF off: gathern null must read شهري'; end if;
  if public.rent_pool_ar('aqar', null) is not null then raise exception 'PROOF off: unknown period must stay null'; end if;
  r := public.mon_detect_short_stays_pool_drift();
  if r <> 0 then raise exception 'PROOF off: the drift detector must be quiet while the flag is off (%)', r; end if;
  -- the sync and the oracle really carry the new expression
  select pg_get_functiondef(p.oid) into s from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'sync_search_listings_ar';
  if position('public.rent_pool_ar(v.platform, v.rent_period)' in s) = 0 then raise exception 'PROOF: sync does not write through rent_pool_ar'; end if;
  select pg_get_functiondef(p.oid) into s from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_search_index_diverges_from_sync_source';
  if position('public.rent_pool_ar(s.platform, a.rent_period)' in s) = 0 or position('''public.rent_pool_ar(v.platform, v.rent_period)''' in s) = 0 then
    raise exception 'PROOF: the oracle does not mirror rent_pool_ar';
  end if;
  -- flag ON, rolled back: the owner's table
  begin
    update public.ops_feature_flags set enabled = true where name = 'short_stays_pool';
    if public.rent_pool_ar('haraj', 'monthly') is distinct from 'سنوي' then raise exception 'PROOF on: haraj monthly must pool as سنوي'; end if;
    if public.rent_pool_ar('wasalt', 'annual') is distinct from 'سنوي' then raise exception 'PROOF on: wasalt annual must pool as سنوي'; end if;
    if public.rent_pool_ar('gathern', 'monthly') is distinct from 'شهري' then raise exception 'PROOF on: gathern must pool as شهري'; end if;
    if public.rent_pool_ar('aqarmonthly', 'monthly') is distinct from 'شهري' then raise exception 'PROOF on: aqarmonthly must pool as شهري'; end if;
    if public.rent_pool_ar('aqar', null) is not null then raise exception 'PROOF on: unknown period must stay null'; end if;
    -- the index still holds today's rows (the sync has not run with the flag on), so the detector MUST see drift
    r := public.mon_detect_short_stays_pool_drift();
    if (select count(*) from public.search_listings_ar s where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar = 'شهري' and s.platform not in ('gathern','aqarmonthly')) > 0 and r = 0
       and not exists (select 1 from public.alert_event a where a.kind = 'short_stays_pool_drift' and a.resolved_at is null) then
      raise exception 'PROOF on: the drift detector did not raise on the un-synced index';
    end if;
    raise exception 'PROOF_ROLLBACK';
  exception when others then
    if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
  if (select enabled from public.ops_feature_flags where name = 'short_stays_pool') then raise exception 'PROOF: the flag flip leaked out of its sub-transaction'; end if;
end $proof$;
