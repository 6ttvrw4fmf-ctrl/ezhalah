-- run_field_range alerts could never close (unresolvable_alert_kind:run_field_range, open since
-- 2026-08-21; 4 open, oldest 2026-08-11). mon_check_run_field_ranges() is called once per scrape run
-- for the rows THAT run touched and raises run_field_range:<table> when the slice is degraded — but a
-- later run of the same table whose slice evaluates clean said nothing, so a one-night regression
-- stayed lit forever. It now resolves the table's key on the SAME evaluation when that run's slice
-- was evaluated (n > 0) and found clean. A run that touched nothing still returns early and clears
-- nothing (an absent measurement is not a clean one). Needle edit: exactly one match asserted, the
-- live body re-read afterwards.
do $mig$
declare
  v_def text := pg_get_functiondef('public.mon_check_run_field_ranges(bigint,text,text,timestamp with time zone,text[])'::regprocedure);
  v_needle constant text := E'  end if;\n\n  return degraded;';
  v_new constant text := E'  else\n    -- 2026-11-02: a clean, evaluated run of the same table clears that table''s open alert.\n    perform public.mon_resolve_key(''run_field_range'', ''run_field_range:''||p_table);\n  end if;\n\n  return degraded;';
  v_hits int := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  v_after text;
begin
  if v_hits <> 1 then
    raise exception 'expected 1 match for the closing block of mon_check_run_field_ranges, found %', v_hits;
  end if;
  execute replace(v_def, v_needle, v_new);
  v_after := pg_get_functiondef('public.mon_check_run_field_ranges(bigint,text,text,timestamp with time zone,text[])'::regprocedure);
  if position('mon_resolve_key(''run_field_range''' in v_after) = 0 then
    raise exception 'resolve branch missing after rewrite';
  end if;
  if position('perform public.mon_raise(worst_sev, ''run_field_range''' in v_after) = 0 then
    raise exception 'rewrite dropped the raise';
  end if;
end
$mig$;