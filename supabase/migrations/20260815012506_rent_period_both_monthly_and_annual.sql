-- Rent period: let a user ask for BOTH monthly and annual in one search (owner feature 2026-08-14).
--
-- Before: p_rent_period accepted 'شهري' (monthly) or 'سنوي' (annual), and NULL meant "no period filter
-- at all" — which also swept in the 510 rent rows whose source publishes NO period. "Both" is NOT the
-- same as "no filter": the user is asking for the UNION OF TWO KNOWN PERIODS, and a row whose period the
-- source never published is neither. Claiming it as a match would be a derived answer (SOURCE IS TRUTH).
--
-- After: a new explicit token 'كلاهما' whose predicate is EXACTLY the union of the two existing branches
-- — monthly's (payment_monthly = true) OR annual's (rent_period_ar='سنوي', plus the RNPL rows that are
-- annual-by-instalment). Nothing else changes: NULL still means no filter, شهري/سنوي are byte-identical,
-- and the ×12 monthly price scaling stays keyed on 'شهري' alone, so a both-search compares the user's
-- budget against price_annual (the canonical stored unit) — the only basis that can span both periods.
--
-- Applied to all THREE readers so counts and results share one predicate (a count the search cannot
-- deliver is the defect verify-rnpl-guard-replay.ts exists to prevent). Needle-edited from each LIVE
-- body with an exactly-once guard: it RAISES rather than rewriting blind, and re-running is a no-op.
do $mig$
declare
  fn text; def text; newdef text; hits int;
  needle constant text := '           or (p_rent_period not in (''شهري'',''سنوي'') and s.rent_period_ar = p_rent_period)';
  repl   constant text :=
    '           or (p_rent_period = ''كلاهما'' and (s.payment_monthly = true or s.rent_period_ar = ''سنوي'' or (s.rent_period_ar = ''شهري'' and coalesce(s.rent_now_pay_later, false))))' || E'\n' ||
    '           or (p_rent_period not in (''شهري'',''سنوي'',''كلاهما'') and s.rent_period_ar = p_rent_period)';
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar'] loop
    def := pg_get_functiondef(('public.' || fn)::regproc);
    if def like '%كلاهما%' then
      raise notice 'SKIP % — already carries the كلاهما branch', fn;
      continue;
    end if;
    hits := (length(def) - length(replace(def, needle, ''))) / length(needle);
    if hits <> 1 then
      raise exception 'ABORT %: period-clause needle matched % time(s), expected exactly 1 — refusing to rewrite blind', fn, hits;
    end if;
    newdef := replace(def, needle, repl);
    execute newdef;
    raise notice 'PATCHED %', fn;
  end loop;
end $mig$;

notify pgrst, 'reload schema';