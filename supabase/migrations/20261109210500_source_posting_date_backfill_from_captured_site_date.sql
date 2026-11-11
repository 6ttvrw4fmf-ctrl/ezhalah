-- THE SITE'S OWN POSTING DATE, COPIED INTO date_added WHERE THE SCRAPER HAD CAPTURED IT BUT NEVER WROTE IT
-- (owner 2026-11-09: «get their date, it's a must … our fast check relies on that date, not ours»).
--
-- date_added is what every time-window welcome fact counts by, through public.source_posted_at(text) (migration
-- 20261026122758, docs/ARCHITECTURE.md §20). Eleven tables held the site's date inside the row's capture and left
-- date_added NULL, so those ads were in no window at all. The scrapers are fixed in the same PR
-- (scrapers/common/posting_date.py); this fills the rows already stored.
--
-- The value written is exactly what site_posting_date() writes for the same input, so a row filled here and a row
-- filled by the next crawl read the same:
--   · a stamp with a zone («…Z», «+00:00», «+03:00») → the SAME INSTANT in Saudi time, «YYYY-MM-DDTHH:MM:SS+03:00»
--     (the card prints the day textually, so a UTC stamp would show the day before for an ad posted after midnight);
--   · «YYYY-MM-DD» → kept as published.
-- Never our own first_seen_at / scraped_at, never a licence date, never a bump or «last updated» date. A captured value
-- public.source_posted_at() cannot read is left alone: unknown stays NULL.
--
-- BEFORE-COUNTS, read-only on production 2026-11-09. «fill» = date_added NULL and a captured, readable site date.
--   table                          captured in                              fill, ACTIVE rows   fill, ALL rows
--   dealapp_residential_listings   additional_info->>'date_posted'                    55,566           71,332
--   dealapp_commercial_listings    additional_info->>'date_posted'                     2,732            3,419
--   arkaan_residential_listings    additional_info->>'date_posted'                     1,628            2,089
--   arkaan_commercial_listings     additional_info->>'date_posted'                       334              404
--   mustqr_residential_listings    additional_info->>'mustqr_created_at'               1,062            1,399
--   mustqr_commercial_listings     additional_info->>'mustqr_created_at'                 300              344
--   therc_residential_listings     source_capture->>'date_posted'                        447              447
--   therc_commercial_listings      source_capture->>'date_posted'                         10               10
--   tawia_residential_listings     additional_info->>'date_posted'                         4               10
--   eydah_residential_listings     additional_info->>'date_posted'                         1                1
--   eydah_commercial_listings      additional_info->>'date_posted'                         1                1
--                                                                                     62,085           79,456
-- Not here — nothing captured, only a re-crawl with the scraper fix fills them: aqarcity (676 active), sakan (2,377 active).
--
-- BATCHES (docs/ops/FALCON_ENGINEER.md: row repairs at most 25,000 per batch). The work is a FUNCTION, so each call is
-- its own bounded transaction and answers with rows: at most 20,000 rows per call, all tables together. This migration
-- makes ONE call; the rest are `select * from public.ops_backfill_source_posting_date();` until rows_left is 0
-- everywhere. Safe to repeat and safe to stop half-way: it only touches rows whose date_added is still NULL, skips rows
-- a crawl holds mid-upsert, and raises (rolling the call back) if a written value is not the captured instant.
-- The function stays: it is the mop-up for rows stored between this fill and the fixed scrapers' first crawl.
-- Standing watch: mon_detect_source_posting_date_fill_regressed() (same PR) alarms when a site that publishes a date
-- stops getting it stored on new rows.

create or replace function public.ops_backfill_source_posting_date(p_budget integer default 20000)
 returns table (tbl text, filled integer, rows_left bigint)
 language plpgsql
 set search_path = public
as $function$
declare
  -- (table, the jsonb column holding the capture, the key inside it)
  spec constant text[][] := array[
    ['dealapp_residential_listings', 'additional_info', 'date_posted'],
    ['dealapp_commercial_listings',  'additional_info', 'date_posted'],
    ['arkaan_residential_listings',  'additional_info', 'date_posted'],
    ['arkaan_commercial_listings',   'additional_info', 'date_posted'],
    ['mustqr_residential_listings',  'additional_info', 'mustqr_created_at'],
    ['mustqr_commercial_listings',   'additional_info', 'mustqr_created_at'],
    ['therc_residential_listings',   'source_capture',  'date_posted'],
    ['therc_commercial_listings',    'source_capture',  'date_posted'],
    ['tawia_residential_listings',   'additional_info', 'date_posted'],
    ['eydah_residential_listings',   'additional_info', 'date_posted'],
    ['eydah_commercial_listings',    'additional_info', 'date_posted']
  ];
  zoned  constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$';
  budget int := least(greatest(coalesce(p_budget, 0), 0), 20000);   -- the whole call, all tables together
  i int; t text; col text; k text; v int; v_left bigint; v_bad bigint;
begin
  for i in 1 .. array_length(spec, 1) loop
    t := spec[i][1]; col := spec[i][2]; k := spec[i][3];
    if to_regclass('public.' || t) is null then
      raise exception '% does not exist — refusing to guess which table was meant', t;
    end if;

    v := 0;
    if budget > 0 then
      -- One statement: write, then read back what was written and compare it with the capture.
      execute format($q$
        with w as (
          update public.%1$I u
             set date_added = case
                   when btrim(u.%2$I->>%3$L) ~ %4$L
                     then to_char(public.source_posted_at(u.%2$I->>%3$L) at time zone 'Asia/Riyadh',
                                  'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00'
                   else btrim(u.%2$I->>%3$L)
                 end
           where u.id in (
                   select s.id
                     from public.%1$I s
                    where s.date_added is null
                      and public.source_posted_at(s.%2$I->>%3$L) is not null
                      -- the same three things the welcome guard distrusts: never write one
                      and public.source_posted_at(s.%2$I->>%3$L) <= coalesce(s.scraped_at, now()) + interval '1 day'
                      and public.source_posted_at(s.%2$I->>%3$L) <= now()
                    order by s.id
                    limit %5$s
                      for update skip locked)
             and u.date_added is null
          returning u.date_added as written, u.%2$I->>%3$L as captured)
        select count(*),
               count(*) filter (where public.source_posted_at(written) is null
                                   or public.source_posted_at(written)
                                      is distinct from date_trunc('second', public.source_posted_at(captured)))
          from w
      $q$, t, col, k, zoned, budget) into v, v_bad;
      -- PROOF, every call: what was written must be readable and must be the captured instant.
      if v_bad > 0 then
        raise exception 'PROOF: % of the % rows written to % are not the captured site date — rolled back', v_bad, v, t;
      end if;
      budget := budget - v;
    end if;

    execute format($q$
      select count(*) from public.%1$I s
       where s.date_added is null
         and public.source_posted_at(s.%2$I->>%3$L) is not null
         and public.source_posted_at(s.%2$I->>%3$L) <= coalesce(s.scraped_at, now()) + interval '1 day'
         and public.source_posted_at(s.%2$I->>%3$L) <= now()
    $q$, t, col, k) into v_left;

    tbl := t; filled := v; rows_left := v_left;
    return next;
  end loop;
end $function$;
comment on function public.ops_backfill_source_posting_date(integer) is
  'Copies the listing site''s own posting date, already captured in the row, into date_added where date_added is NULL. At most 20,000 rows per call, all tables together; answers one row per table (filled, rows_left). Raises if a written value is not the captured instant. Never writes our own first_seen_at / scraped_at. Watched by mon_detect_source_posting_date_fill_regressed().';
revoke all on function public.ops_backfill_source_posting_date(integer) from public, anon, authenticated;
grant execute on function public.ops_backfill_source_posting_date(integer) to service_role;

-- The first bounded call. The others are made one at a time, each when the database is quiet.
do $$
declare r record; total int := 0; left_all bigint := 0;
begin
  for r in select * from public.ops_backfill_source_posting_date() loop
    total := total + r.filled; left_all := left_all + r.rows_left;
    raise notice '%: filled % rows, % rows left', r.tbl, r.filled, r.rows_left;
  end loop;
  if total > 25000 then
    raise exception 'this call changed % rows, over the 25,000 batch rule — rolled back', total;
  end if;
  raise notice 'TOTAL: filled % rows, % rows left', total, left_all;
end $$;
