-- SOURCE IS TRUTH: aqar publishes NO price for ad 6708117; Ezhalah served 25,000,000 SAR.
--
-- EVIDENCE (read-only probe, GitHub Actions run 35699759373, 2026-09-22, CI egress — an agent
-- container gets aqar's ~241 KB app shell and cannot see the payload at all):
--
--   aqar_structured = {"price": null, "meter_price": null, "rega_total_price": null,
--                      "price_text": "طلب تسويق"}        <- the SOURCE states there is no price
--   state           = {"closed": true, "status": 1}
--   shipped parser  = price_total -> db.AUTHORITATIVE_NULL   (enrich_residential, correct)
--   our database    = price_total 25,000,000 over area_m2 5
--
-- This is precisely the class the owner's 2026-08-22 decision created AUTHORITATIVE_NULL for
-- (aqar ad 6686450 served at 500,000 SAR while the source rendered «طلب تسويق»). The mechanism is
-- correct and is NOT at fault here: this row's last_seen_at is 2026-07-30, three weeks BEFORE the
-- rule shipped, and it has not been re-enriched since — so the rule has never once been applied to
-- it. An authoritative absence is the one case permitted to overwrite a known value with NULL.
--
-- IT WAS BEING SERVED. Proven through the real production RPC as an anonymous user
-- (location_search_candidates_ar, p_deal=بيع p_cities=[الرياض] p_districts=[حي الروضة]
-- p_types=[أرض سكنية] p_platforms=[aqar]): listing 59619 was the ONLY result in that cell, shown at
-- effective_price 25,000,000 over 5 m². Raised as ops_incident #589.
--
-- SCOPE IS DELIBERATELY ONE FIELD. area_m2 = 5 is left exactly as it is. The parser returned None
-- for area on this fetch, and None is "could not read", NOT the source stating there is no value —
-- the whole distinction this repair rests on. Repairing an unproven field would be the error this
-- routine exists to prevent. Likewise `closed: true` is recorded but not acted on: whether aqar's
-- closed flag may deactivate a listing is a liveness-policy question, not a price repair.
--
-- The remaining 166 rows of the same stale-and-served cohort are under probe separately; each is
-- repaired only on its own evidence, never by extrapolation from this one.

update public.aqar_residential_listings
   set price_total = null
 where id = 59619
   and ad_number = '6708117'
   and price_total = 25000000;    -- no-op if anything re-enriched it first

do $$
declare v_price numeric; v_area numeric;
begin
  select price_total, area_m2 into v_price, v_area
    from public.aqar_residential_listings where id = 59619;
  if v_price is not null then
    raise exception 'repair did not take: aqar 59619 still holds price_total=%', v_price;
  end if;
  if v_area is distinct from 5 then
    raise exception 'area_m2 changed to % — this migration must not touch area', v_area;
  end if;
end $$;
