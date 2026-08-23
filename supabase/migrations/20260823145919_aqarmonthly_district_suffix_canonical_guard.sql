-- Aqarmonthly district ← city-name suffix: make the July cleanup PERMANENT.
--
-- History. 2026-07-21 the backfill 20260721104637 stripped the city name that aqarmonthly's
-- delimiter-less slug glues onto district_ar. It cleaned every row. By 2026-08-22, 38 rows were
-- dirty again — 31 of them rows the backfill had already fixed and a later re-scrape re-corrupted.
--
-- Cause (measured, not assumed): the Python guard in scrapers/common/arabic_location.py shipped with
-- only ONE of the backfill's three rules. It compared RAW tokens against the FULL city name, so it
-- missed «ابها» vs city «أبها» (alef variants — 37 of 38 rows) and «مكة» vs «مكة المكرمة» (an
-- official two-word city abbreviated to its first token — 22 of 38). It caught 0 of the 38.
--
-- This migration makes the algorithm a single shared object instead of two drifting copies:
--   1. public.strip_district_city_suffix() — the canonical rule, promoted out of the pg_temp scope
--      the 2026-07-21 backfill used, so the backfill, the detector, and the Python guard all have
--      ONE reference to agree with (scripts/verify-aqarmonthly-district-suffix-guard.ts pins the
--      Python side against it, rule for rule).
--   2. An idempotent re-run over both the source table and the search index.
--   3. mon_detect_aqarmonthly_district_city_suffix() — so a future re-corruption is caught in hours
--      by the monitor rather than in a month by a person. THIS is the part that makes the fix stay
--      fixed: the code guard stops new corruption, the detector proves it kept stopping it.
--
-- It only ever REMOVES tokens the source glued on. It never renames a district, never turns a region
-- label into a city, and never fills a blank — exact-location-only is untouched (audit 2026-08-10).

-- ── 1. the canonical rule ────────────────────────────────────────────────────────────────────────
create or replace function public.strip_district_city_suffix(p_district_ar text, p_city_ar text)
returns text language plpgsql immutable as $fn$
declare
  dist_tokens text[]; dist_norm text[]; city_norm text[]; n int; cn int;
begin
  if p_district_ar is null or p_city_ar is null then return p_district_ar; end if;
  dist_tokens := regexp_split_to_array(btrim(p_district_ar), '\s+');
  dist_norm   := (select array_agg(public.normalize_ar(x)) from unnest(dist_tokens) x);
  city_norm   := (select array_agg(public.normalize_ar(x))
                    from unnest(regexp_split_to_array(btrim(p_city_ar), '\s+')) x);
  if city_norm is null or array_length(city_norm,1) is null then return p_district_ar; end if;
  loop
    n := array_length(dist_tokens, 1);
    exit when n <= 2;                                   -- two tokens always survive
    cn := array_length(city_norm, 1);
    if n > cn and dist_norm[n-cn+1:n] = city_norm then  -- rule 1: the full city name
      dist_tokens := dist_tokens[1:n-cn]; dist_norm := dist_norm[1:n-cn]; continue;
    end if;
    if dist_norm[n] = city_norm[1] then                 -- rule 2: official name abbreviated
      dist_tokens := dist_tokens[1:n-1]; dist_norm := dist_norm[1:n-1]; continue;
    end if;
    if dist_norm[n] in ('اماره','منطقه') then           -- rule 3: admin marker
      dist_tokens := dist_tokens[1:n-1]; dist_norm := dist_norm[1:n-1]; continue;
    end if;
    exit;
  end loop;
  return array_to_string(dist_tokens, ' ');
end $fn$;

comment on function public.strip_district_city_suffix(text,text) is
  'Canonical district←city suffix rule. Mirrored by strip_city_suffix() in '
  'scrapers/common/arabic_location.py; parity is pinned by '
  'scripts/verify-aqarmonthly-district-suffix-guard.ts. Removes trailing tokens only — never '
  'renames, never invents.';

