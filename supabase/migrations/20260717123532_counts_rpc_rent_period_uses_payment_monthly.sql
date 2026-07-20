-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717123532, name 'counts_rpc_rent_period_uses_payment_monthly'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 ed1d294e19d5330fa65cf342e8dd9be6).

-- Align property_age_option_counts_ar's rent-period predicate with the search RPC by having BOTH read
-- the single payment_monthly column, so the two can never drift again.
--
-- WHY: the counts RPC still carried the pre-payment_monthly clause. Today the MONTHLY arms happen to
-- agree (payment_monthly is defined as exactly rent_period_ar='شهري' OR platform in gathern/aqarmonthly),
-- but the YEARLY arms do NOT: counts requires rent_period_ar='سنوي', which silently EXCLUDES rows whose
-- rent_period_ar IS NULL, while search counts them as Yearly (not payment_monthly). Measured live:
-- search Yearly 46,630 vs counts Yearly 46,323 — a 307-row divergence, all NULL-period rows.
-- Two expressions computing "the same" thing is precisely what produced the earlier 58% monthly
-- undercount, so this replaces the duplicate logic with a read of the one source of truth.
--
-- METHOD: a targeted string replacement of ONLY the rent-period clause on the CURRENT live body, rather
-- than re-issuing a hand-copied full function body. Copying a stale body is what silently reverted the
-- rent-period fix once already (PR#120) — this cannot drop an unrelated clause, and it RAISES if the
-- expected clause is not found instead of silently doing nothing.
DO $mig$
DECLARE
  d text;
  old_clause text := 'and (p_rent_period is null
           or (p_rent_period = ''شهري''
               and (s.rent_period_ar = ''شهري'' or s.platform in (''gathern'',''aqarmonthly'')))
           or (p_rent_period = ''سنوي''
               and s.rent_period_ar = ''سنوي''
               and (s.platform is null or s.platform not in (''gathern'',''aqarmonthly'')))
           or (p_rent_period not in (''شهري'',''سنوي'') and s.rent_period_ar = p_rent_period))';
  new_clause text := 'and (p_rent_period is null
           or (p_rent_period = ''شهري'' and s.payment_monthly = true)
           or (p_rent_period = ''سنوي'' and s.payment_monthly = false)
           or (p_rent_period not in (''شهري'',''سنوي'') and s.rent_period_ar = p_rent_period))';
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'property_age_option_counts_ar';
  IF d IS NULL THEN
    RAISE EXCEPTION 'property_age_option_counts_ar not found';
  END IF;
  IF position(old_clause in d) = 0 THEN
    RAISE EXCEPTION 'expected rent-period clause not found in property_age_option_counts_ar — refusing to guess (body changed?)';
  END IF;
  d := replace(d, old_clause, new_clause);
  EXECUTE d;
END
$mig$;

NOTIFY pgrst, 'reload schema';
