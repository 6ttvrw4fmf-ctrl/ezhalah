-- gathern GTH259013 (gathern_residential_listings 964708) was retracted 2026-11-02 on two bare 404
-- reads of its own page; a bare 404 is no longer a gathern reading (PR #10215). Its own page
-- https://gathern.co/view/185168/unit/259013 read LIVE in a browser on 2026-11-04 (full unit page:
-- «استديو بسرير ماستر وجلسة جانبية», الخبر - حي الحمراء, 75 m², matching the served row), and the
-- crawl stamped last_verified_alive_at 2026-11-03 15:37 after the retraction. Source is truth: the
-- adjudication is recorded as superseded with that evidence; the ledger row stays.
do $$
begin
  if not exists (select 1 from public.ops_adjudicated_retraction r
                   join public.gathern_residential_listings g on g.id = r.listing_id
                  where r.source_table = 'gathern_residential_listings' and r.listing_id = 964708
                    and g.ad_number = 'GTH259013' and g.active
                    and g.last_verified_alive_at > r.retracted_at) then
    raise exception 'GTH259013 is not an active, re-verified, adjudicated row — refusing';
  end if;
end $$;

insert into public.ops_adjudication_superseded (source_table, listing_id, evidence) values
  ('gathern_residential_listings', 964708,
   '{"why":"own page read LIVE 2026-11-04 after the 11-02 bare-404 retraction (HTTP 200 on https://gathern.co/view/185168/unit/259013, full unit page, 75 m², الخبر - حي الحمراء)","task":"liveness-direct-oracles","crawl_last_verified_alive_at":"2026-11-03T15:37:26Z"}'::jsonb)
on conflict do nothing;