-- ── 2. idempotent re-run (source first, then the index, in ONE transaction) ──────────────────────
do $mig$
declare n_raw int; n_search int;
begin
  update aqarmonthly_residential_listings r
     set district_ar = public.strip_district_city_suffix(r.district_ar, r.city_ar)
   where r.district_ar is not null and r.city_ar is not null
     and r.district_ar <> public.strip_district_city_suffix(r.district_ar, r.city_ar);
  get diagnostics n_raw = row_count;

  update search_listings_ar s
     set district_ar = public.strip_district_city_suffix(s.district_ar, s.city_ar)
   where s.platform = 'aqarmonthly' and s.district_ar is not null and s.city_ar is not null
     and s.district_ar <> public.strip_district_city_suffix(s.district_ar, s.city_ar);
  get diagnostics n_search = row_count;

  raise notice 'source rows corrected: %; index rows corrected: %', n_raw, n_search;
end $mig$;

-- ── 3. the standing detector — re-scrape re-corruption + backfill non-idempotence ────────────────
create or replace function public.mon_detect_aqarmonthly_district_city_suffix()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_raw bigint; v_idx bigint; n int := 0; bad jsonb := '[]'::jsonb; sample jsonb;
begin
  -- A row is dirty iff the canonical rule would still change it. That makes this detector both the
  -- re-corruption alarm AND the idempotence proof: if the backfill were not a fixed point, it would
  -- report a non-zero count the moment it finished.
  select count(*) into v_raw from aqarmonthly_residential_listings
   where district_ar is not null and city_ar is not null
     and district_ar <> public.strip_district_city_suffix(district_ar, city_ar);

  select count(*) into v_idx from search_listings_ar
   where platform = 'aqarmonthly' and district_ar is not null and city_ar is not null
     and district_ar <> public.strip_district_city_suffix(district_ar, city_ar);

  if v_raw > 0 then bad := bad || jsonb_build_object('kind','source_rows_recorrupted','rows',v_raw); end if;
  if v_idx > 0 then bad := bad || jsonb_build_object('kind','index_rows_recorrupted','rows',v_idx); end if;

  if jsonb_array_length(bad) > 0 then
    select jsonb_agg(jsonb_build_object('district',district_ar,'city',city_ar,
                                        'would_become',public.strip_district_city_suffix(district_ar,city_ar)))
      into sample
      from (select district_ar, city_ar from aqarmonthly_residential_listings
             where district_ar is not null and city_ar is not null
               and district_ar <> public.strip_district_city_suffix(district_ar, city_ar)
             limit 5) s;
    n := public.mon_raise('P2','aqarmonthly_district_city_suffix','aqarmonthly',
      'aqarmonthly_district_city_suffix',
      jsonb_build_object('failures', bad, 'sample', sample,
        'why','aqarmonthly''s slug glues the city name onto the district with no delimiter. The '
           || 'parser guard strip_city_suffix() in scrapers/common/arabic_location.py is supposed to '
           || 'remove it at ingestion. Rows dirty again means that guard regressed or a new slug '
           || 'shape slipped past it — fix the PARSER, then re-run the canonical rule. Never edit '
           || 'the district text by hand.'));
  else
    perform public.mon_resolve_key('aqarmonthly_district_city_suffix','aqarmonthly_district_city_suffix');
  end if;
  return n;
end $$;

-- ── 4. roster wiring, in the SAME migration (an unreached detector is decoration, and
--       mon_detect_orphaned_detectors() fires on it). Needle-edit of the LIVE body so the rest of
--       the roster — which concurrent sessions also touch — is preserved byte-for-byte.
do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_aqarmonthly_district_city_suffix' in src) > 0 then
    raise notice 'already on the roster — no-op'; return;
  end if;
  if position('''mon_detect_rent_period_source_mismatch''' in src) = 0 then
    raise exception 'anchor mon_detect_rent_period_source_mismatch missing from roster';
  end if;
  newsrc := replace(src,
    '''mon_detect_rent_period_source_mismatch''',
    '''mon_detect_rent_period_source_mismatch'',' || chr(10) ||
    '    ''mon_detect_aqarmonthly_district_city_suffix''');
  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb '
    'language plpgsql security definer set search_path to ''public'' as %L', newsrc);
end $$;

select public.mon_detect_aqarmonthly_district_city_suffix() as fired_now;
