-- THE AGENT'S EAR LEARNS THE FOLD (owner 2026-09-12: «حي الصفا is the same as صفا … people can say
-- it in both ways … that shouldn't stop them»).
--
-- loc_classify() — the entry point that turns what a user tells the AI agent into a classified
-- place — matched DISTRICT candidates with normalize_ar (the CITY normalizer): a third private
-- copy of district identity. Proven live 2026-09-12, before this change:
--   «صفا»              → kind=none      (bare name never matched: normalize_ar keeps «ال»)
--   «الصفاء»           → 4 cities only  (just the ones whose catalog spelling carries ء)
--   «شرايع المجاهدين»  → none           (ئ/ي variant)
-- District matching now goes through norm_district_tok — the ONE folded token fn (20260912172542)
-- — so the agent hears districts exactly as the picker, the search RPC and the resolver do.
-- City and region arms are deliberately UNTOUCHED (normalize_ar): city names collide legitimately
-- across regions; city identity stays city_id-scoped.
-- SCOPE NOTE: loc_classify reads loc_catalog_district (official catalog) — live-promoted-only
-- districts (e.g. الاحساء «الزهراء ١») are out of its universe by design, before and after this
-- change; the fold guarantees equal TREATMENT of spellings, not a wider universe.

create or replace function public.loc_classify(p_token text)
 returns jsonb
 language plpgsql
 stable
as $function$
declare
  tok text; bare text; tok_norm text; dist_tok text; dist_intent boolean;
  city_cands jsonb; dist_cands jsonb; dist_inv jsonb;
  is_region boolean; is_city boolean;
  city_n int; dist_n int; dist_inv_n int;
begin
  tok := btrim(coalesce(p_token,''));
  if tok = '' then return jsonb_build_object('kind','none'); end if;

  if tok ~ '^[A-Za-z .''-]+$' then
    select city_ar into bare from public.loc_city_map where city_key = lower(tok) limit 1;
    if bare is null then bare := tok; end if;
  else
    bare := tok;
  end if;

  dist_intent := bare ~ '^(حي|بحي)\s';
  bare := btrim(regexp_replace(bare, '^(حي|مدينة|منطقة|في|بمدينة|بحي|بمنطقة)\s+', ''));
  tok_norm := normalize_ar(bare);
  dist_tok := public.norm_district_tok(bare);

  select coalesce(jsonb_agg(x order by inv desc), '[]'::jsonb) into city_cands from (
    select c.city_ar, r.region_ar, c.city_id,
           (select count(*) from public.search_listings_ar v where v.city_id=c.city_id) inv
    from public.loc_catalog_city c join public.loc_catalog_region r on r.region_id=c.region_id
    where normalize_ar(c.city_ar) = tok_norm
  ) x;

  select coalesce(jsonb_agg(x order by inv desc), '[]'::jsonb) into dist_cands from (
    select d.district_ar, c.city_ar, r.region_ar, c.city_id,
           (select count(*) from public.search_listings_ar v
             where v.city_id=c.city_id
               and public.norm_district_tok(v.district_ar) = dist_tok) inv
    from public.loc_catalog_district d
      join public.loc_catalog_city c on c.city_id=d.city_id
      join public.loc_catalog_region r on r.region_id=c.region_id
    where public.norm_district_tok(d.district_ar) = dist_tok
  ) x;

  select coalesce(jsonb_agg(e order by (e->>'inv')::int desc), '[]'::jsonb) into dist_inv
  from jsonb_array_elements(dist_cands) e where (e->>'inv')::int > 0;

  select exists(select 1 from public.loc_catalog_region r
                where normalize_ar(r.region_ar)=tok_norm
                   or normalize_ar(r.region_ar)=normalize_ar('منطقة '||bare)) into is_region;
  select exists(select 1 from public.loc_catalog_city c where normalize_ar(c.city_ar)=tok_norm) into is_city;

  city_n := jsonb_array_length(city_cands);
  dist_n := jsonb_array_length(dist_cands);
  dist_inv_n := jsonb_array_length(dist_inv);

  -- 1) explicit «حي …» → district handling
  if dist_intent then
    if dist_inv_n >= 2 then
      return jsonb_build_object('kind','twin_district','name',bare,'cities',dist_inv,'all_cities',dist_cands);
    elsif dist_inv_n = 1 then
      return jsonb_build_object('kind','district','name',bare,'cities',dist_inv);
    else
      return jsonb_build_object('kind','district_empty','name',bare,'all_cities',dist_cands);
    end if;
  end if;
  -- 2) region/city same name (الرياض/جازان/تبوك/…) wins over an incidental same-named حي elsewhere
  if is_region and is_city then
    return jsonb_build_object('kind','region_or_city','name',bare,'cities',city_cands);
  end if;
  -- 3) pure region name (no same-name city)
  if is_region and not is_city then
    return jsonb_build_object('kind','region','name',bare);
  end if;
  -- 4) twin / single city
  if city_n >= 2 then
    return jsonb_build_object('kind','twin_city','name',bare,'regions',city_cands);
  end if;
  if city_n = 1 then
    return jsonb_build_object('kind','city','name',bare,'regions',city_cands);
  end if;
  -- 5) bare district token (no حي prefix, not a city)
  if dist_inv_n >= 2 then
    return jsonb_build_object('kind','twin_district','name',bare,'cities',dist_inv,'all_cities',dist_cands);
  end if;
  if dist_n >= 1 then
    return jsonb_build_object('kind','district','name',bare,'cities', case when dist_inv_n>=1 then dist_inv else dist_cands end);
  end if;
  return jsonb_build_object('kind','none','name',bare);
