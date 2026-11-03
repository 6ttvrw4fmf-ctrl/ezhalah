-- price_borrowed_from_chrome counts a uniform lot ONCE (2026-11-02).
--
-- The detector fired P1 on nofodh since 2026-09-26: 819,000 covers 27% of its priced rows. Adjudicated against
-- the source the way its own 'adjudicate' text asks: unit 783256's page prints «السعر 819,000», «300 متر مربع»
-- and its own Livewire state min_price 819000; the 220 rows are plots AMGP-BLK*-* of ONE developer subdivision,
-- every one 300 m² at the same pin. A developer pricing identical plots identically is a real market.
--
-- Not a platform waiver and not a weaker threshold: rows that share price AND area AND pin are ONE observation
-- (a uniform lot). A figure borrowed from page chrome lands on ads of DIFFERENT areas and places, so it is
-- still counted row by row and still fires. Rows without an area or without a pin are never collapsed (they
-- cannot be shown to be the same lot), so a chrome price on area-less, pin-less ads still fires too.
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
      'select %L::text src, price_total, '
      || 'case when area_m2 is not null and additional_info ? ''latitude'' and additional_info ? ''longitude'' '
      || 'then area_m2::text || ''@'' || (additional_info->>''latitude'') || '','' || (additional_info->>''longitude'') end lot '
      || 'from public.%I where price_total is not null and active union all ',
      t.table_name, t.table_name);
  end loop;
  if q = '' then
    raise exception 'no listing tables found - refusing to report a clean fleet from an empty scan';
  end if;

  create temp table if not exists _chrome_px (src text, price_total numeric, lot text) on commit drop;
  execute 'insert into _chrome_px ' || left(q, length(q) - 11);

  for rec in
    -- one observation per uniform lot (same price + area + pin); every other row counts alone
    with per as (
      select split_part(src, '_', 1) as platform, price_total, lot from _chrome_px where lot is null
      union all
      select distinct split_part(src, '_', 1), price_total, lot from _chrome_px where lot is not null
    ),
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
        'why', rec.platform || ' has ' || rec.priced || ' priced active observations (identical lots — same '
             || 'price, area and pin — count once), but its single most common price (' || rec.top_value
             || ') covers ' || rec.top_pct || '% of them and its top three cover ' || rec.top3_pct || '%. '
             || 'A real market does not do that. This is the shape of a parser reading a value that is the '
             || 'SAME on every page — a sidebar of other ads, a filter default, a promo widget — instead of '
             || 'the listing''s own price. Healthy platforms sit under 11% / 24%.',
        'expected', 'the most common price under 15% of the platform, top three under 50%',
        'adjudicate', 'Open two detail pages for this platform whose stored prices are EQUAL and '
             || 'compare each against what the page itself publishes for that ad. If the pages show '
             || 'different prices, the parser is reading shared page chrome: fix it to read the '
             || 'ad''s own element anchored on the ad''s own identity, then BLANK the platform''s '
             || 'prices in a migration before re-sweeping — _unknown_must_not_overwrite_known() '
             || 'drops None, so a re-sweep alone cannot retract a wrong price from an ad that '
             || 'publishes none. If the pages genuinely publish the same figure on DIFFERENT lots, '
             || 'this is real and needs an owner decision, not a weakened threshold.',
        'platform', rec.platform, 'priced_rows', rec.priced,
        'most_common_price', rec.top_value, 'most_common_count', rec.top_n,
        'most_common_pct', rec.top_pct, 'top3_pct', rec.top3_pct));
  end loop;

  perform public.mon_resolve_stale_keys('price_borrowed_from_chrome', live_keys);
  return n;
end $function$;
