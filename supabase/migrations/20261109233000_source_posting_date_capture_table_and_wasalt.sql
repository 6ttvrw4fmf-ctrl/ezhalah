-- THE SITE'S OWN POSTING DATE ON STORED ROWS — wasalt, and a table of where each site's date was captured.
--
-- Owner 2026-11-09: «we need it solved» — every listing carries the date its SOURCE website says it was
-- posted, in `date_added`, the column every time-window welcome fact counts by (public.source_posted_at,
-- docs/ARCHITECTURE.md §20).
--
-- WASALT (92,079 active rows, every one with date_added NULL). The 2026-11-09 survey recorded it as
-- 'unknown' because the only date the scraper read was regaAdvLicDate, the REGA licence date. Read live
-- on 2026-11-09 (wasalt.sa search pages, __NEXT_DATA__ searchResult.properties): every property carries
-- `publishedAt` — the moment the ad went live, minutes after `createdAt` (the draft) — and `updatedAt`
-- (an edit). Our rows already ARCHIVE that payload in ar_data:
--   · 91,998 of 92,079 active residential rows hold a readable ar_data.publishedAt (86 of 89 commercial);
--   · 1 of them is later than our first sighting (scraped_at), 0 by more than 2 days, 0 in the future;
--   · it is what wasalt's own «تم اضافتها قبل N يوم» counts from: rows reading «قبل 59 يوم» sit at a
--     median 59.3 days between publishedAt and their capture, «قبل 141 يوم» at 141.5, «قبل 11 يوم» at 12.0;
--   · it does not move on an edit: 5966658 published 2026-10-31T10:19Z, updated 2026-11-03T13:04Z.
-- So publishedAt is wasalt's posting date. scrapers/wasalt/run.py now writes it on new rows; this fills the
-- stored ones from the archive, never from our own timestamps.
--
-- THE CAPTURE TABLE. public.ops_backfill_source_posting_date() (migration 20261109210500) kept its list of
-- (table, column, key) inside the function body, so every new site meant replacing the function. The list
-- moves to ops_source_posting_date_capture, seeded with the same eleven entries plus wasalt; a key is now a
-- jsonb PATH (several sites file the date one level down, e.g. source_capture → detail → publish_date), and
-- `zone` says how to read a zone-less stamp: 'as_published' (Saudi-local, what the reader assumes) or 'utc'
-- (the site's zone-less value is UTC, so it is re-expressed as the same instant in Saudi time).
-- Everything else is unchanged: at most 20,000 rows per call, the same three never-write rules the welcome
-- guard distrusts (later than first seen + 1 day, in the future, unreadable), and the PROOF — every written
-- value must read back as exactly the captured instant, or the call raises and rolls back.
--
-- Watched by mon_detect_source_posting_date_fill_regressed() (in the detector roster since 20261109211500):
-- wasalt becomes a 'yes' platform below, so NEW wasalt rows that stop carrying the date raise it.

create table if not exists public.ops_source_posting_date_capture (
  tbl   text not null,
  col   text not null check (col in ('additional_info', 'source_capture', 'ar_data')),
  path  text[] not null check (cardinality(path) between 1 and 4),
  zone  text not null default 'as_published' check (zone in ('as_published', 'utc')),
  note  text not null,
  primary key (tbl, col, path)
);
comment on table public.ops_source_posting_date_capture is
  'Where each listing site''s own posting date is already captured inside a stored row (jsonb column + path), so public.ops_backfill_source_posting_date() can fill date_added on rows stored before the scraper wrote it. zone = ''utc'': the site''s zone-less stamp is UTC. Never our own first-seen / scrape time, a licence date or an edit / bump date (docs/ARCHITECTURE.md §20).';
revoke all on table public.ops_source_posting_date_capture from public, anon, authenticated;
grant select, insert, update on table public.ops_source_posting_date_capture to service_role;

insert into public.ops_source_posting_date_capture (tbl, col, path, zone, note) values
  ('dealapp_residential_listings', 'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('dealapp_commercial_listings',  'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('arkaan_residential_listings',  'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('arkaan_commercial_listings',   'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('mustqr_residential_listings',  'additional_info', '{mustqr_created_at}', 'as_published', 'API created_at (20261109210500)'),
  ('mustqr_commercial_listings',   'additional_info', '{mustqr_created_at}', 'as_published', 'API created_at (20261109210500)'),
  ('therc_residential_listings',   'source_capture',  '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('therc_commercial_listings',    'source_capture',  '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('tawia_residential_listings',   'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('eydah_residential_listings',   'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('eydah_commercial_listings',    'additional_info', '{date_posted}',       'as_published', 'JSON-LD datePosted (20261109210500)'),
  ('wasalt_residential_listings',  'ar_data',         '{publishedAt}',       'as_published', 'search-list publishedAt, read live 2026-11-09 (ad 5966658)'),
  ('wasalt_commercial_listings',   'ar_data',         '{publishedAt}',       'as_published', 'search-list publishedAt, read live 2026-11-09 (ad 5966658)')
on conflict (tbl, col, path) do nothing;

create or replace function public.ops_backfill_source_posting_date(p_budget integer default 20000)
 returns table(tbl text, filled integer, rows_left bigint)
 language plpgsql
 set search_path to 'public'
as $function$
declare
  zoned   constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$';
  unzoned constant text := '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$';
  budget int := least(greatest(coalesce(p_budget, 0), 0), 20000);   -- the whole call, all tables together
  c record; raw text; v int; v_left bigint; v_bad bigint;
begin
  for c in select * from public.ops_source_posting_date_capture order by tbl, col, path loop
    if to_regclass('public.' || c.tbl) is null then
      raise exception '% does not exist — refusing to guess which table was meant', c.tbl;
    end if;

    -- The value as the site published it, with a UTC zone-less stamp made explicit («…Z»).
    raw := case when c.zone = 'utc'
                then format($r$(case when btrim(%1$s.%2$I #>> %3$L) ~ %4$L
                                     then replace(btrim(%1$s.%2$I #>> %3$L), ' ', 'T') || 'Z'
                                     else btrim(%1$s.%2$I #>> %3$L) end)$r$, '%1$s', c.col, c.path, unzoned)
                else format($r$btrim(%1$s.%2$I #>> %3$L)$r$, '%1$s', c.col, c.path)
           end;

    v := 0;
    if budget > 0 then
      -- One statement: write, then read back what was written and compare it with the capture.
      execute format($q$
        with w as (
          update public.%1$I u
             set date_added = case
                   when %2$s ~ %3$L
                     then to_char(public.source_posted_at(%2$s) at time zone 'Asia/Riyadh',
                                  'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00'
                   else %2$s
                 end
           where u.id in (
                   select s.id
                     from public.%1$I s
                    where s.date_added is null
                      and public.source_posted_at(%4$s) is not null
                      -- the same three things the welcome guard distrusts: never write one
                      and public.source_posted_at(%4$s) <= coalesce(s.scraped_at, now()) + interval '1 day'
                      and public.source_posted_at(%4$s) <= now()
                    order by s.id
                    limit %5$s
                      for update skip locked)
             and u.date_added is null
          returning u.date_added as written, %2$s as captured)
        select count(*),
               -- A stamp WITH a zone is written to the second, so its capture is compared to the second.
               -- Anything else is written as published (trimmed): it must read back as exactly the captured instant.
               count(*) filter (where public.source_posted_at(written) is null
                                   or public.source_posted_at(written)
                                      is distinct from case
                                        when captured ~ %3$L
                                          then date_trunc('second', public.source_posted_at(captured))
                                        else public.source_posted_at(captured)
                                      end)
          from w
      $q$, c.tbl, format(raw, 'u'), zoned, format(raw, 's'), budget) into v, v_bad;
      -- PROOF, every call: what was written must be readable and must be the captured instant.
      if v_bad > 0 then
        raise exception 'PROOF: % of the % rows written to % are not the captured site date — rolled back', v_bad, v, c.tbl;
      end if;
      budget := budget - v;
    end if;

    execute format($q$
      select count(*) from public.%1$I s
       where s.date_added is null
         and public.source_posted_at(%2$s) is not null
         and public.source_posted_at(%2$s) <= coalesce(s.scraped_at, now()) + interval '1 day'
         and public.source_posted_at(%2$s) <= now()
    $q$, c.tbl, format(raw, 's')) into v_left;

    tbl := c.tbl; filled := v; rows_left := v_left;
    return next;
  end loop;
end $function$;
comment on function public.ops_backfill_source_posting_date(integer) is
  'Fills date_added on stored rows from the site posting date already captured in the row (ops_source_posting_date_capture). At most 20,000 rows per call; never later than first seen + 1 day, never future; raises if a written value is not the captured instant. Call until every rows_left = 0.';
revoke all on function public.ops_backfill_source_posting_date(integer) from public, anon, authenticated;
grant execute on function public.ops_backfill_source_posting_date(integer) to service_role;

-- Wasalt publishes a posting date: watched from now on. 'expected' until the scraper fix has stored new rows.
insert into public.ops_source_posting_date_policy
  (platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on, evidence, proof_url)
values
  ('wasalt', 'yes', 'search-list publishedAt (never updatedAt, never propertyInfo.regaAdvLicDate)', 99, 'expected',
   '2026-11-09',
   'Read live 2026-11-09: every search-list property carries publishedAt. 91,998 of 92,079 active residential rows already archive it in ar_data (86 of 89 commercial); 1 is later than first seen. It matches wasalt''s own «تم اضافتها قبل N يوم» (59 → 59.3 days, 141 → 141.5). EXPECTED for new rows until the scraper fix has stored some; re-measure then.',
   'https://wasalt.sa/en/sale/search?propertyFor=sale&countryId=1&type=residential&propertyTypeData=apartment&page=1')
on conflict (platform) do update set
  publishes = excluded.publishes, read_from = excluded.read_from, baseline_fill_pct = excluded.baseline_fill_pct,
  baseline_basis = excluded.baseline_basis, measured_on = excluded.measured_on, evidence = excluded.evidence,
  proof_url = excluded.proof_url;

-- Named so the repair guard sees what watches this repair; returns 0 inside its 20 h gate.
select public.mon_detect_source_posting_date_fill_regressed();
