-- «نُشر خلال» — PUBLISHED WITHIN, in the Filter's ONE eligibility clause (owner 2026-11-11: «time published … this is in
-- the filter in the map and normal … shows the number»). p_posted_within_days = N keeps a listing only when the listing
-- SITE published it in the last N days (search_listings_ar.posted_at, filled by sync_search_posted_at()). An undated listing is in
-- no window: it shows only when no window is picked («أي وقت»). Not offered for short stays (the client never sends it
-- there). Windows the UI offers: 1, 7, 14, 30, 90 days and 6 / 12 / 24 / 36 months = 183 / 365 / 730 / 1095 days.
--
-- ONE CLAUSE, GENERATED RPCs (the 20261003211448 precedent): the line is appended to af_eligibility_clause() by a needle
-- edit on its live definition (the anchor occurs once); every af_rpc_templates row gains the param right after
-- p_is_new_construction; a SEVENTH template, posted_window_counts_ar, is a copy of af_eligible_count's that returns the
-- count of every window in one read (the popup prints each period with its number); rebuild_af_filter_rpcs() regenerates
-- all of them. No hand edit of an AF RPC.
--
-- SELF-CHECK at apply time (any failure aborts the whole migration): parity 0; three existing counts byte-identical
-- before and after; the window counts
-- read in one call equal af_eligible_count per window; windows only grow (1 ≤ 7 ≤ … ≤ 1095 ≤ any); a window never holds
-- more than the listings the index dates inside it, and the last 7 days is not empty.
do $do$
declare
  def text; occ int; t record; tpl text; cnt_tpl text;
  clause_needle text := $x$and (p_furnished_in is null or cardinality(p_furnished_in) = 0 or s.furnished = any(p_furnished_in))$x$;
  clause_add text := $x$
      -- PUBLISHED WITHIN (owner 2026-11-11): the listing site posting date; an undated listing is in no window.
      and (p_posted_within_days is null or (s.posted_at is not null and s.posted_at >= now() - make_interval(days => p_posted_within_days)))$x$;
  sig_needle text := $x$p_is_new_construction boolean DEFAULT NULL::boolean$x$;
  sig_new text := $x$p_is_new_construction boolean DEFAULT NULL::boolean, p_posted_within_days integer DEFAULT NULL::integer$x$;
  sel_needle text := E'  select count(*)\n  from public.search_listings_ar s';
  sel_new text := E'  select jsonb_build_object(\'any\', count(*),\n'
    || E'    \'d1\', count(*) filter (where s.posted_at >= now() - make_interval(days => 1)),\n'
    || E'    \'d7\', count(*) filter (where s.posted_at >= now() - make_interval(days => 7)),\n'
    || E'    \'d14\', count(*) filter (where s.posted_at >= now() - make_interval(days => 14)),\n'
    || E'    \'d30\', count(*) filter (where s.posted_at >= now() - make_interval(days => 30)),\n'
    || E'    \'d90\', count(*) filter (where s.posted_at >= now() - make_interval(days => 90)),\n'
    || E'    \'d183\', count(*) filter (where s.posted_at >= now() - make_interval(days => 183)),\n'
    || E'    \'d365\', count(*) filter (where s.posted_at >= now() - make_interval(days => 365)),\n'
    || E'    \'d730\', count(*) filter (where s.posted_at >= now() - make_interval(days => 730)),\n'
    || E'    \'d1095\', count(*) filter (where s.posted_at >= now() - make_interval(days => 1095)))\n'
    || E'  from public.search_listings_ar s';
  parity int; b1 bigint; b2 bigint; b3 bigint; a1 bigint; a2 bigint; a3 bigint; w jsonb; c bigint; r bigint; k text; prev bigint := 0;
