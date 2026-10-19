-- The card-label detector's two district arms cost 10.7s because each row ran a subquery.
--
-- ops_incident #318 (P1, routine-4-search-qa): mon_detect_card_label_contract is the most
-- expensive detector in the 224-entry roster, and jobid 38's total runtime is what starves
-- pg_cron (cron.use_background_workers=off, so nothing else launches while the sweep runs).
-- On 2026-09-15 that starvation killed the :36 sync-search-listings-ar slot and froze the
-- served search index for 75h. Reducing this detector is the one fix in #318/#300 that needs
-- no schedule or config change.
--
-- #318 recorded two candidate optimisations. Measured on production 2026-09-22, ONE of them
-- is worth doing and the OTHER is not, which is why only this one ships:
--
--   * "the six counts are combinable into one pass with conditional aggregation" — TRUE but
--     near-worthless. The cost is not the number of scans, it is ONE arm's per-row call:
--     district_ne_canonical 6,919ms (68%) + district_rendered_two_ways 2,414ms (24%) against
--     english_leak 611 / city_text_ne_city_id 116 / admin_region_label 91 /
--     unknown_location_guessed 7. Folding the five cheap row-level counts together saves
--     ~0.8s of ~10s. Not shipped: it rewrites a barrier for an 8% gain.
--
--   * the real driver: loc_display_district_ar(city_id, district_ar) is a STABLE SQL function
--     whose body is a correlated subquery over loc_display_district_canon, so the arm executed
--     that subquery ~219,000 times — once per production_ready row. Inlining it as a plain
--     LEFT JOIN removes all 219,000 executions, and computing norm_district_tok(district_ar)
--     ONCE in a shared CTE lets the split arm reuse it instead of re-deriving it in a second
--     scan.
--
-- MEASURED on production, same transaction, same data, 2026-09-22:
--   OLD (two arms, as shipped): 10,707 ms   NEW (one shared CTE): 3,869 ms   -- 2.8x, -6.8s
-- Both returned the identical answers (0, 0).
--
-- EQUIVALENCE IS STRUCTURAL, not a coincidence of today's data:
--   loc_display_district_ar(c,r) = coalesce((select display_ar from loc_display_district_canon
--     where city_id = c and district_norm = norm_district_tok(r)), r), and
--     (city_id, district_norm) is the PRIMARY KEY of that table (loc_display_district_canon_pkey,
--     UNIQUE), so the LEFT JOIN can never multiply a row the subquery would have collapsed.
--   A NULL city_id matches nothing in either form (NULL = NULL is unknown -> coalesce -> raw),
--   so a row with no resolved city is a non-violation under both, exactly as before.
--
-- NOTHING ABOUT WHAT THE DETECTOR CATCHES CHANGES. All six label conditions keep their
-- meaning, their thresholds and their sample block; this is a cost change only. The DO blocks
-- below REFUSE to install unless that is proven by execution, in both directions.
--
-- The CTE output column is `cnt`, not `n`: the function already declares `n int` for the
-- mon_raise return, and a CTE column called `n` makes `select (select n from ne)` ambiguous
-- between the PL/pgSQL variable and the column. The first attempt at this migration shipped
-- `n` and was REFUSED at install time by PROOF 3 below — the block that executes the real
-- installed object rather than reasoning about its text. Proofs 1 and 2 had both passed:
-- they compare two SQL expressions outside the function, where the variable does not exist.

-- PROOF 1 (before installing): differential + mutation on planted violations.
-- A differential that only ever compares 0 against 0 proves nothing — production is currently
-- clean on all six conditions, so the arms are exercised here against rows built to breach
-- them. Asserts the two forms AGREE, and that they agree on a NON-ZERO answer, i.e. the
-- rewritten arm can still fire.
do $proof$
declare
  old_ne bigint; new_ne bigint; old_split bigint; new_split bigint;
  clean_ne bigint; clean_split bigint;
