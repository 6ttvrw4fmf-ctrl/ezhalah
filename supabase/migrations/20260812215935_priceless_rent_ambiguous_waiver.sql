-- Waiver table for mon_detect_priceless_rent_with_labelled_source_price(), mirroring the
-- established ops_price_eq_area_verified pattern (same shape, same RLS posture: enabled with zero
-- policies so only service_role/postgres and SECURITY DEFINER functions can touch it, grants kept
-- identical for consistency). Seeded with the 4 rows from closed-review GH issue #539 whose source
-- text is genuinely ambiguous (no explicit شهري/سنوي period tag, or one ad describing two
-- different priced units) -- confirmed independently against each row's live description text
-- before writing this migration, not just copied from the issue comment.
create table if not exists public.ops_priceless_rent_ambiguous_verified (
  source_table text not null,
  listing_id bigint not null,
  evidence text not null,
  verified_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);

alter table public.ops_priceless_rent_ambiguous_verified enable row level security;

grant select, insert, update, delete, truncate, references, trigger
  on public.ops_priceless_rent_ambiguous_verified to postgres, authenticated, anon, service_role;

insert into public.ops_priceless_rent_ambiguous_verified (source_table, listing_id, evidence) values
  ('aqar_residential_listings', 17280,
   'Description states two payment-plan totals only -- «55000 ريال دفعة / 60000 دفعتين» (one '
   'payment vs two payments) -- with no month/year period tag anywhere on the price. Cannot be '
   'safely classified as monthly or annual without guessing.'),
  ('aqar_residential_listings', 20456,
   'Description states «قيمة الايجار: 1500ريال» plus a separate «عقد لمدة سنة» (contract length '
   'one year) line. Contract length is not the same field as rent period per the '
   'period-is-source-truth rule -- the price itself carries no explicit شهري/سنوي tag, so the '
   '1500 SAR could be a monthly figure on a 1-year contract or an annual figure; not inferable.'),
  ('aqar_residential_listings', 36897,
   'Description states «الإيجار: 12,000 ريال» with no month/year period tag anywhere in the ad '
   '(a 4.6 m2 غرفة حارس / guard room listing). No structural cue (per-unit context, contract '
   'clause, or comparable nearby listing) to disambiguate monthly vs annual.'),
  ('eaqartabuk_residential_listings', 598669,
   'Single ad describes TWO different residential units in one multi-unit building, each with '
   'its own price and neither tagged with a period: «1) ملحق 6 غرف ... الإيجار: 2,500 ريال» and '
   '«2) شقة 5 غرف ... الإيجار: 1,800 ريال». Even if a period could be inferred, it is unclear '
   'which of the two units (if either) this listing row actually represents.')
on conflict (source_table, listing_id) do nothing;

-- Needle-edit the detector to skip verified-ambiguous rows, guarded with occurrence-count and
-- live-behavior assertions so a mismatched base body aborts the whole transaction instead of
-- silently doing nothing or double-patching (the RPC full-body-replace hazard this repo has hit
-- before).
do $do$
declare
  live_before text;
  needle text := $needle$and r.description ~ %L
    $f$, t, t, pat) into n_rows;$needle$;
  replacement text := $repl$and r.description ~ %L
        and not exists (
          select 1 from public.ops_priceless_rent_ambiguous_verified v
          where v.source_table = %L and v.listing_id = r.id
        )
    $f$, t, t, pat, t) into n_rows;$repl$;
  occ_count int;
  new_body text;
  before_count int;
  after_count int;
begin
  select pg_get_functiondef(p.oid) into live_before
  from pg_proc p where p.proname = 'mon_detect_priceless_rent_with_labelled_source_price'
    and p.pronamespace = 'public'::regnamespace;

  occ_count := (length(live_before) - length(replace(live_before, needle, ''))) / length(needle);
  if occ_count <> 1 then
    raise exception 'ABORT: needle occurs % times in live def, expected exactly 1', occ_count;
  end if;

  new_body := replace(live_before, needle, replacement);
  execute new_body;

  -- behavior check: the live count must drop by exactly the 4 newly-seeded ambiguous rows
  select public.mon_detect_priceless_rent_with_labelled_source_price() into after_count;

  if after_count <> 0 then
    raise exception 'ABORT: detector still returns % after waiver wiring, expected 0 (only the 4 waived rows remained pre-fix)', after_count;
  end if;

  raise notice 'SUCCESS: waiver wired, detector now returns 0 (4 ambiguous rows correctly suppressed)';
end $do$;