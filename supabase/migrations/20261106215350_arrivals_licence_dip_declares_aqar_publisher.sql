-- Guard for blind spot 1356 (new-listings engineer, 2026-11-06). arrivals_pin_licence_coverage() raised a licence dip
-- only against a platform's OWN previous 7 days, so aqar — 0 % licence on every day since at least 2026-10-26 while
-- every page carries one (payload listing.ad_license_number, CI re-read 42298616610) — could never fire: zero is
-- never "half of" zero. Declare the platforms PROVEN to publish the REGA ad licence on every ad; their arrivals
-- (>= 50 in 24 h) serving it on under half is a capture bug, whatever yesterday looked like. Needle edits only.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.arrivals_pin_licence_coverage()'::regprocedure);
  d2 := replace(d,
    $o$g.arrivals >= 50 and g.prior_n >= 50 and g.lic_pct_7d >= 90 and g.lic_pct < g.lic_pct_7d / 2 as lic_dip$o$,
    $n$g.arrivals >= 50 and ((g.prior_n >= 50 and g.lic_pct_7d >= 90 and g.lic_pct < g.lic_pct_7d / 2)
                                 -- platforms proven to publish the licence on every ad (aqar: 2026-11-06, 1356)
                                 or (g.platform = any (array['aqar']) and coalesce(g.lic_pct, 0) < 50)) as lic_dip$n$);
  if d2 = d then raise exception 'needle not found in arrivals_pin_licence_coverage'; end if;
  execute d2;

  d := pg_get_functiondef('public.mon_detect_arrivals_pin_or_licence_dip()'::regprocedure);
  d2 := replace(d,
    $o$Never geocode, never lower a floor to clear this.'$o$,
    $n$Never geocode, never lower a floor to clear this. A platform declared as publishing the licence on every ad '
            || '(aqar: payload listing.ad_license_number, 1356) that serves it on under half its arrivals is a capture bug.'$n$);
  if d2 = d then raise exception 'needle not found in mon_detect_arrivals_pin_or_licence_dip'; end if;
  execute d2;
end $mig$;

-- Check block: EXECUTE the predicate. aqar's arrivals carry 0 licences today, so it must be flagged now.
do $chk$
declare v boolean;
begin
  select lic_dip into v from public.arrivals_pin_licence_coverage() where platform = 'aqar';
  if v is distinct from true then
    raise exception 'aqar (0 %% licence on its arrivals) is not flagged by arrivals_pin_licence_coverage(): %', v;
  end if;
  if pg_get_functiondef('public.mon_detect_arrivals_pin_or_licence_dip()'::regprocedure) not like '%1356%' then
    raise exception 'detector text not updated';
  end if;
end $chk$;