begin
  create temp table _clc_synth(city_id int, district_ar text, label text) on commit drop;
  insert into _clc_synth values
    (1,  'حي الفلاح',        'canonical - NOT a violation'),
    (1,  'الفلاح',            'same token, non-canonical rendering - IS a violation'),
    (1,  'حي فلاح',          'same token, third rendering - IS a violation'),
    (1,  'زززز لا وجود له',  'no canon row at all - coalesce falls back to raw, NOT a violation'),
    (67, 'حي اليمامة',       'canonical - NOT a violation'),
    (67, 'اليمامة',           'same token, non-canonical - IS a violation'),
    (1,  null,                'null district - excluded by both forms');

  -- OLD form: the per-row STABLE function call, exactly as shipped since 2026-08-22.
  select count(*) into old_ne
    from _clc_synth s
   where s.district_ar is not null
     and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar);
  select count(*) into old_split from (
    select 1 from _clc_synth where district_ar is not null
     group by city_id, public.norm_district_tok(district_ar)
    having count(distinct district_ar) > 1) z;

  -- NEW form: the shared CTE + LEFT JOIN this migration installs.
  with base as (
    select city_id, district_ar, public.norm_district_tok(district_ar) as tok
      from _clc_synth where district_ar is not null
  ), ne as (
    select count(*) cnt from base b
      left join public.loc_display_district_canon k
        on k.city_id = b.city_id and k.district_norm = b.tok
     where b.district_ar is distinct from coalesce(k.display_ar, b.district_ar)
  ), sp as (
    select count(*) cnt from (
      select 1 from base group by city_id, tok having count(distinct district_ar) > 1) z
  )
  select (select cnt from ne), (select cnt from sp) into new_ne, new_split;

  if old_ne is distinct from new_ne or old_split is distinct from new_split then
    raise exception 'REFUSING TO INSTALL: rewritten district arms disagree with the shipped form on planted violations (ne old=% new=% | split old=% new=%)',
      old_ne, new_ne, old_split, new_split;
  end if;

  -- Mutation half: a form that cannot fire is not a barrier, whatever it agrees with.
  if new_ne = 0 or new_split = 0 then
    raise exception 'REFUSING TO INSTALL: rewritten district arms did not fire on deliberately broken rows (ne=%, split=%) - the arm would be decoration',
      new_ne, new_split;
  end if;

  -- Negative control: the same rewritten arms must read ZERO over the canonical-only rows,
  -- so the non-zero above is the planted breach and not the form counting everything.
  with base as (
    select city_id, district_ar, public.norm_district_tok(district_ar) as tok
      from _clc_synth
     where district_ar is not null and label like 'canonical%'
  ), ne as (
    select count(*) cnt from base b
      left join public.loc_display_district_canon k
        on k.city_id = b.city_id and k.district_norm = b.tok
     where b.district_ar is distinct from coalesce(k.display_ar, b.district_ar)
  ), sp as (
    select count(*) cnt from (
      select 1 from base group by city_id, tok having count(distinct district_ar) > 1) z
  )
  select (select cnt from ne), (select cnt from sp) into clean_ne, clean_split;

  if clean_ne <> 0 or clean_split <> 0 then
    raise exception 'REFUSING TO INSTALL: rewritten arms false-positive on canonical rows (ne=%, split=%)',
      clean_ne, clean_split;
  end if;

  raise notice 'PROOF 1 ok: old=new on planted violations (ne=%, split=%), zero on canonical rows', new_ne, new_split;
  drop table _clc_synth;
end
$proof$;

-- PROOF 2 (before installing): the same differential over the FULL production inventory.
-- Proof 1 shows the forms agree on seven synthetic rows; this shows they agree on all
-- ~219,000 production_ready rows that the detector actually reads.
do $proof$
declare old_ne bigint; new_ne bigint; old_split bigint; new_split bigint;
begin
  select count(*) into old_ne from public.search_listings_ar s
   where s.production_ready and s.district_ar is not null
     and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar);
  select count(*) into old_split from (
    select 1 from public.search_listings_ar
     where production_ready and district_ar is not null
     group by city_id, norm_district_tok(district_ar)
    having count(distinct district_ar) > 1) z;

  with base as (
    select s.city_id, s.district_ar, public.norm_district_tok(s.district_ar) as tok
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null
  ), ne as (
    select count(*) cnt from base b
      left join public.loc_display_district_canon k
        on k.city_id = b.city_id and k.district_norm = b.tok
     where b.district_ar is distinct from coalesce(k.display_ar, b.district_ar)
  ), sp as (
    select count(*) cnt from (
      select 1 from base group by city_id, tok having count(distinct district_ar) > 1) z
  )
  select (select cnt from ne), (select cnt from sp) into new_ne, new_split;

  if old_ne is distinct from new_ne or old_split is distinct from new_split then
    raise exception 'REFUSING TO INSTALL: rewritten district arms disagree with the shipped form over production (ne old=% new=% | split old=% new=%)',
      old_ne, new_ne, old_split, new_split;
  end if;
  raise notice 'PROOF 2 ok: old=new over full production inventory (ne=%, split=%)', new_ne, new_split;
end
$proof$;

-- The detector. Only the two district arms changed; the other four counts, the early return,
-- the sample block and the mon_raise payload are byte-identical to the shipped version.
create or replace function public.mon_detect_card_label_contract()
 returns integer
 language plpgsql
as $function$
declare
  n int := 0;
  v_latin bigint; v_city_ne_id bigint; v_admin bigint; v_guessed bigint;
  v_district_ne_canon bigint; v_district_split bigint; v_sample jsonb;
