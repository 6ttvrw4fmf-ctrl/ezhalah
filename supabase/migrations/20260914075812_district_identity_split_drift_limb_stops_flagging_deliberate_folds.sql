-- mon_detect_district_identity_split()'s stored-norm drift limb asserts, over every row of
-- loc_display_district_canon, that district_norm = norm_district_tok(display_ar).
--
-- refresh_loc_display_district_canon() deliberately writes rows where that does NOT hold. Its
-- insert is guarded by `where is_fold or norm_district_tok(display_ar) = tok` — the `is_fold` arm
-- exists precisely to admit a row whose TOKEN is the numbered/variant spelling while its
-- DISPLAY_AR is the bare parent label ('عليا 1' -> 'حي العليا'), which is the owner's 2026-09-12
-- "one place = one token per city" fold. So the limb contradicts the refresh function it is
-- supposed to be watching, and every refresh re-creates the rows it objects to.
--
-- Measured 2026-09-14 (routine-3): all 24 flagged rows are intentional folds — 11 carry an explicit
-- loc_district_number_override row, 13 have a display_ar that IS that city's official catalog
-- district. ZERO unexplained. The alert has stood P1 since 2026-09-13 20:29 over correct data, and
-- because mon_raise() dedups on an open key, it was also suppressing any GENUINE
-- district_identity_split from ever being raised — the standing hazard AGENTS.md names ("an
-- all-zero sweep can sit on top of open alerts").
--
-- This does NOT weaken the limb. For a fold row the comparison was structurally meaningless in both
-- directions: district_norm is the variant's token and display_ar is a DIFFERENT string (the
-- parent), so the equality could never hold no matter how healthy the data or the fold function.
-- Non-fold rows keep the full check, exactly as the refresh's own `where` clause requires of them.
-- The limb goes from "always true" to one that can actually say NO.
--
-- Needle-edited rather than retyped so a concurrent edit to this detector fails LOUDLY instead of
-- being silently clobbered by a hand-rewritten body.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_detect_district_identity_split'::regproc) into src;
  new_src := replace(src,
$old$    + (select count(*) from public.loc_display_district_canon
      where district_norm is distinct from public.norm_district_tok(display_ar))$old$,
$new$    + (select count(*) from public.loc_display_district_canon d
      where d.district_norm is distinct from public.norm_district_tok(d.display_ar)
        -- an INTENTIONAL fold is not drift: refresh_loc_display_district_canon()'s `is_fold` arm
        -- writes the variant's token against the parent's label on purpose. Either an explicit
        -- override says so, or display_ar is that city's own official catalog district.
        and not exists (select 1 from public.loc_district_number_override o
                         where o.city_id = d.city_id and o.district_norm = d.district_norm)
        and not exists (select 1 from public.loc_catalog_district c
                         where c.city_id = d.city_id and c.district_ar = d.display_ar))$new$);
  if new_src = src then
    raise exception 'district_identity_split drift limb not found in its expected shape — aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it: green now (the 24 folds no longer count), the standing false P1 clears, and the limb is
-- still CAPABLE of red — a genuinely drifted non-fold row must still be counted.
do $verify$
declare
  raised int;
  v_still_open int;
  v_drift_folds int;
  v_drift_real int;
begin
  select count(*) into v_drift_folds
    from public.loc_display_district_canon d
   where d.district_norm is distinct from public.norm_district_tok(d.display_ar);
  if v_drift_folds = 0 then
    raise exception 'expected the fold rows to still exist (they are correct); found none';
  end if;

  select count(*) into v_drift_real
    from public.loc_display_district_canon d
   where d.district_norm is distinct from public.norm_district_tok(d.display_ar)
     and not exists (select 1 from public.loc_district_number_override o
                      where o.city_id = d.city_id and o.district_norm = d.district_norm)
     and not exists (select 1 from public.loc_catalog_district c
                      where c.city_id = d.city_id and c.district_ar = d.display_ar);
  if v_drift_real <> 0 then
    raise exception 'still % genuinely-drifted non-fold display row(s) — this migration does not cover them', v_drift_real;
  end if;

  select public.mon_detect_district_identity_split() into raised;
  if raised <> 0 then
    raise exception 'detector still raising after the fold exclusion (%)', raised;
  end if;

  select count(*) into v_still_open from public.alert_event
   where kind = 'district_identity_split' and resolved_at is null;
  if v_still_open <> 0 then
    raise exception 'the standing false P1 did not clear (% still open)', v_still_open;
  end if;

  -- mutation: a real non-fold drift row must make it red again
  insert into public.loc_display_district_canon (city_id, district_norm, display_ar, from_catalog, refreshed_at)
  values (-999, 'zzz-mutation-token', 'حي كذا', false, now());

  select public.mon_detect_district_identity_split() into raised;
  if raised = 0 then
    delete from public.loc_display_district_canon where city_id = -999;
    raise exception 'MUTATION SURVIVED: a genuinely drifted non-fold row did not raise';
  end if;

  delete from public.loc_display_district_canon where city_id = -999;
  perform public.mon_resolve_key('district_identity_split','district_identity_split');

  select public.mon_detect_district_identity_split() into raised;
  if raised <> 0 then
    raise exception 'detector did not return to green after the mutation was removed';
  end if;
end $verify$;
