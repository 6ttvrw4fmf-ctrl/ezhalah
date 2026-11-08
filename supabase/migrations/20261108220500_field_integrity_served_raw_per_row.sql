-- 🔧 2026-11-08 follow-up to 20261108220000: the inline correlated EXISTS against search_listings_ar planned as a
-- whole-index scan per table (one dealapp table alone ran > 60 s; the detector normally takes ~19 s). A plpgsql helper
-- is opaque to the planner and is reached only after the cheap band test is true (AND short-circuits), so it runs as
-- one index lookup for the handful of rows in a band. Same meaning: count a row only while a customer is served the raw figure.
create or replace function public.field_integrity_served_raw(p_tableoid oid, p_id bigint, p_price numeric)
 returns boolean
 language plpgsql
 stable
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  return exists (select 1 from public.search_listings_ar s
                  where s.source_table = (select c.relname from pg_catalog.pg_class c where c.oid = p_tableoid)
                    and s.listing_id = p_id and s.production_ready
                    and coalesce(s.price_total, s.price_annual) = p_price);
end
$function$;

do $m$
declare v text; n text;
  old_block constant text := $a$
                            and exists (select 1 from public.search_listings_ar s
                                         where s.source_table = (select c.relname from pg_catalog.pg_class c where c.oid = x.tableoid)
                                           and s.listing_id = x.id and s.production_ready
                                           and coalesce(s.price_total, s.price_annual) = coalesce(x.price_total, x.price_annual))$a$;
  new_block constant text := $a$
                            and public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))$a$;
begin
  v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if (length(v) - length(replace(v, old_block, ''))) / length(old_block) <> 2 then
    raise exception 'mon_detect_field_integrity: expected the 20261108220000 block exactly twice';
  end if;
  n := replace(v, old_block, new_block);
  execute n;
end
$m$;
