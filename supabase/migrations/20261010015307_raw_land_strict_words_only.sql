-- «أرض خام» — STRICT, WORDS-ONLY RULE (owner 2026-10-10: «there is no way there is 6000 … make strict rules»;
-- «not developed could be part of it»; «add other factors that indicate it's raw» → only wording that MEANS raw).
-- MEASURED WHY: aqar stores electricity/water/sewage = false whenever the seller simply did not tick the
-- boxes — six random «all three false» rows were ordinary plots in ordinary districts (حي الحزم, حي الورود
-- الطائف, مخطط الهجرة …). An unticked box is not a statement, so «no for all» is NOT evidence any more
-- (it was 4,645 of the 4,905). A land is raw ONLY when the ad's own words or the site's own category say:
--   • «خام» / «الخام» (whole word — never «الخامس»)        • «غير مطور(ة)» (not developed)
--   • «غير مخدوم(ة)» / «بدون خدمات» / «خالية من الخدمات»    • aqarcity's own services value «لايوجد خدمات»
--   • «أرض بكر» / «أراضي بكر» (virgin land)                  • «غير مخطط(ة)» / «غير مقسم(ة)» (not subdivided)
-- …AND no source field says a service EXISTS (electricity / water / sanitation true → not raw).
-- NOT used, on purpose (a guess, not a statement): plot size, «خارج النطاق», «صك زراعي», unticked boxes,
-- «لا يوجد خدمات» in free text (aqar's «استخدامات العقار: لا يوجد خدمات العقار: كهرباء» = services: electricity).
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
                   (coalesce(s.electricity, false) = false
                       and coalesce(s.water_supply, false) = false
                       and coalesce(s.sanitation, false) = false
                       and (
                         (coalesce(r.title, '') || ' ' || coalesce(r.description, ''))
                           ~ '(^|[^ء-ي])(ال)?خام([^ء-ي]|$)|غير مطور|غير مخدوم|بدون خدمات|خالية من الخدمات|(أرض|ارض|أراضي|اراضي) بكر|غير مخطط|غير مقسم'
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