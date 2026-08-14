-- 2026-08-14 (Data Integrity run #17). mon_detect_priceless_rent_with_labelled_source_price
-- asserted, as fact, that "The source published a price and the scraper did not capture it" and
-- instructed the reader to "Fix the PARSER ... read the labelled body line".
--
-- Adjudicated against source and that assertion is FALSE for at least one member of its own cohort.
-- aqar ad 6820690 (row 7824609) was live-probed on 2026-08-14 and the PRODUCTION parser was run
-- against the fetched page: _listing_json() found aqar's structured object
-- (id=6820690, price=200000, area=1000, published=FALSE, status=0) and _structured_price()
-- returned (None, authoritative=True) deliberately. `published:false` is aqar's documented
-- non-publication shape — its own price slot renders «طلب تسويق» and a human sees NO figure
-- (21/150 live listings sampled 2026-08-09). The «الإيجار السنوي: 200,000 ريال» line is SELLER
-- PROSE in the ad body, not aqar's published price field.
--
-- So the detector's cohort mixes two opposite cases that look identical in the database:
--   (a) a genuine parser miss  → fix the parser (the case this detector was built for), and
--   (b) the source deliberately withholding a displayable price → honest NULL is CORRECT.
-- Following the old instruction on a case-(b) row would print a price on our card that the source
-- refuses to display — the exact failure the source-is-truth rule exists to prevent.
--
-- The detector still fires on the same rows (nothing is silenced, the cohort predicate is byte-for-
-- byte unchanged, and the FK-gated ops_priceless_rent_ambiguous_verified waiver still governs what
-- drops out). Only the INSTRUCTION changes: adjudicate against the structured payload first, and
-- never import prose.
create or replace function public.mon_detect_priceless_rent_with_labelled_source_price()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  t text; p text; n_rows int;
  total int := 0;
  by_platform jsonb := '{}'::jsonb;
  n int := 0;
  pat text := 'ال[إا]يجار[[:space:]]*(السنوي|الشهري)?[[:space:]]*[:：][[:space:]]*[0-9][0-9,.]*[[:space:]]*ريال';
begin
  for rec in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name ~ '_(residential|commercial)_listings$'
    group by c.table_name
    having count(*) filter (where c.column_name in
        ('description','price_annual','price_total','transaction_type','active','id')) = 6
  loop
    t := rec.table_name;
    p := split_part(t, '_', 1);
    execute format($f$
      select count(*)
      from public.%I r
      join public.search_listings_ar s
        on s.source_table = %L and s.listing_id = r.id
      where r.active
        and s.production_ready
        and r.price_annual is null
        and r.price_total is null
        and (r.transaction_type ilike '%%rent%%' or r.transaction_type ilike '%%إيجار%%')
        and r.description ~ %L
        and not exists (
          select 1 from public.ops_priceless_rent_ambiguous_verified v
          where v.source_table = %L and v.listing_id = r.id
        )
    $f$, t, t, pat, t) into n_rows;

    if n_rows > 0 then
      total := total + n_rows;
      by_platform := by_platform
        || jsonb_build_object(p, coalesce((by_platform ->> p)::int, 0) + n_rows);
    end if;
  end loop;

  if total > 0 then
    n := public.mon_raise('P2', 'priceless_rent_labelled_source_price', 'all',
      'priceless_rent_labelled_source_price',
      jsonb_build_object(
        'served_priceless_rows', total,
        'by_platform', by_platform,
        'why', 'These Rent listings are production_ready and served with NO price, while their own '
               'captured description carries a labelled «الإيجار …: N ريال» line. That is a '
               'CANDIDATE, not a verdict: two opposite cases look identical here.',
        'adjudicate', 'ADJUDICATE AGAINST THE SOURCE BEFORE TOUCHING ANY PARSER. Re-fetch the ad '
               'and read the platform''s STRUCTURED price field, not the body text. (a) The '
               'structured field publishes a figure we failed to store -> genuine parser miss, fix '
               'the parser to read that STRUCTURED field. (b) The source states it is not '
               'publishing a price -- e.g. aqar `published:false`/`status:0`, whose price slot '
               'renders «طلب تسويق» so a human sees no figure -- then honest NULL is CORRECT and '
               'the row belongs in ops_priceless_rent_ambiguous_verified with the probe recorded. '
               'Case (b) is REAL and was confirmed live on aqar 6820690 (2026-08-14). NEVER import '
               'the figure from the description: seller prose is not a source price field, and '
               'never store an amount whose period the source did not state.'));
  else
    perform public.mon_resolve_key('priceless_rent_labelled_source_price',
                                   'priceless_rent_labelled_source_price');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_priceless_rent_with_labelled_source_price() is
'Priced-looking Rent rows served with NULL price whose description carries a labelled «الإيجار …: N ريال» line.
VERDICT ATTACHED 2026-08-14 (Data Integrity run #17): a member of this cohort is NOT necessarily a parser miss.
aqar 6820690 was live-probed and the production parser DID read aqar''s structured object (price=200000,
published=false, status=0); _structured_price() returns (None, authoritative=True) by design because aqar renders
«طلب تسويق» and displays no figure. The 200,000 exists only as seller prose in the ad body. Importing it would
show a price the source deliberately hides. Always adjudicate against the STRUCTURED field before editing a parser;
record the probe in ops_priceless_rent_ambiguous_verified. Cohort predicate is unchanged — nothing is silenced.';