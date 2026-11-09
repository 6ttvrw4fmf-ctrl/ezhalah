-- PREPARED, NOT APPLIED. Nothing in this file has been run against production (2026-11-09).
-- It lives in docs/ops/pending/ and NOT in supabase/migrations/ on purpose: a file there claims a migration was applied.
--
-- WHAT IT DOES
-- Copies the listing SITE'S OWN posting date, which these scrapers already captured in the row, into date_added —
-- ONLY where date_added is NULL. date_added is what every time-window welcome fact counts by, through
-- public.source_posted_at(text) (migration 20261026122758, docs/ARCHITECTURE.md §20). Until it is filled these ads are
-- in no window at all.
--
-- The value written is exactly what scrapers/common/posting_date.py site_posting_date() writes for the same input, so a
-- row filled here and a row filled by the next crawl read the same:
--   · a stamp with a zone («…Z», «+00:00», «+03:00») → the SAME INSTANT written in Saudi time, «YYYY-MM-DDTHH:MM:SS+03:00»
--     (the card prints the day textually, so a UTC stamp would show the day before for an ad posted after midnight);
--   · «YYYY-MM-DD» → kept as published.
-- Never our own first_seen_at / scraped_at, never a licence date, never a bump or «last updated» date. A captured value
-- public.source_posted_at() cannot read is left alone: unknown stays NULL.
--
-- BEFORE-COUNTS, measured read-only on production 2026-11-09 (pg_stat_activity quiet: 0 active authenticator queries).
-- «fill» = rows with date_added NULL AND a captured site date public.source_posted_at() reads.
--
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
--                                                                              ------------     ------------
--                                                                                     62,085           79,456
--
-- On every one of those rows, measured the same day: 0 captured values unreadable, 0 posted later than
-- scraped_at + 1 day, 0 in the future — the three things welcome_posting_date_check (20261028033700) distrusts a table
-- for. A 3 % sample of dealapp and every row of the other tables was run through the expression below: the instant
-- never moved and the written day always equalled the Saudi day of the captured stamp.
--
-- NOT IN THIS FILE — nothing captured, so there is nothing to copy; only a re-crawl with the scraper fix fills them:
--   aqarcity  602 residential + 74 commercial active rows with date_added NULL (862 + 86 all rows)
--   sakan   2,227 residential + 150 commercial active rows with date_added NULL (3,184 + 156 all rows)
--
-- BATCHES (docs/ops/FALCON_ENGINEER.md: row repairs at most 25,000 per batch)
-- One run of this file fills at most 20,000 rows IN TOTAL and stops. Run it again until it reports «0 rows left»:
-- 79,456 rows → 4 runs. Each run is its own transaction. It is safe to re-run and safe to stop half-way: it only ever
-- touches rows whose date_added is still NULL. Rows another session holds (a crawl mid-upsert) are skipped, not waited
-- on, and are picked up by the next run.
--
-- BEFORE EACH RUN: check pg_stat_activity (active authenticator queries > 8, or any query running > 5 s → wait).
-- This is a data repair, not a schema change. If it is applied through apply_migration, each run is its own migration
-- and each needs its byte-exact mirror in supabase/migrations/ (AGENTS.md «Migration drift guard»).

do $$
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
  budget int := 20000;          -- the whole run, all tables together
  i int; t text; col text; k text; v int; v_left bigint; v_bad bigint; total int := 0; left_all bigint := 0;
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
      -- PROOF, every run: what was written must be readable and must be the captured instant.
      if v_bad > 0 then
        raise exception 'PROOF: % of the % rows written to % are not the captured site date — rolled back', v_bad, v, t;
      end if;
      budget := budget - v;
      total := total + v;
    end if;

    execute format($q$
      select count(*) from public.%1$I s
       where s.date_added is null
         and public.source_posted_at(s.%2$I->>%3$L) is not null
         and public.source_posted_at(s.%2$I->>%3$L) <= coalesce(s.scraped_at, now()) + interval '1 day'
         and public.source_posted_at(s.%2$I->>%3$L) <= now()
    $q$, t, col, k) into v_left;
    left_all := left_all + v_left;

    raise notice '%: filled % rows this run, % rows left', t, v, v_left;
  end loop;

  if total > 25000 then
    raise exception 'this run would change % rows, over the 25,000 batch rule — rolled back', total;
  end if;
  raise notice 'TOTAL: filled % rows this run, % rows left. %', total, left_all,
    case when left_all = 0 then 'Done.' else 'Run this file again.' end;
end $$;
