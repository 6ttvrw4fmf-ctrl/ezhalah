-- scraper_early_warning(): one OPEN backlog row per site, and «absent» means no run in 26 h, not 20.
--
-- Measured 2026-10-30 (🔧): ⚡'s queue held 163 open early-warning rows for 76 sites. (1) The dedup
-- clause keyed the row on TODAY's date («early-warning <site> <YYYY-MM-DD>…»), so a site that stays
-- red gets a new open row every morning: 81 of the 163 were older duplicates of a newer open row.
-- (2) The ABSENT branch asked «no scrape_runs row in the last 20 h» at 07:45 UTC, but the nightly
-- small-sources crawl now runs past 07:45 (its matrix reached the last sites at 10:56 on 10-30), so
-- 67 of the 68 newest «no run recorded in 20 h» rows named a site that ran within 26 h of the row,
-- 55 of them later the same morning. A daily crawl is absent when a full day and a margin have
-- passed: 26 h. The FAILED branch (a run that reported not ok in the last 20 h) and the 8-day
-- baseline window are unchanged.
--
-- Mechanics: the live definition is edited in place; the migration fails loudly if any expected
-- text is missing, and asserts the new text landed.
do $$
declare d text; r record;
  edits text[][] := array[
    ['b.item like ''early-warning '' || l.platform || '' '' || to_char(now() at time zone ''utc'', ''YYYY-MM-DD'') || ''%''',
     'b.status = ''open'' and b.item like ''early-warning '' || l.platform || '' %'''],
    ['b.item like ''early-warning '' || g.platform || '' '' || to_char(now() at time zone ''utc'', ''YYYY-MM-DD'') || ''%''',
     'b.status = ''open'' and b.item like ''early-warning '' || g.platform || '' %'''],
    ['and not exists (select 1 from scrape_runs r where r.platform = g.platform and r.started_at > now() - interval ''20 hours'')',
     'and not exists (select 1 from scrape_runs r where r.platform = g.platform and r.started_at > now() - interval ''26 hours'')'],
    ['''no run recorded in 20 h — the job died before it registered (DNS / connect error before begin_run?)''',
     '''no run recorded in 26 h — the job died before it registered (DNS / connect error before begin_run?)''']
  ];
  i int;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'scraper_early_warning';
  if d is null then raise exception 'scraper_early_warning not found'; end if;
  for i in 1..array_length(edits, 1) loop
    if position(edits[i][1] in d) = 0 then
      raise exception 'scraper_early_warning: expected text #% not found — read the live function before re-applying', i;
    end if;
    d := replace(d, edits[i][1], edits[i][2]);
  end loop;
  execute d;
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'scraper_early_warning';
  for i in 1..array_length(edits, 1) loop
    if position(edits[i][2] in d) = 0 then raise exception 'scraper_early_warning: edit #% did not land', i; end if;
  end loop;
  if position('YYYY-MM-DD'') || ''%''' in d) > 0 then raise exception 'scraper_early_warning: a per-day dedup clause survived'; end if;
end $$;