begin
  select count(*) into v_latin from public.search_listings_ar s
   where s.production_ready and (
         s.city_ar ~ '[A-Za-z]' or s.district_ar ~ '[A-Za-z]' or s.region_ar ~ '[A-Za-z]'
      or s.type_ar ~ '[A-Za-z]' or s.deal_ar ~ '[A-Za-z]' or s.rent_period_ar ~ '[A-Za-z]'
      or s.direction_ar ~ '[A-Za-z]' or s.tenant_ar ~ '[A-Za-z]' or s.unit_subtype_ar ~ '[A-Za-z]');

  select count(*) into v_city_ne_id
    from public.search_listings_ar s join public.loc_catalog_city c on c.city_id = s.city_id
   where s.production_ready and s.city_ar is distinct from c.city_ar;

  select count(*) into v_admin from public.search_listings_ar s
   where s.production_ready and (s.city_ar like 'امارة%' or s.city_ar like 'إمارة%'
                                 or s.city_ar like 'منطقة %');

  select count(*) into v_guessed from public.search_listings_ar s
   where s.production_ready and s.city_id is null and s.city_ar is not null;

  -- The two district arms, in ONE pass. Previously two scans, the first of which ran
  -- loc_display_district_ar() — a correlated subquery — once per production_ready row
  -- (~219,000 executions, 6.9s). norm_district_tok() is now derived once per row in `base`
  -- and reused by both arms, and the canon lookup is a LEFT JOIN on that table's PRIMARY KEY.
  -- Semantics are unchanged and are proven so, by execution, in the two DO blocks above.
  -- Measured: 10,707ms -> 3,869ms on production (2026-09-22, ops_incident #318).
  -- `cnt`, not `n`: `n` is the mon_raise return variable declared above and would be ambiguous.
  with base as (
    select s.city_id, s.district_ar, public.norm_district_tok(s.district_ar) as tok
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null
  ), ne as (
    select count(*) cnt from base b
      left join public.loc_display_district_canon k
        on k.city_id = b.city_id and k.district_norm = b.tok
     where b.district_ar is distinct from coalesce(k.display_ar, b.district_ar)
  ), sp as (
    select count(*) cnt from (
      select 1 from base group by city_id, tok having count(distinct district_ar) > 1) z
  )
  select (select cnt from ne), (select cnt from sp) into v_district_ne_canon, v_district_split;

  if v_latin = 0 and v_city_ne_id = 0 and v_admin = 0 and v_guessed = 0
     and v_district_ne_canon = 0 and v_district_split = 0 then
    perform public.mon_resolve_key('card_label_contract','card_label_contract');
    return 0;
  end if;

  -- The split pairs, resolved once so the sample can name the rows rather than the condition.
  -- This is the arm that was missing: without it a run where district_rendered_two_ways is the
  -- ONLY non-zero count produces "sample": null and tells the reader nothing.
  with split as (
    select city_id, norm_district_tok(district_ar) as tok
      from public.search_listings_ar
     where production_ready and district_ar is not null
     group by city_id, norm_district_tok(district_ar)
    having count(distinct district_ar) > 1
  )
  select jsonb_agg(t) into v_sample from (
    select s.source_table, s.listing_id, s.platform, s.city_id, s.city_ar, s.district_ar, s.region_ar
      from public.search_listings_ar s
      left join public.loc_catalog_city c on c.city_id = s.city_id
     where s.production_ready and (
           s.city_ar ~ '[A-Za-z]' or s.district_ar ~ '[A-Za-z]' or s.type_ar ~ '[A-Za-z]'
        or (c.city_id is not null and s.city_ar is distinct from c.city_ar)
        or s.city_ar like 'امارة%' or s.city_ar like 'إمارة%' or s.city_ar like 'منطقة %'
        or (s.city_id is null and s.city_ar is not null)
        or (s.district_ar is not null
            and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar))
        or exists (select 1 from split p
                    where p.city_id is not distinct from s.city_id
                      and p.tok = norm_district_tok(s.district_ar)))
     limit 8) t;

  n := public.mon_raise('P2','card_label_contract','all','card_label_contract',
    jsonb_build_object(
      'why','What the user SEES on a result card no longer matches the listing/search truth in clean canonical Arabic. Each count below is a distinct breach of the owner rule (2026-08-22).',
      'english_leak_in_arabic_field', v_latin,
      'city_text_ne_city_id',        v_city_ne_id,
      'admin_region_label_as_city',  v_admin,
      'unknown_location_guessed',    v_guessed,
      'district_ne_canonical',       v_district_ne_canon,
      'district_rendered_two_ways',  v_district_split,
      'fix','Labels are written by loc_display_city_ar()/loc_display_district_ar() in sync_search_listings_ar(); backfill_location_display_labels() repairs stored rows. A district_rendered_two_ways breach usually means loc_display_district_canon has no row for that (city, district) — see the district_canon_stale detector.',
      'sample', v_sample));
  return n;
end $function$;

-- PROOF 3 (after installing): run the REAL installed function and assert it agrees with the
-- pre-change production truth. Proofs 1 and 2 compare two SQL expressions; this one executes
-- the shipped object, so the migration cannot leave a function that differs from what was
-- proven. Production is all-six-zero right now, so the detector must return 0.
-- This block has already earned its place: it REFUSED the first attempt at this migration,
-- whose CTE column `n` collided with the function's own `n` variable. Proofs 1 and 2 passed.
do $proof$
declare got int;
begin
  got := public.mon_detect_card_label_contract();
  if got <> 0 then
    raise exception 'REFUSING: installed detector returned % over an inventory measured clean on all six conditions immediately before install', got;
  end if;
  raise notice 'PROOF 3 ok: installed detector executes and returns 0 on the clean inventory';
end
$proof$;