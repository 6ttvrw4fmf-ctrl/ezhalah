-- «أرض خام» (raw land) — owner 2026-10-09: «we're creating our own separate property type, called أرض خام
-- … searchable by district and everything … whenever we get a new listing, we put it.»
--
-- A raw land keeps its own source type (أرض تجارية / سكنية / صناعية / زراعية — the card still shows the
-- source's word). It is TAGGED by setting search_listings_ar.unit_subtype_ar = 'أرض خام', a column every
-- land row has NULL today (unit_subtype_ar is Gathern's unit type; no land row carries one). The search
-- clause (next migration) lets the type token 'أرض خام' in p_types match that tag, so every surface —
-- results, city counts, district counts, AF counts — reads one definition.
--
-- RAW ONLY ON THE SOURCE'S OWN WORD (source is truth; silent is NOT raw, never guessed):
--   1. the index says electricity, water AND sanitation are all false (aqar's structured fields);
--   2. no service is stated true, AND one of:
--      a. the ad's title/description says whole-word «خام» / «الخام» (NOT «الخامس» — the trap that
--         inflated the first count), «غير مخدوم», «غير مطور», «بدون خدمات», «خالية من الخدمات»;
--         NOT «لا يوجد خدمات» in free text: aqar writes «استخدامات العقار: لا يوجد خدمات العقار: كهرباء»,
--         i.e. "uses: none · services: electricity" — a false raw;
--      b. the site's own structured data says خام (ialqarawi category «أراضي خام», dealapp «ارض خام»,
--         abralosol title_qualifier «خام»);
--      c. aqarcity's services field is exactly «لايوجد خدمات»;
--      d. wasalt publishes electricityMeter = No AND waterMeter = No.
-- Measured 2026-10-09 (owner-session deep check): ≈ 6,100 lands.
--
-- Rides the hourly index sync (jobid 28), appended LAST like sync_gathern_native_attrs, so a new
-- listing is tagged in the same pass that adds it. Fails SOFT per table (a bad table is skipped and
-- counted, never rolls back the sync), takes the single-writer lock like every index writer.

create or replace function public.sync_raw_land_subtype()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  n int;
  changed int := 0;
  failed int := 0;
begin
  if not public.search_index_writer_lock() then return null; end if;
  for rec in
    select distinct s.source_table
      from public.search_listings_ar s
     where s.type_ar ~ 'أرض'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = s.source_table
                      and c.column_name = 'additional_info')
  loop
    begin
      execute format($f$
        with want as (
          select s.listing_id,
                 case when
                   (s.electricity is false and s.water_supply is false and s.sanitation is false)
                   or (coalesce(s.electricity, false) = false
                       and coalesce(s.water_supply, false) = false
                       and coalesce(s.sanitation, false) = false
                       and (
                         (coalesce(r.title, '') || ' ' || coalesce(r.description, ''))
                           ~ '(^|[^ء-ي])(ال)?خام([^ء-ي]|$)|غير مخدوم|غير مطور|بدون خدمات|خالية من الخدمات'
                         or coalesce(r.additional_info::text, '') ~ '(^|[^ء-ي])(ال)?خام([^ء-ي]|$)'
                         or (jsonb_typeof(r.additional_info) = 'object'
                             and btrim(coalesce(r.additional_info->>'services', '')) ~ '^لا ?يوجد خدمات$')
                         or (jsonb_typeof(r.additional_info) = 'array'
                             and exists (select 1 from jsonb_array_elements(r.additional_info) e
                                          where e->>'key' = 'electricityMeter' and e->>'value' = 'No')
                             and exists (select 1 from jsonb_array_elements(r.additional_info) e
                                          where e->>'key' = 'waterMeter' and e->>'value' = 'No'))
                       ))
                 then 'أرض خام' end as want
            from public.search_listings_ar s
            join public.%1$I r on r.id = s.listing_id
           where s.source_table = %1$L
             and s.type_ar ~ 'أرض'
             and (s.unit_subtype_ar is null or s.unit_subtype_ar = 'أرض خام')
        )
        update public.search_listings_ar s
           set unit_subtype_ar = want.want
          from want
         where s.source_table = %1$L
           and s.listing_id = want.listing_id
           and s.unit_subtype_ar is distinct from want.want
      $f$, rec.source_table);
      get diagnostics n = row_count;
      changed := changed + n;
    exception when others then
      failed := failed + 1;
      raise warning 'sync_raw_land_subtype: % skipped: %', rec.source_table, sqlerrm;
    end;
  end loop;
  -- A land that stopped being land (re-typed by its source) must not keep the tag.
  update public.search_listings_ar s set unit_subtype_ar = null
   where s.unit_subtype_ar = 'أرض خام' and s.type_ar !~ 'أرض';
  get diagnostics n = row_count;
  changed := changed + n;
  if failed > 0 then
    raise warning 'sync_raw_land_subtype: % table(s) skipped', failed;
  end if;
  return changed;
end
$function$;

revoke all on function public.sync_raw_land_subtype() from public, anon, authenticated;
grant execute on function public.sync_raw_land_subtype() to service_role;

-- Ride the hourly index sync, appended LAST (same pattern as 20260818005713).
do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobid = 28;
  if cmd is null then raise exception 'jobid 28 (sync-search-listings-ar) not found'; end if;
  if position('sync_raw_land_subtype' in cmd) > 0 then
    raise notice 'already scheduled — no-op'; return;
  end if;
  perform cron.alter_job(28, command => cmd || ' select public.sync_raw_land_subtype();');
end $$;

-- The first pass ran right after this migration, by hand under the same writer lock (an in-migration
-- pass risks the 60 s apply limit); the hourly job then keeps it current.
