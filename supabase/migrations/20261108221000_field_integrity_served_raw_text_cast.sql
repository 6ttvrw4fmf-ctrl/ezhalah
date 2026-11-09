-- 🔧 2026-11-08 follow-up to 20261108220500: pg_class.relname is type `name`; `source_table (text) = name` cannot use
-- search_listings_ar_pkey (source_table, listing_id), so every call scanned the whole index table (> 60 s on one
-- dealapp table). Cast to text so each call is one primary-key lookup.
create or replace function public.field_integrity_served_raw(p_tableoid oid, p_id bigint, p_price numeric)
 returns boolean
 language plpgsql
 stable
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_tbl text := (select c.relname::text from pg_catalog.pg_class c where c.oid = p_tableoid);
begin
  return exists (select 1 from public.search_listings_ar s
                  where s.source_table = v_tbl and s.listing_id = p_id and s.production_ready
                    and coalesce(s.price_total, s.price_annual) = p_price);
end
$function$;
