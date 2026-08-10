-- Narrow mon_detect_zero_price_served to the price the USER ACTUALLY SEES (2026-08-10, run #8).
--
-- The first version (20260810070008) flagged `price_total = 0 or price_annual = 0` on any
-- production_ready row. Its first real scheduled execution (cron job 38 at 07:20:00Z, alert 389)
-- returned 9 rows — and 6 of them are noise:
--
--   aqar 15766 / 39844 / 51996 / 81238 / 6251664 / 6974189 are all deal_ar = 'بيع' carrying a
--   genuine price_total (1,700,000 / 2,500,000 / 3,000,000 / 1,300,000 / 220,000 / 2,300,000) and
--   a leftover price_annual = 0. On a Buy listing price_annual is never displayed and never
--   filtered on, so a 0 there reaches no user. Flagging them buries the real finding.
--
-- The 3 genuine rows are ramzalqasim 615752 / 4366350 / 6259127: Buy land plots whose price_total
-- — the number on the card AND the price-ascending sort key — is 0.
--
-- A detector that cries wolf gets ignored, which is how the standing extreme_magnitude false-P1
-- backlog happened. So test the DEAL-EFFECTIVE price: for Buy that is price_total; for Rent it is
-- the annual figure, falling back to price_total when a platform stores the rent there. A 0 in a
-- field that deal type never surfaces is not a user-facing defect and is deliberately not flagged.
create or replace function public.mon_detect_zero_price_served()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_cnt bigint; v_platforms text; v_open boolean; n int := 0;
begin
  select count(*), coalesce(string_agg(distinct platform, ',' order by platform), '')
    into v_cnt, v_platforms
    from public.search_listings_ar
   where production_ready
     and case when deal_ar = 'بيع' then price_total = 0
              else coalesce(price_annual, price_total) = 0
         end;

  v_open := exists (select 1 from public.alert_event
                    where dedup_key = 'zero_price_served' and resolved_at is null);

  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('zero_price_served', 'search_index'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P2', 'zero_price_served', 'search_index', 'zero_price_served',
      jsonb_build_object(
        'count', v_cnt,
        'platforms', v_platforms,
        'why', 'a SEARCHABLE listing shows a price of exactly 0 for its OWN deal type — almost '
               'always the source''s "no price / السوم" sentinel stored as if it were a real number. '
               'It sorts above every genuine listing on price-ascending and matches every price-max '
               'filter. Do NOT bulk-null these: confirm against the live source page first (honest '
               'NULL beats a guess, but a genuinely published 0 would still be preserved).'));
  else
    -- keep the open alert's payload current (mon_raise refreshes detail without re-paging)
    n := n + public.mon_raise('P2', 'zero_price_served', 'search_index', 'zero_price_served',
      jsonb_build_object('count', v_cnt, 'platforms', v_platforms,
        'why', 'a SEARCHABLE listing shows a price of exactly 0 for its OWN deal type — see '
               'migration 20260810070008 and its 2026-08-10 narrowing.'));
  end if;
  return n;
end $function$;
