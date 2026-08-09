-- Mirror of the applied migration 20260809112129 (see the DB for the authoritative body).
--
-- trg_aqar_parse assigned `furnished` from the PROSE parse unconditionally:
--     NEW.furnished := public.safe_bool(p->>'furnished');
-- `aqar_parse` returns NULL when the description simply does not mention furnishing (verified live:
-- aqar_parse('… تفاصيل الإعلان المساحة 120 م² …')->>'furnished' IS NULL), so every row whose seller
-- blurb happens not to use the word had its furnished value overwritten with NULL — including the
-- value the scraper had just read from aqar's OWN structured `furnished` key (PR#334, 2026-08-07).
-- The DB layer was quietly discarding the field the recovery run existed to obtain.
--
-- Same bug class as the aqar price path fixed the same day: a prose scan overriding aqar's own
-- statement. This is deliberately the SMALLEST change that stops the destruction — coalesce, not a
-- precedence swap. Prose still wins whenever it makes a statement; it just no longer gets to erase
-- one. coalesce can only preserve a value, never fabricate one, so no row can gain a furnished flag
-- it did not already have.
--
-- Verified live after applying (temp table + the real trigger, 4/4):
--   structured true  + prose silent   -> true   (survives; this is the bug being fixed)
--   structured true  + «غير مفروشة»  -> false  (a real prose statement still overrides)
--   structured null  + prose silent   -> null   (nothing stated anywhere stays unknown)
--   structured false + prose silent   -> false  (a source-published negative is preserved)
do $mig$
declare
  src    text;
  needle text := 'NEW.furnished       := public.safe_bool(p->>''furnished'');';
  repl   text := 'NEW.furnished       := coalesce(public.safe_bool(p->>''furnished''), NEW.furnished);';
  n int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'trg_aqar_parse';

  if src is null then
    raise exception 'trg_aqar_parse not found';
  end if;

  -- Already applied (idempotent re-run against a patched body) — nothing to do.
  if position(repl in src) > 0 then
    return;
  end if;

  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then
    raise exception 'expected exactly 1 occurrence of the furnished assignment, found %', n;
  end if;

  execute replace(src, needle, repl);
end
$mig$;

do $verify$
declare
  src text;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'trg_aqar_parse';

  if position('coalesce(public.safe_bool(p->>''furnished''), NEW.furnished)' in src) = 0 then
    raise exception 'coalesce not present after edit';
  end if;
  if position('NEW.furnished       := public.safe_bool(p->>''furnished'');' in src) > 0 then
    raise exception 'the unconditional wipe is still present';
  end if;
  if (public.aqar_parse('شقة غير مفروشة للإيجار تفاصيل الإعلان')->>'furnished') is distinct from 'false' then
    raise exception 'prose negation no longer reads as false';
  end if;
  if (public.aqar_parse('شقة مفروشة للإيجار تفاصيل الإعلان')->>'furnished') is distinct from 'true' then
    raise exception 'prose positive no longer reads as true';
  end if;
  if (public.aqar_parse('شقة للإيجار تفاصيل الإعلان المساحة 120')->>'furnished') is not null then
    raise exception 'prose silence should still be NULL at the parser level';
  end if;
end
$verify$;
