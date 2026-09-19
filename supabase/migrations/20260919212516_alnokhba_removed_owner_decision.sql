-- alnokhba: REMOVED from the platform list — owner decision 2026-09-19.
--
-- This is a deliberate exception to the owner's own standing rule ("a source that fails is still
-- one of our platforms and is never deleted"), made by him after seeing the evidence, because
-- alnokhba is not a failing source — it is a source that no longer exists:
--   • alnokhba-services.com is NXDOMAIN. Registry expiry date 2026-07-07; no nameservers.
--   • No replacement domain exists. Probed alnokhba.sa, alnokhba-re.com, alnokhbaestate.com,
--     alnokhbaaqar.com, alnokhba.com.sa and alnokhba-services.sa — none resolve. alnokhba.com is
--     an unrelated "this website is for sale" parking page on a Trellian range.
-- A small Mecca agency that let its website lapse and did not rebuild it anywhere findable.
--
-- WHAT "REMOVED" MEANS HERE, PRECISELY:
--   • It stops being counted as one of our platforms, and needs no logo.
--   • The status stays 'retired' because that is the only non-active value this column takes and
--     the retired-platform CI guard keys on it — inventing a third value would silently fall
--     outside that guard. The REMOVAL is recorded in notes, which is what a human reads.
--   • Its 6 historical listing rows are KEPT. They are already inactive (0 active, 0 searchable),
--     so they are invisible to users, and deleting them would destroy the only record of what this
--     office ever advertised for no operational gain. Data deletion is not implied by "remove it
--     from the list" and is not performed here.
--   • It is dropped from the weekly retired-platform re-probe (scripts/reprobe-retired-platforms.mjs)
--     in the same change, because we are no longer waiting for it to come back.

update public.platform_registry
   set notes = 'REMOVED FROM THE PLATFORM LIST — owner decision 2026-09-19. Not a failing source: '
               || 'the company no longer has a website. alnokhba-services.com is NXDOMAIN (registry '
               || 'expiry 2026-07-07, no nameservers) and no replacement domain exists — alnokhba.sa, '
               || 'alnokhba-re.com, alnokhbaestate.com, alnokhbaaqar.com, alnokhba.com.sa and '
               || 'alnokhba-services.sa all fail to resolve; alnokhba.com is an unrelated '
               || '"website for sale" parking page. Small Mecca agency (النواريه / مخطط العمرة / '
               || 'البحيرات / مخطط باشراحيل), last scraped 2026-06-22. Not counted as a platform, '
               || 'needs no logo, and dropped from the weekly retired re-probe. Its 6 historical '
               || 'rows are KEPT and remain inactive — removal from the list is not deletion of '
               || 'data. If the domain is ever revived, scrapers/alnokhba/ is unchanged and works.',
       updated_at = now()
 where platform = 'alnokhba';
