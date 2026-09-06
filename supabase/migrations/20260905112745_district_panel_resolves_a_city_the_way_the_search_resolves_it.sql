-- THE DISTRICT PANEL HELD A SECOND, STRICTER DEFINITION OF "WHICH ROWS ARE IN THIS CITY".
--
-- WHAT USERS SAW (ops_incident #32). Picking الهفوف and opening the district panel showed
-- total_in_city = 335 under broad Commercial + بيع, while clicking that same city delivered 579.
-- The per-district rows summed to less still, and the Top district ranking is computed from those
-- same per-district counts — so for this city the district ordering was wrong too, not just the
-- total.
--
-- ROOT CAUSE. district_options_ar resolves p_cities (its name-based predicate) through the full
-- union the canonical resolver uses — normalize_ar(city_ar) IN city_tokens OR city_id IN city_ids
-- OR match_city_ids && city_ids — the same resolution location_search_candidates_ar uses. But its
-- per-city cohort filter used a strict `s.city_id = p_city_id`, and its canonical-district catalog
-- lookup used a strict `c.city_id = p_city_id`. One function, two different answers to the same
-- question.
--
-- loc_city_cluster is the resolver's OWN declaration that a set of city_ids is ONE search entity:
-- composite_match_city_ids expands over it, so clicking either member's name delivers the union.
-- There is exactly ONE cluster in the catalog — al_ahsa = {الهفوف 12, الاحساء 3677} — and every
-- الاحساء-filed row was therefore inside the search and outside the panel.
--
-- THE FIX. Both strict predicates expand over the clicked city's cluster, so the panel resolves a
-- city the way the search does. For a city in no cluster the expansion is coalesce(...) =
-- array[p_city_id] — literally the old predicate.
--
-- THE DOUBLE-COUNT THIS HAD TO AVOID. Widening the catalog lookup alone would have been wrong:
-- the two members' district catalogs overlap on 71 of 219 district_norms (25 of them spelled
-- differently), and `cat` LEFT JOINs the per-token live counts before the outer query sums by
-- fold — so each shared district's count would have been added twice. The count belongs to a
-- TOKEN, not to a catalog row, so exactly one catalog row per district_norm carries it and the
-- rest carry 0. match_values still collects every spelling (the UI fires its real per-row count
-- RPCs over that array), and district_ar still resolves to the spelling holding the count because
-- the outer ORDER BY n DESC picks it. No city has two catalog rows sharing a district_norm
-- (verified: 0 rows), so for every non-clustered city row_number() is always 1 and the expression
-- reduces to COALESCE(l.n, 0) — the previous behaviour, unchanged by construction.
--
-- VERIFIED in a rolled-back DO block against production before applying:
--   الهفوف, panel vs. the results RPC under the identical scope —
--     broad Commercial/بيع 579 == 579   (was 335 vs 579)
--     plain بيع            4429 == 4429
--     Residential/فيلا/بيع  774 == 774
--   three non-clustered control cities: full output md5 and total byte-identical before and after.
--
-- Needle-edit from pg_get_functiondef of the LIVE function; district_options_ar is not in
-- af_rpc_templates, the 38-param signature is untouched, no new overload.
do $mig$
declare
  old_cohort text := $a$      and s.city_id = p_city_id
      and s.production_ready = true$a$;
  new_cohort text := $a$      and s.city_id = any (coalesce((select array_agg(m.city_id) from public.loc_city_cluster c1 join public.loc_city_cluster m on m.cluster_key = c1.cluster_key where c1.city_id = p_city_id), array[p_city_id]))
      and s.production_ready = true$a$;
  old_cat text := $a$  cat AS (
    SELECT c.canonical_district_ar,
           regexp_replace(c.district_norm, 'ء$', '') AS fold,
           COALESCE(l.n, 0) AS n
    FROM public.loc_canonical_district c
    LEFT JOIN live l ON l.tok = c.district_norm
    WHERE c.city_id = p_city_id
  )$a$;
  new_cat text := $a$  cat AS (
    SELECT c.canonical_district_ar,
           regexp_replace(c.district_norm, 'ء$', '') AS fold,
           CASE WHEN row_number() OVER (PARTITION BY c.district_norm ORDER BY c.canonical_district_ar, c.city_id) = 1
                THEN COALESCE(l.n, 0) ELSE 0 END AS n
    FROM public.loc_canonical_district c
    LEFT JOIN live l ON l.tok = c.district_norm
    WHERE c.city_id = any (coalesce((select array_agg(m.city_id) from public.loc_city_cluster c1 join public.loc_city_cluster m on m.cluster_key = c1.cluster_key where c1.city_id = p_city_id), array[p_city_id]))
  )$a$;
  def text; newdef text; occ int; n_over int; v_anon boolean;
  res text[]; com text[]; ct text[]; cr text[];
  ctl int[]; cid int;
  before_md5 text[] := '{}'; before_tot int[] := '{}';
  v_md5 text; v_tot int; v int; w int; bad text := ''; i int;
