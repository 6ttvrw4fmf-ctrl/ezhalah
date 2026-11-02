-- novel_type_alerts raw-type rows never closed themselves. detect_novel_property_types() inserts a row
-- when a raw property_type (or an index type_ar) is outside the known lists, but nothing ever set
-- resolved = true when that raw type later left every active row, so mon_detect_legacy_alert_tables()
-- kept re-raising legacy_novel_type alerts for types that no longer exist anywhere (measured
-- 2026-11-02: 8 of 16 open, e.g. «شقة» n=58 in wasalt, zero active rows today). The raiser now
-- resolves on the SAME predicate it raises on: a non-INVARIANT alert whose raw value is neither a
-- novel active property_type nor an unknown type_ar in search_listings_ar is closed. INVARIANT rows
-- keep their own resolvers (unsynced_table in mon_detect_legacy_alert_tables). Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.detect_novel_property_types()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; rec record; inserted int := 0; bad_n bigint := 0;
begin
  create temp table _seen(raw text, tbl text, n bigint) on commit drop;

  -- scan every active raw property_type across scraped tables (deal_* excluded — retired experiment)
  for r in select t.table_name tn from information_schema.tables t
    where t.table_schema='public' and t.table_name like '%\_listings'
      and t.table_name not like 'deal\_%'
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='property_type')
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='active')
  loop
    begin
      execute format('insert into _seen select property_type::text, %L, count(*) from public.%I where active and property_type is not null and btrim(property_type::text) <> '''' group by property_type', r.tn, r.tn);
    exception when others then null; end;
  end loop;

  -- the two "novel right now" sets, computed ONCE and used both to raise and to resolve
  create temp table _novel_raw on commit drop as
    select raw, sum(n) total, (array_agg(tbl order by n desc))[1] sample
    from _seen s
    where not exists (select 1 from public.known_property_types k where normalize(k.raw_type, nfc) = normalize(s.raw, nfc))
    group by raw;

  create temp table _novel_ar on commit drop as
    select s.type_ar as raw, count(*) total
    from public.search_listings_ar s
    where s.type_ar is not null
      and not exists (select 1 from public.known_type_ar k where normalize(k.type_ar, nfc) = normalize(s.type_ar, nfc))
    group by s.type_ar;

  -- (existing) raw novelty vs known_property_types — NFC-NORMALIZED both sides. Persistent alert, debounced.
  for rec in select raw, total, sample from _novel_raw
  loop
    if not exists (select 1 from public.novel_type_alerts a where a.raw_type = rec.raw and not a.resolved) then
      insert into public.novel_type_alerts(raw_type, sample_table, n) values (rec.raw, rec.sample, rec.total);
      inserted := inserted + 1;
    end if;
  end loop;

  -- ARABIC-CHAIN reachability: every distinct type_ar the app can show MUST be a frontend-selectable label.
  for rec in select raw, total from _novel_ar
  loop
    if not exists (select 1 from public.novel_type_alerts a where a.raw_type = rec.raw and not a.resolved) then
      insert into public.novel_type_alerts(raw_type, sample_table, n) values (rec.raw, 'search_listings_ar', rec.total);
      inserted := inserted + 1;
    end if;
  end loop;

  -- SELF-RESOLVE on the same predicate (2026-11-02): a raw-type alert whose value is in neither novel set
  -- right now is closed. INVARIANT:* rows are left to their own resolvers.
  update public.novel_type_alerts a set resolved = true
  where not a.resolved
    and a.raw_type not like 'INVARIANT:%'
    and not exists (select 1 from _novel_raw x where normalize(x.raw, nfc) = normalize(a.raw_type, nfc))
    and not exists (select 1 from _novel_ar  y where normalize(y.raw, nfc) = normalize(a.raw_type, nfc));

  -- SOURCE_TABLE coverage: any active *_listings table whose rows never reach search_listings_ar is
  -- INVISIBLE to search — a half-added platform. Self-contained (no hardcoded allowlist). Debounced.
  for rec in
    select s.tbl as tname, sum(s.n) total
    from _seen s
    where not exists (select 1 from public.search_listings_ar l where l.source_table = s.tbl)
    group by s.tbl
  loop
    if not exists (select 1 from public.novel_type_alerts a where a.raw_type = 'INVARIANT:unsynced_table:'||rec.tname and not a.resolved) then
      insert into public.novel_type_alerts(raw_type, sample_table, n) values ('INVARIANT:unsynced_table:'||rec.tname, rec.tname, rec.total);
      inserted := inserted + 1;
    end if;
  end loop;

  -- (existing) Gathern/Aqar-Monthly rent-only hygiene (data alarm, not a leak — results already safe).
  select count(*) into bad_n from public.search_listings_ar s
   where s.deal_ar = 'بيع' and (s.source_table like 'gathern%' or s.source_table like 'aqarmonthly%');
  if bad_n > 0 and not exists (select 1 from public.novel_type_alerts a where a.raw_type = 'INVARIANT:gathern_or_aqarmonthly_deal_buy' and not a.resolved) then
    insert into public.novel_type_alerts(raw_type, sample_table, n) values ('INVARIANT:gathern_or_aqarmonthly_deal_buy', 'search_listings_ar', bad_n);
    inserted := inserted + 1;
  end if;

  return inserted;
end $function$;