-- «أرض خام» — the OWNER'S RULE, verbatim (2026-10-10): «the rule should be clearly: said no for all ·
-- said no services · raw lands». A land is raw ONLY when its source CLEARLY says one of:
--   1. NO for every service — electricity = false AND water = false AND sanitation = false (all three,
--      each stated by the source; aqar's structured fields);
--   2. NO SERVICES in words — «لا يوجد خدمات» as aqarcity's own services value, or the ad's text says
--      «بدون خدمات» / «خالية من الخدمات» / «غير مخدوم(ة)»;
--   3. RAW LAND in words — whole-word «خام» / «الخام» in the ad or the site's own category
--      (ialqarawi «أراضي خام», dealapp «ارض خام», abralosol «خام»); never «الخامس».
-- REMOVED from 20261009235145, because they are not what the owner's rule says:
--   • wasalt electricityMeter = No AND waterMeter = No (≈1,129) — a missing METER is not a stated «no
--     service», and wasalt never states sewage at all, so it is not «no for all»;
--   • the phrase «غير مطور» (undeveloped) — not one of the three.
-- A text phrase still never overrides a source field that says a service EXISTS (any true → not raw).
-- The function keeps the same name, signature, lock and schedule (rides jobid 28); rows that no longer
-- qualify lose the tag on the pass below (the update writes NULL where the rule now says not raw).
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
                           ~ '(^|[^ء-ي])(ال)?خام([^ء-ي]|$)|غير مخدوم|بدون خدمات|خالية من الخدمات'
                         or coalesce(r.additional_info::text, '') ~ '(^|[^ء-ي])(ال)?خام([^ء-ي]|$)'
                         or (jsonb_typeof(r.additional_info) = 'object'
                             and btrim(coalesce(r.additional_info->>'services', '')) ~ '^لا ?يوجد خدمات$')
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
