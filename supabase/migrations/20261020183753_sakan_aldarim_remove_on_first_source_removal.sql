-- GRACE 1 for sakan and aldarim: remove an ad on the FIRST affirmative reading of the source's own removal
-- (owner 2026-10-20: «once we see it, remove it»). sakan prints «هذا العقار لم يعد متاحاً» on the expired ad's
-- own page; aldarim's API record answers 404 / availability_status «unavailable». Absence still never kills:
-- prune_unseen's at-grace verify_gone must answer «gone». Mirrored in scrapers/common/liveness_policies.py and
-- sql/mirrors/liveness_registry.json in the same change.
update public.ops_liveness_registry set grace = 1 where platform in ('sakan', 'aldarim');
do $proof$
begin
  if (select count(*) from public.ops_liveness_registry where platform in ('sakan', 'aldarim') and grace = 1) <> 2 then
    raise exception 'PROOF: sakan/aldarim grace is not 1';
  end if;
end
$proof$;
