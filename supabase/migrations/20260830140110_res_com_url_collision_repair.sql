-- Repair the res-vs-com URL collision: one source ad, two production_ready rows, two user-visible
-- cards, one destination URL. Found by Search & Matching QA 2026-08-12 (detector
-- mon_detect_url_collisions_res_vs_com), root-caused and repaired 2026-08-30.
--
-- ROOT CAUSE (upstream, fixed in scrapers/common/db.py::retire_superseded_siblings):
--   A dual-table platform routes each ad to exactly ONE of <platform>_{residential,commercial}
--   _listings from the source page. When that decision changes between runs, the ad is written to
--   the new table and the row in the old one is abandoned. prune_unseen cannot clean it up — it
--   reasons from ABSENCE and every circuit breaker it has protects the orphan; worse, verify_gone
--   probes the source URL, finds it live (the ad IS alive, in the sibling table) and SELF-HEALS
--   missing_count back to 0. Measured: five sadin commercial rows last parsed 2026-07-26 still
--   carried missing_count = 0 and last_seen_at = 2026-08-30.
--
-- THIS MIGRATION DOES NOT HARDCODE ROW IDS. It re-derives the adjudication from the same rule the
-- repair was reviewed under, so it cannot retire anything the evidence does not support, and it is
-- idempotent (already-inactive rows are skipped and keep their original deactivated_at).
--
-- A pair is REPAIRABLE only when ALL hold; anything else is recorded AMBIGUOUS and left untouched:
--   1. both rows carry the SAME ad_number AND the SAME lowercased listing_url — identity is the
--      platform's own id, never similarity. This is what protects a genuinely distinct
--      cross-category listing: two different ads have two different ad_numbers and are never paired.
--   2. the surviving COMMERCIAL row is active and production_ready — so no inventory is lost.
--   3. the SOURCE'S OWN published text carries an explicit commercial marker for the property kind.
--      Nothing is inferred from our derived columns, from recency, or from which row looks tidier.
--
-- Nothing is ever DELETED. Rows are deactivated, so every repair is reversible and the source row
-- is preserved for audit; prune_inactive_from_search() then drops it from search_listings_ar on the
-- next sync, exactly as for any other inactivation.

create table if not exists public.ops_res_com_collision_adjudication (
  id             bigserial primary key,
  adjudicated_at timestamptz not null default now(),
  platform       text        not null,
  ad_number      text        not null,
  listing_url    text        not null,
  res_id         bigint      not null,
  com_id         bigint      not null,
  verdict        text        not null check (verdict in ('REPAIRABLE', 'AMBIGUOUS')),
  evidence       text[],
  reason         text,
  res_active_before boolean,
  res_active_after  boolean
);
comment on table public.ops_res_com_collision_adjudication is
  'Per-pair evidence for the res-vs-com URL collision repair (2026-08-30). One row per colliding '
  'pair with the SOURCE-PUBLISHED markers that justified retiring the residential side, or the '
  'reason it was left untouched. Deactivation only — nothing was deleted, so every row here is '
  'reversible. Search QA owns the detector; Data Integrity owns the repair.';

do $$
declare
  v_repaired int := 0;
  v_n int := 0;
  v_ambiguous int := 0;
begin
  create temp table _adj on commit drop as
  with markers(m) as (values
    ('أرض تجارية'),('ارض تجارية'),('اراضي تجارية'),('أراضٍ تجارية'),('أراضي تجارية'),
    ('عمارة تجارية'),('عماره تجارية'),('مجمع تجاري'),('مبنى تجاري'),('محل تجاري'),('محلات تجارية'),
    ('محطة وقود'),('محطة بنزين'),('محطه للبيع'),('محطة للبيع'),('محطة للإيجار'),('رخصة محطة'),
    ('معرض'),('مستودع'),('ورشة'),('مصنع'),('فندق'),('مكتب تجاري')
  ), r as (
    select 'sadin'::text p, id, ad_number, listing_url, active, title, description,
           source_capture->>'source_text' cap from public.sadin_residential_listings
    union all
    select 'dealapp', id, ad_number, listing_url, active, title, description,
           source_capture->>'source_text' from public.dealapp_residential_listings
  ), c as (
    select 'sadin'::text p, id, ad_number, listing_url, active, title, description,
           source_capture->>'source_text' cap from public.sadin_commercial_listings
    union all
    select 'dealapp', id, ad_number, listing_url, active, title, description,
           source_capture->>'source_text' from public.dealapp_commercial_listings
  )
  select r.p platform, r.ad_number, r.listing_url, r.id res_id, c.id com_id, r.active res_active,
         (r.ad_number = c.ad_number)                     as same_ad,
         (lower(r.listing_url) = lower(c.listing_url))   as same_url,
         (c.active and sc.listing_id is not null)        as com_live,
         (select array_agg(m) from markers
           where concat_ws(' | ', r.title, c.title, r.description, c.description, r.cap, c.cap)
                 like '%'||m||'%')                       as evidence
  from r
  join c  on c.p = r.p and lower(c.listing_url) = lower(r.listing_url)
  join public.search_listings_ar sr
        on sr.listing_id = r.id and sr.source_table = r.p||'_residential_listings'
       and sr.production_ready
  left join public.search_listings_ar sc
        on sc.listing_id = c.id and sc.source_table = c.p||'_commercial_listings'
       and sc.production_ready;

  insert into public.ops_res_com_collision_adjudication
    (platform, ad_number, listing_url, res_id, com_id, verdict, evidence, reason,
     res_active_before, res_active_after)
  select platform, ad_number, listing_url, res_id, com_id,
         case when same_ad and same_url and com_live and evidence is not null
              then 'REPAIRABLE' else 'AMBIGUOUS' end,
         evidence,
         concat_ws('; ',
           case when not same_ad  then 'ad_number differs' end,
           case when not same_url then 'listing_url differs' end,
           case when not com_live then 'commercial row not active/production_ready — retiring the residential row would REMOVE this listing from search' end,
           case when evidence is null then 'no explicit commercial marker in the source text' end,
           case when same_ad and same_url and com_live and evidence is not null
                then 'source publishes an explicit commercial marker; commercial row survives' end),
         res_active,
         case when same_ad and same_url and com_live and evidence is not null
              then false else res_active end
  from _adj;

  update public.sadin_residential_listings t
     set active = false, deactivated_at = now()
    from _adj a
   where a.platform = 'sadin' and a.res_id = t.id and t.active
     and a.same_ad and a.same_url and a.com_live and a.evidence is not null;
  get diagnostics v_repaired = row_count;

  update public.dealapp_residential_listings t
     set active = false, deactivated_at = now()
    from _adj a
   where a.platform = 'dealapp' and a.res_id = t.id and t.active
     and a.same_ad and a.same_url and a.com_live and a.evidence is not null;
  get diagnostics v_n = row_count;
  v_repaired := v_repaired + v_n;

  select count(*) into v_ambiguous from _adj
   where not (same_ad and same_url and com_live and evidence is not null);

  raise notice 'res/com collision repair: % residential row(s) retired, % left AMBIGUOUS (untouched)',
    v_repaired, v_ambiguous;
end $$;
