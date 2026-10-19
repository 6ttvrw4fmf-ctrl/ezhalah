-- LAND enforce_price_size_sanity() AS ONE EXPLICIT DEFINITION, BECAUSE A NEEDLE EDIT IS OPAQUE TO
-- THE GUARD THAT PROTECTS THE RNPL RULE.
--
-- 20260927074523 appended the mirror-drop arm to this trigger with a needle edit, chosen so a
-- concurrent session's change to the same function could not be clobbered. Correct reasoning, wrong
-- function: `scripts/verify-rnpl-guard-replay.ts` REPLAYS this trigger out of committed migrations to
-- prove the owner's PERMANENT 2026-08-09 rule is still in it -- RNPL is an ANNUAL contract paid in
-- instalments and must NEVER become Monthly. Replay understands a definition and a declared-variable
-- patch idiom; it could not interpret that DO-block, so it reported:
--
--   FAIL  replay resolves enforce_price_size_sanity to a single effective body
--         cannot interpret: 20260927074523_... (unrecognised change) -- teach scripts/lib/rpcReplay.ts
--         this shape, or land an explicit CREATE OR REPLACE.
--
-- The guard is right and it is the reason this migration exists. It refuses to GUESS at the effective
-- body of the one function carrying that rule, which is exactly the behaviour wanted: an
-- unverifiable RNPL protection must read as failure, never as health. Adding the file to
-- AUDITED_UNINTERPRETABLE was available and is the wrong answer -- it would retire replay coverage of
-- an owner-locked rule to make a red turn green.
--
-- So: the full body, verbatim from production (md5 of pg_get_functiondef = 716a0528de30e5725da1ca9d778b6d44
-- immediately before this was written). replayFunction() treats a definition as wiping the slate --
-- `body = def; unresolved = []` -- so from here the trigger resolves to one effective body and the
-- RNPL arm is verifiable in committed SQL again. SEMANTICALLY A NO-OP: byte-for-byte what production
-- was already running, so nothing about listing data changes.
--
-- The lesson worth keeping: a needle edit is the right tool for a shared roster array, and the wrong
-- tool for a function whose correctness some barrier reconstructs from git. Prefer an explicit
-- definition wherever a replay-based guard reads the function.

CREATE OR REPLACE FUNCTION public.enforce_price_size_sanity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Evidence-gated: an extreme value that the SOURCE publishes is never hidden (owner rule).
  -- The predicate itself is untouched; only proven-source rows are exempt from the hide.
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2)
     and not exists (
       select 1 from public.ops_price_source_verified v
        where v.source_table = NEW.source_table
          and v.listing_id  = NEW.listing_id)
  then
    NEW.production_ready := false;
  end if;

  if NEW.type_ar is not null and not exists (select 1 from public.known_type_ar k where k.type_ar = NEW.type_ar) then
    NEW.type_ar := 'غير معروف';
  end if;

  -- NOTE: the sub-1000 Buy price gate was deliberately removed upstream (owner rule: a
  -- source-published price is never hidden, at any magnitude). Do NOT reinstate it here.
  --
  -- RNPL = an ANNUAL contract paid in instalments; it must NEVER become Monthly, on any platform.
  -- Identical predicate to sync_payment_monthly() and to the شهري bucket in the search/counts RPCs,
  -- so writer, trigger and reader can never disagree. (owner PERMANENT rule 2026-08-09.)
  if NEW.rent_period_ar = 'شهري' then
    NEW.payment_monthly := not coalesce(NEW.rent_now_pay_later, false);
  elsif NEW.rent_period_ar = 'سنوي' then
    NEW.payment_monthly := false;
  end if;

  -- "not applicable" is NULL, never 0. A Buy listing has no annual rent and a Rent
  -- listing has no sale total; a 0 in the inapplicable column is a placeholder we
  -- invented, not a figure any source published. (2026-08-10 Filter audit.)
  -- A source-published 0 in the APPLICABLE column is left untouched and stays
  -- searchable — see feedback_no-hiding-source-published-prices-rule.
  if NEW.deal_ar = 'بيع' and NEW.price_annual = 0 then NEW.price_annual := null; end if;
  if NEW.deal_ar = 'إيجار' and NEW.price_total = 0 then NEW.price_total := null; end if;

  -- An EXACT duplicate of the applicable price sitting in the inapplicable column carries no
  -- source figure of its own, so dropping it loses nothing (routine #3, 2026-09-27,
  -- ops_incident #840). A column holding a DIFFERENT value is deliberately left alone: it may
  -- be source-published, and only source adjudication may decide.
  case public.price_inapplicable_mirror(NEW.deal_ar, NEW.price_total, NEW.price_annual)
    when 'price_annual' then NEW.price_annual := null;
    when 'price_total'  then NEW.price_total  := null;
    else null;
  end case;

  return NEW;
end
$function$;
