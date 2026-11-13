-- false_resurrection: a GONE probe of a DELETED earlier row is not evidence about a NEW row.
--
-- Measured 2026-11-13 (♻️): every gathern false_resurrection since 11-11 (GTH253915, GTH145646,
-- GTH246298, GTH194435, GTH209847, GTH263601, GTH202632) is the same shape. The GONE probe
-- (09-28/09-29) was written for an older row id; that row was deleted by the 30-day cleanup
-- (cleanup_deletion_log 10-09 .. 11-04); Gathern later listed the unit again and the crawl inserted
-- a NEW row (new id, scraped_at = its birth). The detector joined probes to rows by ad_number only,
-- so it charged the new row with the dead row's verdict. 6 of the 7 were then read alive on their
-- own page within hours. Nothing un-hid anything: there was no resurrection.
--
-- Root fix in the one shared place (the function every caller reads): a probe whose listing_id names
-- a DIFFERENT row and which predates this row's birth (scraped_at, a column default nothing writes
-- after insert) belongs to a previous incarnation and is skipped. Unchanged: a probe of the SAME row
-- (listing_id = t.id), a probe with no listing_id (sold-pin, by ad_number), and a probe of another
-- row taken after this row was born all still raise.
create or replace function public.ops_lifecycle_false_resurrection(p_inject jsonb default '[]'::jsonb)
 returns table(source_table text, ad_number text, listing_id bigint, gone_at timestamp with time zone, last_verified_alive_at timestamp with time zone, injected boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_inject jsonb := coalesce(p_inject, '[]'::jsonb);
  r        record;
begin
  for r in
    select s.st
      from (
        select p.source_table as st
          from public.ops_stale_inactivation_probe p
         where p.verdict = 'GONE' and p.ad_number is not null
         group by 1
        union
        select x->>'source_table'
          from jsonb_array_elements(v_inject) x
      ) s
     where s.st is not null
       and to_regclass('public.' || quote_ident(s.st)) is not null
       and (select count(*) from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = s.st
               and c.column_name in ('ad_number', 'active', 'last_verified_alive_at', 'id', 'scraped_at')) = 5
  loop
    return query execute format($q$
      with all_probes as (
        select p.ad_number, p.listing_id::bigint as probe_row, p.verdict, p.probed_at, false as injected
          from public.ops_stale_inactivation_probe p
         where p.source_table = %1$L and p.ad_number is not null
        union all
        select x->>'ad_number', (x->>'listing_id')::bigint, coalesce(x->>'verdict', 'GONE'), (x->>'probed_at')::timestamptz, true
          from jsonb_array_elements(%2$L::jsonb) x
         where x->>'source_table' = %1$L and x->>'ad_number' is not null
      ),
      latest as (
        select distinct on (a.ad_number) a.ad_number, a.probe_row, a.verdict, a.probed_at, a.injected
          from all_probes a
         order by a.ad_number, a.probed_at desc
      )
      select %1$L::text, t.ad_number, t.id::bigint, l.probed_at, t.last_verified_alive_at, l.injected
        from latest l
        join public.%1$I t on t.ad_number = l.ad_number
       where l.verdict = 'GONE'
         and t.active is true
         and (t.last_verified_alive_at is null or t.last_verified_alive_at < l.probed_at)
         and not (l.probe_row is not null and l.probe_row <> t.id and l.probed_at < t.scraped_at)
    $q$, r.st, v_inject::text);
  end loop;
end;
$function$;
