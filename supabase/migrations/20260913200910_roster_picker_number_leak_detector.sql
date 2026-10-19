-- Rosters mon_detect_picker_number_leak() into mon_run_all_detectors(). Idempotent needle-edit
-- against the LIVE definition (never the git copy, which goes stale as other sessions append):
-- it refuses to run if the anchor moved, rather than silently clobbering someone else's entry.
do $$
declare src text; out_def text; anchor text := '''mon_detect_amlakalahsa_district_consolidation_regressed''
  ];';
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_picker_number_leak' in src) > 0 then
    return;
  end if;
  if position(anchor in src) = 0 then
    raise exception 'roster tail changed shape — needle not found; re-anchor before editing';
  end if;
  out_def := replace(src, anchor,
    '''mon_detect_amlakalahsa_district_consolidation_regressed'',
    ''mon_detect_picker_number_leak''
  ];');
  execute out_def;
end $$;

do $verify$
begin
  if position('mon_detect_picker_number_leak' in
              pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'mon_detect_picker_number_leak did not land in the detector roster';
  end if;
end $verify$;