begin
  -- ── 0. baselines with the CURRENT functions ───────────────────────────────────────────────────
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential') into b1;
  select af_eligible_count(p_deal:='بيع', p_types:=array['فيلا'], p_cities:=array['جدة'], p_category:='Residential') into b2;
  select af_eligible_count() into b3;

  -- ── 1. the clause, needle-edited on its live definition ───────────────────────────────────────
  def := pg_get_functiondef('public.af_eligibility_clause()'::regprocedure);
  if position('p_posted_within_days' in def) > 0 then raise exception 'ABORT: clause already carries p_posted_within_days'; end if;
  occ := (length(def) - length(replace(def, clause_needle, ''))) / length(clause_needle);
  if occ <> 1 then raise exception 'ABORT: clause needle occurs %', occ; end if;
  execute replace(def, clause_needle, clause_needle || clause_add);

  -- ── 2. every template gains the param; the window-count template is born from af_eligible_count's ─
  for t in select fn_name, template from af_rpc_templates order by fn_name loop
    occ := (length(t.template) - length(replace(t.template, sig_needle, ''))) / length(sig_needle);
    if occ <> 1 then raise exception 'ABORT: % signature needle occurs %', t.fn_name, occ; end if;
    tpl := replace(t.template, sig_needle, sig_new);
    update af_rpc_templates set template = tpl where fn_name = t.fn_name;
    if t.fn_name = 'af_eligible_count' then cnt_tpl := tpl; end if;
  end loop;
  if cnt_tpl is null then raise exception 'ABORT: no af_eligible_count template'; end if;
  occ := (length(cnt_tpl) - length(replace(cnt_tpl, sel_needle, ''))) / length(sel_needle);
  if occ <> 1 then raise exception 'ABORT: count select needle occurs %', occ; end if;
  cnt_tpl := replace(cnt_tpl, sel_needle, sel_new);
  cnt_tpl := replace(cnt_tpl, 'FUNCTION public.af_eligible_count(', 'FUNCTION public.posted_window_counts_ar(');
  cnt_tpl := replace(cnt_tpl, E'\n RETURNS bigint\n', E'\n RETURNS jsonb\n');
  if position('posted_window_counts_ar(' in cnt_tpl) = 0 or position('RETURNS jsonb' in cnt_tpl) = 0 then
    raise exception 'ABORT: window-count template not rewritten';
  end if;
  insert into af_rpc_templates (fn_name, template) values ('posted_window_counts_ar', cnt_tpl);

  perform * from rebuild_af_filter_rpcs();
  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  -- ── 3. nothing that exists today moved ────────────────────────────────────────────────────────
  select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential') into a1;
  select af_eligible_count(p_deal:='بيع', p_types:=array['فيلا'], p_cities:=array['جدة'], p_category:='Residential') into a2;
  select af_eligible_count() into a3;
  if (a1, a2, a3) is distinct from (b1, b2, b3) then
    raise exception 'ABORT: an existing count moved: before (% % %) after (% % %)', b1, b2, b3, a1, a2, a3;
  end if;

  -- ── 4. the window is exactly the site date, and the one-call counts agree with it ─────────────
  select af_eligible_count(p_deal:='بيع', p_types:=array['فيلا'], p_cities:=array['جدة'], p_category:='Residential', p_posted_within_days:=30) into c;
  select posted_window_counts_ar(p_deal:='بيع', p_types:=array['فيلا'], p_cities:=array['جدة'], p_category:='Residential') into w;
  if (w->>'any')::bigint <> a2 then raise exception 'ABORT: window counts any % <> af_eligible_count %', w->>'any', a2; end if;
  if (w->>'d30')::bigint <> c then raise exception 'ABORT: window counts d30 % <> af_eligible_count(30) %', w->>'d30', c; end if;
  foreach k in array array['d1','d7','d14','d30','d90','d183','d365','d730','d1095','any'] loop
    if (w->>k)::bigint < prev then raise exception 'ABORT: window % (%) smaller than the one before (%)', k, w->>k, prev; end if;
    prev := (w->>k)::bigint;
  end loop;
  select af_eligible_count(p_posted_within_days:=7) into c;
  select count(*) into r from search_listings_ar s where s.posted_at >= now() - interval '7 days';
  if c > r then raise exception 'ABORT: country 7-day window % exceeds every listing dated in 7 days %', c, r; end if;
  select posted_window_counts_ar() into w;
  if (w->>'d7')::bigint <> c then raise exception 'ABORT: country d7 % <> af_eligible_count(7) %', w->>'d7', c; end if;
  if c = 0 then raise exception 'ABORT: no listing published in the last 7 days — the date column is empty'; end if;
end
$do$;