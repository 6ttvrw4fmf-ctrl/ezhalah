-- REPAIR: 272 of 276 عقاريون listings carried street_width_m = 3 — a number Ezhalah invented.
--
-- Every akariyoun.sa listing page also renders the site's own AD-CREATION FORM, whose markup
-- contains the literal «الشارع 3 اختيار من الخريطة يرجى اختيار نوع الإعلان الذي تريد إنشاؤه».
-- scrapers/akariyoun/run.py fell back to a bare «شارع N» match over the whole page text, so it
-- read that form default on 40 of 40 sampled pages and stored 3 as the property's street width —
-- including listings whose own «عرض الشارع» publishes 15, 20 or 36.
--
-- The published field is «عرض الشارع», and it prints «-» when the seller withheld it (33 of 60
-- sampled pages). The parser now reads only that field and stores NULL for the dash.
--
-- WHY EVERY ROW, NOT JUST THE 3s. The four rows holding 10/10/10/11 came from the SAME discredited
-- fallback matching a boundary description («الحد الغربي شارع 10»), which is a boundary, not the
-- street's width. No current value was read from the field that means what the column means, so
-- none of them is evidence. NULL is the honest state; the next sweep repopulates ~35% of them from
-- «عرض الشارع» and correctly leaves the rest unknown.
--
-- WHY A MIGRATION. _unknown_must_not_overwrite_known() drops a None key from an upsert (owner rule
-- 2026-08-09) so a failed fetch can never erase stored data. That guard is right and stays — it
-- simply means the scraper can never retract a value it once got wrong.
update public.akariyoun_residential_listings set street_width_m = NULL where street_width_m is not null;
update public.akariyoun_commercial_listings  set street_width_m = NULL where street_width_m is not null;

-- Guards the repair above. The form default is a CONSTANT (3) on every page, so the signature of a
-- regression is unmistakable: many listings sharing one small width. A genuine street width is
-- published per-listing and varies (10,12,14,15,18,20,30,100 in the live sample).
create or replace function public.mon_detect_akariyoun_street_width_is_form_chrome()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; v_rows jsonb; v_max bigint; v_tot bigint; v_open text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('street_width_m', w, 'listings', c) order by c desc), '[]'::jsonb),
         max(c), sum(c)
    into v_rows, v_max, v_tot
  from (select street_width_m w, count(*) c
          from (select street_width_m from public.akariyoun_residential_listings where active and street_width_m is not null
                union all
                select street_width_m from public.akariyoun_commercial_listings  where active and street_width_m is not null) z
         group by 1) g;

  select severity into v_open from public.alert_event
   where dedup_key = 'akariyoun_street_width_is_form_chrome' and resolved_at is null
   order by created_at desc limit 1;

  -- A single width on more than 60% of the rows that have one, over a meaningful sample, is the
  -- form-chrome signature. Below that it is ordinary repetition on a small platform.
  if v_tot is null or v_tot < 20 or v_max::numeric / v_tot < 0.60 then
    if v_open is not null then
      perform public.mon_resolve_key('akariyoun_street_width_is_form_chrome',
                                     'akariyoun_street_width_is_form_chrome');
    end if;
    return 0;
  end if;

  n := public.mon_raise('P2', 'akariyoun_street_width_is_form_chrome', 'akariyoun',
    'akariyoun_street_width_is_form_chrome',
    jsonb_build_object(
      'rows_with_width', v_tot,
      'distribution', v_rows,
      'why', 'One street width dominates عقاريون''s listings. Every akariyoun.sa listing page also '
          || 'renders the site''s ad-creation form, which contains the literal «الشارع 3»; a parser '
          || 'that reads the page broadly picks that up and stores one constant for every property. '
          || 'That is exactly what 20260919 repaired — 272 of 276 rows held 3.',
      'adjudicate', 'Re-read «عرض الشارع» on the listing page itself — that is the published field, '
          || 'and it prints «-» when withheld. Confirm parse in scrapers/akariyoun/run.py still '
          || 'matches ONLY «عرض الشارع» and has not regained a bare «شارع N» fallback. Genuine '
          || 'widths vary per listing (10,12,14,15,18,20,30,100 observed live 2026-09-19).'));
  return n;
end
$function$;

do $roster$
declare d text;
begin
  d := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_akariyoun_street_width_is_form_chrome' in d) > 0 then
    return;
  end if;
  if position($anchor$'mon_detect_akariyoun_open_bound_age_reappears'$anchor$ in d) = 0 then
    raise exception 'roster anchor not found — add mon_detect_akariyoun_street_width_is_form_chrome explicitly';
  end if;
  d := replace(d,
        $anchor$'mon_detect_akariyoun_open_bound_age_reappears'$anchor$,
        $anchor$'mon_detect_akariyoun_open_bound_age_reappears',
    'mon_detect_akariyoun_street_width_is_form_chrome'$anchor$);
  execute d;
end $roster$;

do $verify$
declare v_left bigint; v_raised int;
begin
  select count(*) into v_left
    from (select street_width_m from public.akariyoun_residential_listings where street_width_m is not null
          union all
          select street_width_m from public.akariyoun_commercial_listings where street_width_m is not null) z;
  if v_left <> 0 then
    raise exception 'expected every akariyoun street width cleared, % remain', v_left;
  end if;

  -- MUTATION PROOF: replant the form default on enough rows and the detector must SEE it.
  update public.akariyoun_residential_listings set street_width_m = 3
   where active and id in (select id from public.akariyoun_residential_listings where active limit 30);
  v_raised := public.mon_detect_akariyoun_street_width_is_form_chrome();
  if v_raised < 1 then
    raise exception 'detector did not fire on a replanted form-chrome width — it guards nothing';
  end if;
  update public.akariyoun_residential_listings set street_width_m = NULL where street_width_m is not null;

  v_raised := public.mon_detect_akariyoun_street_width_is_form_chrome();
  if v_raised <> 0 then
    raise exception 'detector raised % on clean data', v_raised;
  end if;
  raise notice 'akariyoun street widths cleared; detector rostered, mutation-proved, green';
end $verify$;
