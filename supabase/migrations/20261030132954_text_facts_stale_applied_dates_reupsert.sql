-- mon_detect_text_facts, check 2 (text_facts_stale_applied): date an ad's last change by the column
-- that MOVES on a re-upsert.
--
-- The check asks «did this ad's text change before the last text_facts_mark_stale() pass, and do its
-- old facts still apply?». It excluded ads changed after the marker with `x.scraped_at < marker - 15 min`.
-- scraped_at is the INSERT default and never moves on a re-upsert (AGENTS.md, 2026-09-18 lesson);
-- last_seen_at is the column that moves. So every ad the crawl re-wrote between the :22 marker pass
-- and the 11:52 detector run read as «stale fact still applied» although the marker had not yet had
-- a chance to see it. Measured 2026-10-30 (alert 12171, P1, 25 rows, aqar + abralosol): 25 of the 26
-- rows the 12:22 pass marked stale had last_seen_at 11:28–11:30 (after the 11:22 marker) and scraped_at
-- from June–August. With greatest(scraped_at, last_seen_at) the same rows count 0 under the new
-- predicate on production. All 249 source tables holding text facts carry both columns.
--
-- Mechanics: the live definition is edited in place (one predicate), so the migration cannot drift from
-- a stale copy of the function. It fails loudly if the predicate it expects is not there.
do $$
declare d text; before text := 'x.scraped_at < $1'; after text := 'greatest(x.scraped_at, coalesce(x.last_seen_at, x.scraped_at)) < $1';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_text_facts';
  if d is null then raise exception 'mon_detect_text_facts not found'; end if;
  if position(before in d) = 0 then raise exception 'mon_detect_text_facts: predicate % not found — read the live function before re-applying', before; end if;
  if position(after in d) > 0 then raise exception 'mon_detect_text_facts: already dates by last_seen_at'; end if;
  d := replace(d, before, after);
  execute d;
end $$;

-- the predicate now reads the moving column (fails the migration otherwise)
do $$
begin
  if position('greatest(x.scraped_at, coalesce(x.last_seen_at, x.scraped_at)) < $1' in
       (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'mon_detect_text_facts')) = 0
  then raise exception 'mon_detect_text_facts: the last_seen_at predicate did not land'; end if;
end $$;