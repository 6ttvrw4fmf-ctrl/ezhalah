-- Keeps 20261005094209 (aldarim SaaS: an UNFILLED room block is silence, not «no») true.
-- 🔬 AF engineer 2026-10-06 (backlog 80).
--
-- The claim: on the aldarim SaaS (aldarim / abwbna / alobid / bahadhabab) no active listing whose
-- room block is entirely 0/absent (the advertiser never filled it) stores kitchen / maid_room /
-- driver_room / balcony_terrace = false. 20261005094209 reverted 446 such «no» to NULL and the
-- scrapers emit NULL (normalize.silence_unfilled_room_block). A scraper that loses that call writes
-- the false back on the next crawl, and the upsert would keep it: this turns RED on the next sweep.
-- The repair is written as `execute format(... update public.%I_listings ...)`, which
-- verify-repair-migrations-are-guarded.ts could not see until scripts/lib/repairClassifier.ts
-- learned format placeholders the same day.
create or replace function public.mon_detect_aldarim_saas_unfilled_block_false()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  t       text;
  v_rows  bigint;
  v_bad   bigint := 0;
  v_seen  bigint := 0;
  v_by    jsonb := '{}'::jsonb;
begin
  foreach t in array array['aldarim_residential','aldarim_commercial','abwbna_residential','abwbna_commercial',
                           'alobid_residential','alobid_commercial','bahadhabab_residential','bahadhabab_commercial'] loop
    execute format($q$ select count(*) from public.%I_listings where active $q$, t) into v_rows;
    v_seen := v_seen + v_rows;
    execute format($q$
      select count(*) from public.%I_listings x
       where x.active and x.source_capture is not null
         and (x.kitchen is false or x.maid_room is false or x.driver_room is false or x.balcony_terrace is false)
         and not coalesce(x.kitchen or x.maid_room or x.driver_room or x.balcony_terrace, false)
         and coalesce(nullif(x.source_capture->>'bedrooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'bathrooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'living_rooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'kitchens','')::numeric, 0) = 0
    $q$, t) into v_rows;
    if v_rows > 0 then
      v_bad := v_bad + v_rows;
      v_by := v_by || jsonb_build_object(t, v_rows);
    end if;
  end loop;

  -- BLINDNESS GUARD: with no active row on any of the four sites a 0 proves nothing.
  if v_seen = 0 then
    live := live || 'aldarim_saas_unfilled_block_false:BLIND'::text;
    n := n + public.mon_raise('P2', 'aldarim_saas_unfilled_block_false', 'aldarim',
      'aldarim_saas_unfilled_block_false:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active listing on aldarim/abwbna/alobid/bahadhabab, so this detector cannot see '
            || 'whether an unfilled room block is still stored as «no».',
        'action', 'Fix the aldarim-SaaS crawls first.'));
  elsif v_bad > 0 then
    live := live || 'aldarim_saas_unfilled_block_false:false_from_silence'::text;
    n := n + public.mon_raise('P1', 'aldarim_saas_unfilled_block_false', 'aldarim',
      'aldarim_saas_unfilled_block_false:false_from_silence',
      jsonb_build_object('rows', v_bad, 'by_table', v_by,
        'why', 'An unfilled room block (all 0) is stored as kitchen/maid/driver/balcony = false: unknown became «no», '
            || 'so the Advanced Filter hides these listings from a customer who asks for the amenity.',
        'action', 'The scraper must call normalize.silence_unfilled_room_block; then revert the rows to NULL as 20261005094209 did.'));
  end if;

  perform public.mon_resolve_stale_keys('aldarim_saas_unfilled_block_false', live);
  return n;
end
$function$;

-- Roster entry in the same change (AGENTS.md): a detector nothing reaches is decoration.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_aldarim_saas_unfilled_block_false' in src) > 0 then
    raise notice 'mon_detect_aldarim_saas_unfilled_block_false already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_dwelleo_amenity_trapped'',',
    E'    ''mon_detect_dwelleo_amenity_trapped'',\n    ''mon_detect_aldarim_saas_unfilled_block_false'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
