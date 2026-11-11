-- THE TWO POSTING-DATE DETECTORS NAME THE KIND THEY CLEAR, so the stale-alert watcher can see that they do.
--
-- mon_detect_unresolvable_alert_kinds() counts a kind as clearable only when some function calls a resolver with
-- that kind written out as a literal (mon_resolve_key / mon_resolve / mon_resolve_stale_keys('<kind>', …)).
-- mon_detect_source_posting_date_fill_regressed() and mon_detect_shared_posting_stamp() both clear their own alerts
-- every run, but through mon_resolve_stale_keys(k, live) with the kind in a constant, which the watcher cannot read.
-- Measured 2026-11-10: alert 14066 `unresolvable_alert_kind:source_posting_date_fill_regressed` (P2) open since
-- 2026-11-09 21:59Z over 14058 (aqarcity — now 2,190 of 2,190 dated after the night's crawl) and 14059 (sakan).
-- shared_posting_stamp would raise the same the first time it holds an alert.
--
-- The fix writes the kind out in each call. Behaviour does not change: k already held exactly this text. 14058 /
-- 14059 close on the detector's next full run (20 h gate, from 2026-11-09 21:07Z) if their site is dated by then;
-- 14066 closes on the next sweep, when the watcher re-reads these definitions.

do $$
declare
  fn  text;
  knd text;
  src text;
  out_def text;
begin
  for fn, knd in
    select * from (values
      ('public.mon_detect_source_posting_date_fill_regressed()', 'source_posting_date_fill_regressed'),
      ('public.mon_detect_shared_posting_stamp()',               'shared_posting_stamp')) v
  loop
    src := pg_get_functiondef(fn::regprocedure);
    if src ~ ('mon_resolve_stale_keys\s*\(\s*''' || knd || '''') then
      raise notice '% already names %', fn, knd;
      continue;
    end if;
    out_def := replace(src, 'perform public.mon_resolve_stale_keys(k, live);',
                            format('perform public.mon_resolve_stale_keys(%L, live);', knd));
    if out_def = src then
      raise exception '% : resolver anchor not found — refusing to guess', fn;
    end if;
    execute out_def;
  end loop;
end $$;

-- Proof, by the watcher's own pattern: both kinds now read as clearable.
do $$
begin
  if pg_get_functiondef('public.mon_detect_source_posting_date_fill_regressed()'::regprocedure)
       !~ 'mon_resolve_stale_keys\s*\(\s*''source_posting_date_fill_regressed'''
  or pg_get_functiondef('public.mon_detect_shared_posting_stamp()'::regprocedure)
       !~ 'mon_resolve_stale_keys\s*\(\s*''shared_posting_stamp'''
  then
    raise exception 'a posting-date detector still hides the kind it resolves';
  end if;
end $$;
