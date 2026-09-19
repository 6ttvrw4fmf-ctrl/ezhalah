-- mon_detect_price_borrowed_from_chrome raises P1, not P0.
--
-- It shipped P0 in 20260919092122. verify-p0-fast-lane-detection.ts correctly flagged that every
-- P0-capable detector must run on the 300s fast lane (mon_run_p0_detectors), because a P0 raised
-- only inside the daily sweep spends the whole sweep runtime before dispatch can begin.
--
-- The right answer is NOT to put this one on the fast lane, and NOT to widen the SLO. This detector
-- is a full-fleet aggregate: it builds a temp table across every *_residential/_commercial_listings
-- table (~100 of them, 200k+ rows) and ranks each platform's price distribution. That is exactly
-- the expensive shape the fast-lane doc says must not be charged against the 300s P0 budget — put
-- it on the minute-cadence lane and it would consume the very budget the lane exists to protect.
--
-- And it does not NEED 300s delivery. A platform's price distribution only changes when a scraper
-- is added or changed and the site is re-swept — at most daily. There is no sub-minute event here
-- to deliver fast. Detecting it once per daily sweep, inside mon_run_all_detectors (where it is
-- already rostered), is the correct cadence. Its nearest sibling in the same "a stored price is
-- wrong" class, mon_detect_placeholder_price_stored, is likewise P1.
--
-- Nothing about DETECTION changes here — same thresholds (15% / 50%), same 50-row floor, same
-- predicate, same roster membership. Only the delivery severity is corrected, so this is a
-- classification fix, not a weakened detector.

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
    n := n + public.mon_raise('P1', 'price_borrowed_from_chrome', rec.platform,
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
