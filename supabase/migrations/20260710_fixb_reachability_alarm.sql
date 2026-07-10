-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FIX B (owner 2026-07-10) — turn the novel-type alarm into a REACHABILITY alarm. APPLIED LIVE to
-- prod via Supabase MCP on 2026-07-10; this file mirrors exactly what was applied (recoverability —
-- MCP migrations are otherwise live-only). Superset of the parked 20260709_novel_type_alarm_arabic_chain.sql.
--
-- What it adds over the old daily raw-string alarm (pg_cron jobid 33):
--   • raw-novelty pass NFC-NORMALIZED both sides (kills the composed-vs-decomposed false positive,
--     e.g. «شقَّة صغيرة (استوديو)»);
--   • ARABIC-CHAIN reachability: any distinct search_listings_ar.type_ar NOT in known_type_ar (the
--     frontend-selectable label set generated from propertyTypes.ts) → alert. Catches a new/unmapped
--     commercial (or any) type that would be silently unreachable;
--   • SOURCE_TABLE coverage: any active *_listings table whose rows never reach search_listings_ar →
--     alert (a half-added platform, invisible to search). Self-contained, no hardcoded allowlist;
--   • Gathern/Aqar-Monthly rent-only hygiene (preserved).
-- ALERT-ONLY — never auto-classifies (neutrality rule). Same novel_type_alerts table + debounce + int
-- return, so jobid 33 is unaffected. Rescheduled to hourly (see APPLY ORDER below).
--
-- APPLY ORDER (all applied live 2026-07-10):
--   1) sql/known_type_ar.generated.sql  → seeds public.known_type_ar (47 labels; regenerate on any
--                                          propertyTypes.ts change via `npm run verify:emit-sql`).
--   2) this file                        → replaces detect_novel_property_types().
--   3) select cron.alter_job(33, schedule => '15 * * * *');   -- hourly ≤1h latency (was daily 03:20).
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.known_type_ar (type_ar text primary key, macro text);
alter table public.known_type_ar add column if not exists macro text;

create or replace function public.detect_novel_property_types()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare r record; rec record; inserted int := 0; bad_n bigint := 0;
begin
  create temp table _seen(raw text, tbl text, n bigint) on commit drop;

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

  -- raw novelty vs known_property_types — NFC-normalized both sides
  for rec in
    select raw, sum(n) total, (array_agg(tbl order by n desc))[1] sample
    from _seen s
    where not exists (select 1 from public.known_property_types k where normalize(k.raw_type, nfc) = normalize(s.raw, nfc))
    group by raw
  loop
    if not exists (select 1 from public.novel_type_alerts a where a.raw_type = rec.raw and not a.resolved) then
      insert into public.novel_type_alerts(raw_type, sample_table, n) values (rec.raw, rec.sample, rec.total);
      inserted := inserted + 1;
    end if;
  end loop;

  -- ARABIC-CHAIN reachability: type_ar not frontend-selectable (known_type_ar)
  for rec in
    select s.type_ar as raw, count(*) total
    from public.search_listings_ar s
    where s.type_ar is not null
      and not exists (select 1 from public.known_type_ar k where normalize(k.type_ar, nfc) = normalize(s.type_ar, nfc))
    group by s.type_ar
  loop
    if not exists (select 1 from public.novel_type_alerts a where a.raw_type = rec.raw and not a.resolved) then
      insert into public.novel_type_alerts(raw_type, sample_table, n) values (rec.raw, 'search_listings_ar', rec.total);
      inserted := inserted + 1;
    end if;
  end loop;

  -- SOURCE_TABLE coverage: active *_listings table whose rows never reach the search surface
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

  -- Gathern/Aqar-Monthly rent-only hygiene
  select count(*) into bad_n from public.search_listings_ar s
   where s.deal_ar = 'بيع' and (s.source_table like 'gathern%' or s.source_table like 'aqarmonthly%');
  if bad_n > 0 and not exists (select 1 from public.novel_type_alerts a where a.raw_type = 'INVARIANT:gathern_or_aqarmonthly_deal_buy' and not a.resolved) then
    insert into public.novel_type_alerts(raw_type, sample_table, n) values ('INVARIANT:gathern_or_aqarmonthly_deal_buy', 'search_listings_ar', bad_n);
    inserted := inserted + 1;
  end if;

  return inserted;
end $function$;
