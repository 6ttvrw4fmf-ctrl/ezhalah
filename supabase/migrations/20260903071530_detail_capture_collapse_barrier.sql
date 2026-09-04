-- A platform's detail-page parse can break while the crawl still reports ok=true: the catalogue
-- enumerates, rows_seen holds steady, prune behaves — and every freshly-crawled row silently loses
-- its price and description. sadin sat in exactly that state from ~2026-08-14 to 2026-09-03 (both
-- tables, 83 active rows served with no price at all) and NOTHING could see it.
--
-- mon_detect_summary_only_capture() already encodes this bug class, but it is hardcoded to
-- aqaratikom_residential_listings — the §25c shape: a barrier whose cohort cannot contain its
-- subject. This generalises it over every platform table, residential AND commercial (§20).
--
-- The signal is a REGRESSION against the table's own history, never an absolute: a table must have
-- proven it can capture descriptions (>=5) and prices (>=3) before its silence counts as loss.
-- That is what keeps a platform which genuinely never publishes a price (jazwtn: 108 fresh rows,
-- ever_price = 0) out of the cohort instead of alerting forever.
create or replace function public.mon_detect_detail_capture_collapse()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n int := 0;
  live_keys text[] := '{}';
  v_fresh bigint; v_lost bigint; v_ever_desc bigint; v_ever_price bigint;
  k text;
begin
  for r in
    select c.table_name tn
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name = 'description'
       and c.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns d
                    where d.table_schema='public' and d.table_name=c.table_name and d.column_name='price_total')
       and exists (select 1 from information_schema.columns d
                    where d.table_schema='public' and d.table_name=c.table_name and d.column_name='price_annual')
       and exists (select 1 from information_schema.columns d
                    where d.table_schema='public' and d.table_name=c.table_name and d.column_name='last_seen_at')
     order by c.table_name
  loop
    execute format($f$select
        count(*) filter (where active and last_seen_at > now() - interval '3 days'),
        count(*) filter (where active and last_seen_at > now() - interval '3 days'
                           and description is null and price_total is null and price_annual is null),
        count(*) filter (where description is not null),
        count(*) filter (where price_total is not null or price_annual is not null)
      from public.%I$f$, r.tn)
      into v_fresh, v_lost, v_ever_desc, v_ever_price;

    if v_fresh >= 10 and v_ever_desc >= 5 and v_ever_price >= 3
       and v_lost::numeric / v_fresh >= 0.8 then
      k := 'detail_capture_collapse:' || r.tn;
      live_keys := live_keys || k;
      n := n + public.mon_raise('P1', 'detail_capture_collapse', r.tn, k,
        jsonb_build_object(
          'table', r.tn,
          'fresh_rows', v_fresh,
          'fresh_rows_with_neither_price_nor_description', v_lost,
          'frac', round((v_lost::numeric / greatest(v_fresh,1)), 3),
          'ever_captured_description', v_ever_desc,
          'ever_captured_price', v_ever_price,
          'why', 'Rows crawled in the last 3 days carry NEITHER a price NOR a description, while '
              || 'this table''s own history proves it captured both. The crawl is still reaching the '
              || 'platform (the rows are fresh and active) so every count/liveness barrier stays '
              || 'green — the loss is in the DETAIL parse, and users are served price-less cards.',
          'adjudicate', 'Find the field the detail parser reads and check whether the source redesigned '
              || 'its markup. Confirm the fetch itself still works before blaming the fetch: a '
              || 'structured field that IS still populated (e.g. area from a dt/dd pair) proves the '
              || 'page is reachable and parsed, and narrows the defect to one selector. Do NOT '
              || 'backfill a price from prose or default anything to clear this (§21/§22 — that '
              || 'fabricates a source fact); fix the selector and let the next crawl refill the rows, '
              || 'which works because the upsert preserves known-over-unknown.'));
    end if;
  end loop;

  -- Resolve on the EVALUATED path, from the keys THIS run re-affirmed (§25a). Never a second,
  -- independently-worded self-heal clause, and never after an early return.
  perform public.mon_resolve_stale_keys('detail_capture_collapse', live_keys);
  return n;
end
$function$;

comment on function public.mon_detect_detail_capture_collapse() is
'Detail-page parse collapse: freshly-crawled active rows carrying neither price nor description on a '
'table whose own history proves it captured both. Generalises mon_detect_summary_only_capture (which '
'is hardcoded to aqaratikom) over every platform table, residential AND commercial. '
'MEASURED COST 2026-09-03: ~1,109 ms over the full inventory (~70 tables) — read 1-2 s as normal and '
'10 s+ as a real regression. Found live on 2026-09-03: sadin_residential (73/74) and sadin_commercial '
'(10/10), broken since ~2026-08-14 by sadin''s detail-page redesign, where _description() still '
'targeted the pre-redesign <div class="property-description">/<div class="text"> while area_m2 kept '
'parsing fine from the redesigned <dt>/<dd> — proving the fetch worked and only one selector had died.';

-- Roster it in the SAME migration (§11a): a barrier nothing calls is decoration, and
-- mon_detect_orphaned_detectors() fires on any detector nothing reaches. Append ONE element to the
-- LIVE roster source rather than re-emitting the array from a snapshot — concurrent sessions edit
-- this function, and a wholesale CREATE OR REPLACE would silently drop another session's detector (§26).
do $roster$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to leave the detector unrostered';
  end if;

  if position('mon_detect_detail_capture_collapse' in src) > 0 then
    return;                                   -- already rostered
  end if;

  if position('''mon_detect_published_amenity_capture_collapse''' in src) = 0 then
    raise exception 'roster anchor not found - refusing to guess where to append';
  end if;

  newsrc := replace(src,
    '''mon_detect_published_amenity_capture_collapse''',
    '''mon_detect_published_amenity_capture_collapse'', ''mon_detect_detail_capture_collapse''');
  execute newsrc;

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_detail_capture_collapse' in src) = 0 then
    raise exception 'roster append did not take effect';
  end if;
end
$roster$;
