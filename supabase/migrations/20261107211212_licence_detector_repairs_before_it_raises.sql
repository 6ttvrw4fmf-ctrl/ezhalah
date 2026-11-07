-- 🔧 2026-11-07: the licence detector repairs before it raises.
--
-- mon_detect_licence_not_on_card() (falcon 20261106200832) raised 5 P2s at 16:59 UTC: aqar res 27 + com 6,
-- sakani res 3 + com 1, rawaf 19 of 19. Two writer paths re-open the gap after the backfill:
--   * rawaf sends adLicenseNumber as a JSON number; scrapers/common/db.py _licence_on_card accepted only a
--     str (fixed in the same PR, test scrapers/common/tests/test_licence_on_card_numeric.py);
--   * a crawl that rewrites additional_info without the licence in its payload (sakani list rows with no
--     detail read) or writes license_number while additional_info stays NULL (aqar): the writer cannot know
--     the stored licence, so only the database can put it back.
-- So the detector now does what the 11-06 backfill did — the stored 10-digit licence, verbatim, into the
-- card key, active rows only, ≤ 25,000 rows per table — and raises only for a row it could not repair
-- (e.g. additional_info that is not an object). Cadence 20 h → 6 h, so a card heals within hours of a crawl.
-- PRICE = SOURCE is untouched: this copies a value the row already stores from its source into the key the
-- card reads; nothing is invented.

create or replace function public.mon_detect_licence_not_on_card()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; r record; v_lic bigint; v_miss bigint; v_fixed int; live text[] := '{}';
begin
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = 'licence_not_on_card' and last_run_at > now() - interval '6 hours') then
    return 0;
  end if;
  for r in
    select c.table_name t
      from information_schema.columns c
      join information_schema.tables tt on tt.table_schema = 'public' and tt.table_name = c.table_name
                                       and tt.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'license_number' and c.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                     and d.table_name = c.table_name and d.column_name = 'additional_info')
       and exists (select 1 from information_schema.columns e where e.table_schema = 'public'
                     and e.table_name = c.table_name and e.column_name = 'active')
  loop
    -- REPAIR first: the stored licence, verbatim, into the card key (object or NULL panels only).
    execute format(
      'with x as (select id from public.%I
                   where active and btrim(license_number::text) ~ %L
                     and nullif(btrim(additional_info->>%L), %L) is null
                     and (additional_info is null or jsonb_typeof(additional_info) = %L)
                   limit 25000)
       update public.%I t
          set additional_info = coalesce(t.additional_info, %L::jsonb)
                                || jsonb_build_object(%L, btrim(t.license_number::text))
         from x where t.id = x.id',
      r.t, '^[0-9]{10}$', 'rega_ad_license_number', '', 'object',
      r.t, '{}', 'rega_ad_license_number');
    get diagnostics v_fixed = row_count;
    execute format(
      'select count(*) filter (where btrim(license_number::text) ~ %L),
              count(*) filter (where btrim(license_number::text) ~ %L
                                 and nullif(btrim(additional_info->>%L), %L) is null)
         from public.%I where active',
      '^[0-9]{10}$', '^[0-9]{10}$', 'rega_ad_license_number', '', r.t) into v_lic, v_miss;
    if v_miss > 0 then
      live := live || ('licence_not_on_card:' || r.t);
      n := n + public.mon_raise('P2', 'licence_not_on_card', split_part(r.t, '_', 1), 'licence_not_on_card:' || r.t,
        jsonb_build_object('table', r.t, 'active_with_licence', v_lic, 'missing_on_card', v_miss,
          'repaired_this_run', v_fixed,
          'why', 'Active ads store a 10-digit REGA ad licence in license_number, the detector copied it onto '
              || 'the card key (additional_info.rega_ad_license_number) and these rows STILL miss it — their '
              || 'additional_info is not a JSON object, or more than 25,000 needed repair at once. Read the rows '
              || 'and the scraper that writes them; scrapers/common/db.py _licence_on_card is the writer.'));
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('licence_not_on_card', live);
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select 'licence_not_on_card', now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = 'licence_not_on_card');
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n
   where detector = 'licence_not_on_card';
  return n;
end
$function$;

revoke execute on function public.mon_detect_licence_not_on_card() from public, anon, authenticated;

-- PROOF at apply: a planted miss is REPAIRED (not raised), then rolled back; and today's misses are healed.
do $$
declare v_id bigint; v_lic text;
begin
  begin
    select id, btrim(license_number) into v_id, v_lic from public.tuba_residential_listings
     where active and license_number ~ '^[0-9]{10}$' limit 1;
    update public.tuba_residential_listings set additional_info = additional_info - 'rega_ad_license_number' where id = v_id;
    delete from public.ops_detector_last_full_run where detector = 'licence_not_on_card';
    perform public.mon_detect_licence_not_on_card();
    if (select additional_info->>'rega_ad_license_number' from public.tuba_residential_listings where id = v_id)
         is distinct from v_lic then
      raise exception 'PROOF: a planted missing licence was not repaired';
    end if;
    if exists (select 1 from public.alert_event where dedup_key = 'licence_not_on_card:tuba_residential_listings'
                and resolved_at is null) then
      raise exception 'PROOF: a repaired miss still raised';
    end if;
    raise exception '__licence_repair_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__licence_repair_selftest_rollback__' then raise; end if;
  end;
  delete from public.ops_detector_last_full_run where detector = 'licence_not_on_card';
  perform public.mon_detect_licence_not_on_card();
  if exists (select 1 from public.alert_event where kind = 'licence_not_on_card' and resolved_at is null) then
    raise exception 'PROOF: active rows still miss the card licence after the repair';
  end if;
end $$;
