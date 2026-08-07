-- P0 FIDELITY DEFECT (apartment advanced-filter audit wf_fce265de-a8a, 2026-08-05).
--
-- aqar_parse's furnished clause was `case when txt ~ 'مؤثث|مفروش' then true else null end`. «مفروش» is
-- a SUBSTRING of «غير مفروش» ("NOT furnished"), so an ad explicitly stating the flat is UNfurnished was
-- recorded as furnished=true. Proven by calling the live function directly:
--     aqar_parse('شقة مفروشة للايجار')      -> true   (correct)
--     aqar_parse('شقة غير مفروشة للايجار')  -> true   (WRONG — the source says the opposite)
-- trg_aqar_parse assigns `NEW.furnished := safe_bool(p->>'furnished')` UNCONDITIONALLY, so this parse
-- fully owns the column. Census: 3,511 active aqar rent apartments hold furnished=true and 121 of them
-- contain «غير مفروش»/«غير مؤثث» in their own stored source text. The column could never record FALSE
-- at all (0 false rows) — the tell that the clause was one-directional.
-- Impact: the Furnished chip is annual-rent-only and STRICT, so those 121 were served to users who
-- asked specifically for furnished flats, contradicting the source website.
--
-- Owner rule: the source is the truth; never fabricate; if the source is not confident, store unknown.
-- New semantics, in priority order:
--   1. negation present AND a standalone positive remains -> NULL  (contradictory = unknown)
--   2. negation present, no standalone positive           -> FALSE (the source stated it)
--   3. positive, no negation                              -> TRUE
--   4. neither                                            -> NULL  (unknown stays unknown)
-- Negated occurrences are stripped BEFORE the positive test, so «غير مفروش» cannot satisfy the positive
-- test via its own substring. This makes FALSE reachable for the first time.
do $mig$
declare
  src text; n int;
  old_expr constant text := 'case when txt ~ ''مؤثث|مفروش'' then true else null end';
  new_expr constant text :=
    'case when txt ~ ''غير[[:space:]]*(مفروش|مؤثث)'''
    || ' and regexp_replace(txt, ''غير[[:space:]]*(مفروش|مؤثث)[^[:space:]]*'', '' '', ''g'') ~ ''(مفروش|مؤثث)'' then null'
    || ' when txt ~ ''غير[[:space:]]*(مفروش|مؤثث)'' then false'
    || ' when txt ~ ''(مفروش|مؤثث)'' then true'
    || ' else null end';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'aqar_parse';
  if src is null then raise exception 'aqar_parse not found'; end if;

  n := (length(src) - length(replace(src, old_expr, ''))) / length(old_expr);
  if n <> 1 then
    raise exception 'expected exactly 1 furnished clause, found % — refusing to edit blind', n;
  end if;

  execute replace(src, old_expr, new_expr);
end
$mig$;

-- Prove the new semantics against the LIVE function. Any failure aborts the whole migration, so a bad
-- regex can never reach production. (`both` is a PL/pgSQL reserved word — hence v_ prefixes.)
do $verify$
declare v_pos text; v_neg text; v_mixed text; v_silent text;
begin
  v_pos    := public.aqar_parse('شقة مفروشة للايجار')->>'furnished';
  v_neg    := public.aqar_parse('شقة غير مفروشة للايجار')->>'furnished';
  v_mixed  := public.aqar_parse('تتوفر شقق مفروشة و شقق غير مفروشة')->>'furnished';
  v_silent := public.aqar_parse('شقة للايجار')->>'furnished';
  if v_pos    is distinct from 'true'  then raise exception 'positive must be true, got %', v_pos; end if;
  if v_neg    is distinct from 'false' then raise exception 'explicit negation must be false, got %', v_neg; end if;
  if v_mixed  is not null              then raise exception 'contradictory must be NULL, got %', v_mixed; end if;
  if v_silent is not null              then raise exception 'silent must be NULL, got %', v_silent; end if;
end
$verify$;
