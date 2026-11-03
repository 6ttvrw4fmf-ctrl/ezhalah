-- quarantine_growth is routed to the capture lane, not liveness (🔧 2026-11-02, backlog 1190 → 1205).
-- Measured: ramzalqasim (43) and erapulse (22) quarantine_growth rows all have raw city NULL at capture while the
-- source page states the city (erapulse <title> «… للبيع في بريدة», ramzalqasim text «في وسط عنيزة»); their
-- unready_unreachable is 0, nothing is dead. The alert had sat in lifecycle's queue since 2026-08-11 because the
-- kind matched the liveness family. The kind now routes to scraping-engineer, whose job it is.
do $$
declare
  src text := pg_get_functiondef('public.ops_engineer_for_alert'::regproc);
  needle text := '|adjudicated_reactivation|quarantine_growth|prune_|';
begin
  if position(needle in src) = 0 then
    raise exception 'ops_engineer_for_alert: expected text % not found — re-read the live function before applying', needle;
  end if;
  src := replace(src, needle, '|adjudicated_reactivation|prune_|');
  src := replace(src, 'when p_kind ~ ''^(scrape_suspect|source_shows_small_total)$'' then ''scraping-engineer''',
                      'when p_kind ~ ''^(scrape_suspect|source_shows_small_total|quarantine_growth)$'' then ''scraping-engineer''');
  if position('source_shows_small_total|quarantine_growth' in src) = 0 then
    raise exception 'ops_engineer_for_alert: the scraping branch did not take quarantine_growth';
  end if;
  execute src;
end $$;