end $function$;

-- SELF-TESTS on the real fn against live data; failure rolls the whole change back.
do $$
declare a jsonb; b jsonb; c jsonb;
begin
  a := public.loc_classify('صفا');
  b := public.loc_classify('الصفاء');
  c := public.loc_classify('حي الصفا');
  if a->>'kind' <> 'twin_district' or b->>'kind' <> 'twin_district' or c->>'kind' <> 'twin_district' then
    raise exception 'صفا variants no longer classify as twin_district: % / % / %', a->>'kind', b->>'kind', c->>'kind';
  end if;
  if jsonb_array_length(a->'cities') < 5 then
    raise exception 'bare «صفا» found only % cities — the fold did not reach loc_classify', jsonb_array_length(a->'cities');
  end if;
  if jsonb_array_length(a->'cities') <> jsonb_array_length(b->'cities')
     or jsonb_array_length(a->'cities') <> jsonb_array_length(c->'cities') then
    raise exception 'the three spellings see different city sets (%/%/%) — identity is still split',
      jsonb_array_length(a->'cities'), jsonb_array_length(b->'cities'), jsonb_array_length(c->'cities');
  end if;
  if not exists (select 1 from jsonb_array_elements(a->'cities') e where e->>'city_ar' = 'جدة') then
    raise exception 'جدة missing from «صفا» candidates';
  end if;

  a := public.loc_classify('شرايع المجاهدين');
  if a->>'kind' <> 'district'
     or not exists (select 1 from jsonb_array_elements(a->'cities') e where e->>'city_ar' = 'مكة المكرمة') then
    raise exception '«شرايع المجاهدين» does not resolve to the مكة district (kind=%)', a->>'kind';
  end if;

  -- EQUAL TREATMENT of digit-notation spellings (both outside the catalog universe today — see
  -- scope note — but they must never diverge from each other again):
  if (public.loc_classify('الزهراء1')->>'kind') is distinct from (public.loc_classify('الزهراء ١')->>'kind') then
    raise exception 'digit-notation twins classify differently: % vs %',
      public.loc_classify('الزهراء1')->>'kind', public.loc_classify('الزهراء ١')->>'kind';
  end if;

  -- city/region arms untouched: a ء-carrying CITY and the capital must classify exactly as before
  if public.loc_classify('الاحساء')->>'kind' not in ('city','twin_city','region_or_city') then
    raise exception '«الاحساء» city classification regressed: %', public.loc_classify('الاحساء')->>'kind';
  end if;
  if public.loc_classify('الرياض')->>'kind' <> 'region_or_city' then
    raise exception '«الرياض» classification regressed: %', public.loc_classify('الرياض')->>'kind';
  end if;
end $$;