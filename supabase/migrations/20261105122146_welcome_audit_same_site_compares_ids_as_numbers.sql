-- Fix to welcome_audit_same_site_repost_counts_once: the recount's a_b.listing_id is TEXT (s.listing_id::text), so
-- its same-site rule compared ids as text ('999' > '1000') while the builder compares bigints. For a repost pair the
-- two kept DIFFERENT copies, so 100 facts' counts differed by one and were removed at the 2026-11-05 12:02 audit
-- (every audit before that day: 0 failures). The recount now compares the ids as numbers, like the builder.
do $mig$
declare
  d text := pg_get_functiondef('public.audit_welcome_insights'::regproc);
  a constant text := 'and y.platform = x.platform and y.listing_id < x.listing_id';
  b constant text := 'and y.platform = x.platform and y.listing_id::bigint < x.listing_id::bigint';
begin
  if position(b in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'audit_welcome_insights: same-site id comparison not found exactly once';
  end if;
  execute replace(d, a, b);
end
$mig$;
