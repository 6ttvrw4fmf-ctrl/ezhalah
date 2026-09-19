-- A platform whose prices CLUSTER is reading page chrome, not the ad.
--
-- WHY THIS EXISTS. ksaaqar shipped on 2026-09-19 with every stored price wrong: its parser scanned
-- the whole detail page for the first money string, and every ksaaqar page carries a static sidebar
-- of five unrelated ads. 685 of 720 priced rows ended up sharing seven values. Nothing caught it —
-- not the scraper's own tests (they fed a hand-typed string), not the 220 detectors already here.
-- mon_detect_placeholder_price_stored is keyed on wasalt's rentFreq form defaults and could never
-- have seen it; mon_detect_price_fidelity compares a row against its OWN capture, so a row whose
-- capture also holds the borrowed figure agrees with itself.
--
-- This is the platform-agnostic version, and it is a SHAPE detector: it never asks whether one
-- price is right, only whether a platform's price DISTRIBUTION could come from a real market. A
-- borrowed value repeats across unrelated listings; a real market has a long tail.
--
-- THRESHOLDS ARE MEASURED, NOT GUESSED. Run over every platform in production on 2026-09-19:
--   single most common value, share of that platform's priced rows:  fleet max 11.1% (aqaratikom)
--   top three values combined:                                       fleet max 23.7% (raghdan)
--   ksaaqar, before the repair:                                      22.1%  and  79%
-- So 15% / 50% clears every healthy platform on record with room to spare and still fires on
-- ksaaqar at roughly double the margin. A platform needs 50 priced rows before it is judged —
-- below that a genuine repeat (one developer, one plot size) is not evidence of anything.
--
-- It reads ACTIVE rows only, and price_total only: price_annual is legitimately repetitive (rents
-- cluster hard on round monthly figures) and would make this fire on honest data.

create or replace function public.mon_detect_price_borrowed_from_chrome()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}'; q text := ''; t record;
begin
  for t in select table_name from information_schema.tables
            where table_schema = 'public' and table_name ~ '_(residential|commercial)_listings$'
            order by table_name
  loop
    q := q || format(
      'select %L::text src, price_total from public.%I where price_total is not null and active union all ',
      t.table_name, t.table_name);
  end loop;
  if q = '' then
    raise exception 'no listing tables found - refusing to report a clean fleet from an empty scan';
  end if;

  create temp table if not exists _chrome_px (src text, price_total numeric) on commit drop;
  execute 'insert into _chrome_px ' || left(q, length(q) - 11);

  for rec in
    with per as (select split_part(src, '_', 1) as platform, price_total from _chrome_px),
    agg as (select platform, count(*) as priced from per group by 1),
    ranked as (
      select platform, price_total, count(*) as n,
             row_number() over (partition by platform order by count(*) desc) as rn
        from per group by 1, 2
    ),
    shape as (
      select a.platform, a.priced,
             max(r.n) filter (where r.rn = 1)           as top_n,
             max(r.price_total) filter (where r.rn = 1) as top_value,
             sum(r.n) filter (where r.rn <= 3)          as top3_n
        from agg a join ranked r on r.platform = a.platform
       where a.priced >= 50
       group by a.platform, a.priced
    )
    select s.*,
           round(100.0 * s.top_n  / s.priced, 1) as top_pct,
           round(100.0 * s.top3_n / s.priced, 1) as top3_pct
      from shape s
     where 100.0 * s.top_n  / s.priced >= 15
        or 100.0 * s.top3_n / s.priced >= 50
     order by s.platform
  loop
    live_keys := live_keys || ('price_borrowed_from_chrome:' || rec.platform);
    n := n + public.mon_raise('P0', 'price_borrowed_from_chrome', rec.platform,
      'price_borrowed_from_chrome:' || rec.platform,
      jsonb_build_object(
        'why', rec.platform || ' has ' || rec.priced || ' priced active listings, but its single '
             || 'most common price (' || rec.top_value || ') covers ' || rec.top_pct || '% of them '
             || 'and its top three cover ' || rec.top3_pct || '%. A real market does not do that. '
             || 'This is the shape of a parser reading a value that is the SAME on every page — a '
             || 'sidebar of other ads, a filter default, a promo widget — instead of the listing''s '
             || 'own price. Healthy platforms sit under 11% / 24%.',
        'expected', 'the most common price under 15% of the platform, top three under 50%',
        'adjudicate', 'Open two detail pages for this platform whose stored prices are EQUAL and '
             || 'compare each against what the page itself publishes for that ad. If the pages show '
             || 'different prices, the parser is reading shared page chrome: fix it to read the '
             || 'ad''s own element anchored on the ad''s own identity, then BLANK the platform''s '
             || 'prices in a migration before re-sweeping — _unknown_must_not_overwrite_known() '
             || 'drops None, so a re-sweep alone cannot retract a wrong price from an ad that '
             || 'publishes none. If the pages genuinely publish the same figure, this is real and '
             || 'the platform needs a waiver here, not a weakened threshold.',
        'platform', rec.platform, 'priced_rows', rec.priced,
        'most_common_price', rec.top_value, 'most_common_count', rec.top_n,
        'most_common_pct', rec.top_pct, 'top3_pct', rec.top3_pct));
  end loop;

  perform public.mon_resolve_stale_keys('price_borrowed_from_chrome', live_keys);
  return n;
end $function$;

-- Roster it, refusing rather than silently no-opping if the anchor moved.
do $$
declare def text;
begin
  select pg_get_functiondef(oid) into def
    from pg_proc where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace;
  if def is null then
    raise exception 'mon_run_all_detectors() not found - cannot roster the new detector';
  end if;
  if position('mon_detect_price_borrowed_from_chrome' in def) > 0 then
    raise notice 'already rostered'; return;
  end if;
  if position('''mon_detect_price_source_evidence_stale''' in def) = 0 then
    raise exception 'roster anchor mon_detect_price_source_evidence_stale not found - refusing to splice blind';
  end if;
  def := replace(def, '''mon_detect_price_source_evidence_stale''',
                      '''mon_detect_price_source_evidence_stale'', ''mon_detect_price_borrowed_from_chrome''');
  execute def;
end $$;

do $$
begin
  if position('mon_detect_price_borrowed_from_chrome' in
      (select pg_get_functiondef(oid) from pg_proc
        where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace)) = 0 then
    raise exception 'ROSTER FAILED: the detector is not reachable from mon_run_all_detectors()';
  end if;
  raise notice 'rostered OK';
end $$;