begin
  if (select count(*) from public.loc_canonical_district group by city_id, district_norm having count(*) > 1 limit 1) is not null then
    raise exception 'a city has two catalog rows sharing a district_norm — the one-row-carries-the-count rule would drop a count; refusing';
  end if;

  res := array(select table_name::text from information_schema.tables where table_schema='public' and table_name like '%\_residential\_listings' order by 1);
  com := array(select table_name::text from information_schema.tables where table_schema='public' and table_name like '%\_commercial\_listings' order by 1);
  select array_agg(distinct type_ar) into ct from known_type_ar where macro='Commercial';
  cr := array(select u from unnest(ct) u where u <> 'عمارة');

  -- Controls: the three largest cities that are in NO cluster, so the change must be a no-op there.
  select array_agg(city_id) into ctl from (
    select t.city_id from public.top_cities_by_deal_ar(p_deal => 'بيع', p_tables => res, p_tables2 => com) t
     where t.city_id not in (select city_id from public.loc_city_cluster)
     order by t.listing_count desc limit 3) z;
  if coalesce(array_length(ctl,1),0) < 3 then raise exception 'could not pick 3 non-clustered control cities'; end if;

  foreach cid in array ctl loop
    select md5(coalesce(string_agg(district_ar||'|'||listing_count||'|'||array_to_string(match_values,','), E'\n' order by district_ar),'')), max(total_in_city)
      into v_md5, v_tot from public.district_options_ar(p_city_id := cid, p_deal := 'بيع', p_tables := res, p_tables2 := com);
    before_md5 := before_md5 || v_md5; before_tot := before_tot || coalesce(v_tot, -1);
  end loop;

  def := pg_get_functiondef('public.district_options_ar'::regproc);
  occ := (length(def) - length(replace(def, old_cohort, ''))) / length(old_cohort);
  if occ <> 1 then raise exception 'the cohort anchor occurs % time(s) (expected exactly 1)', occ; end if;
  occ := (length(def) - length(replace(def, old_cat, ''))) / length(old_cat);
  if occ <> 1 then raise exception 'the cat anchor occurs % time(s) (expected exactly 1)', occ; end if;

  newdef := replace(replace(def, old_cohort, new_cohort), old_cat, new_cat);
  execute newdef;

  select count(*) into n_over from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='district_options_ar' and p.prokind='f';
  if n_over <> 1 then raise exception 'district_options_ar has % overloads (PGRST203 shape)', n_over; end if;
  select has_function_privilege('anon', p.oid, 'EXECUTE') into v_anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='district_options_ar' and p.prokind='f';
  if not coalesce(v_anon,false) then raise exception 'anon lost EXECUTE on district_options_ar'; end if;

  -- (1) THE FIX: the panel total must equal the results RPC under the identical scope.
  select total_in_city into v from public.district_options_ar(p_city_id:=12, p_deal:='بيع', p_category:='Commercial', p_types:=cr, p_tables:=res, p_tables2:=com, p_types2:=ct) limit 1;
  select total_count into w from public.location_search_candidates_ar(p_deal:='بيع', p_category:='Commercial', p_types:=cr, p_tables:=res, p_tables2:=com, p_types2:=ct, p_cities:=array['الهفوف'], p_limit:=1, p_offset:=0) limit 1;
  if v is distinct from w then bad := bad || format('broadComBuy panel=%s search=%s; ', v, w); end if;

  select total_in_city into v from public.district_options_ar(p_city_id:=12, p_deal:='بيع', p_tables:=res, p_tables2:=com) limit 1;
  select total_count into w from public.location_search_candidates_ar(p_deal:='بيع', p_tables:=res, p_tables2:=com, p_cities:=array['الهفوف'], p_limit:=1, p_offset:=0) limit 1;
  if v is distinct from w then bad := bad || format('plainBuy panel=%s search=%s; ', v, w); end if;

  select total_in_city into v from public.district_options_ar(p_city_id:=12, p_deal:='بيع', p_category:='Residential', p_types:=array['فيلا'], p_tables:=res, p_tables2:=com, p_types2:=array['فيلا']) limit 1;
  select total_count into w from public.location_search_candidates_ar(p_deal:='بيع', p_category:='Residential', p_types:=array['فيلا'], p_tables:=res, p_tables2:=com, p_types2:=array['فيلا'], p_cities:=array['الهفوف'], p_limit:=1, p_offset:=0) limit 1;
  if v is distinct from w then bad := bad || format('resVilla panel=%s search=%s; ', v, w); end if;

  -- (2) NO-OP EVERYWHERE ELSE: every non-clustered control city byte-identical.
  i := 0;
  foreach cid in array ctl loop
    i := i + 1;
    select md5(coalesce(string_agg(district_ar||'|'||listing_count||'|'||array_to_string(match_values,','), E'\n' order by district_ar),'')), max(total_in_city)
      into v_md5, v_tot from public.district_options_ar(p_city_id := cid, p_deal := 'بيع', p_tables := res, p_tables2 := com);
    if v_md5 is distinct from before_md5[i] or coalesce(v_tot,-1) is distinct from before_tot[i] then
      bad := bad || format('control city %s MOVED (md5 %s->%s, total %s->%s); ', cid, left(before_md5[i],8), left(v_md5,8), before_tot[i], v_tot);
    end if;
  end loop;

  if bad <> '' then raise exception 'rolling back: %', bad; end if;
  raise notice 'district_options_ar now resolves a city through its cluster; الهفوف panel == click-through on 3 scopes, 3 control cities byte-identical';
end $mig$;
