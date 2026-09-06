-- FOUR NEW ROUTINES (owner, 2026-09-04), and the surfaces that make them reachable.
--
-- The seven existing routines own SURFACES. These four own something else entirely, and that is
-- precisely what keeps ownership non-overlapping — the owner's explicit requirement. Splitting a
-- surface creates a boundary dispute; giving a routine a different OBJECT does not:
--
--   8  Regression Hunter   the GAPS BETWEEN owned surfaces, and fixes that did not hold.
--   9  Production Red Team the AGREEMENT between layers on production (action = request = RPC
--                          params = DB truth = displayed count = returned ids = card evidence).
--   10 Barrier Engineer    the VERIFICATION APPARATUS itself — never the product. A barrier that
--                          asserts the bug, a check with no mutation proof, a test that passes
--                          while production is wrong.
--   11 Listing Lifecycle   what happens to a listing AFTER its source confirms it is gone:
--                          inactive -> unsearchable -> 30 days -> deleted, and every way a dead
--                          listing can still be seen, counted, or resurrected.
--
-- WHY THESE DO NOT COLLIDE WITH #1/#3. #1 owns whether the crawl RAN. #3 owns the field truth of a
-- listing that is ALIVE. #11 owns only the period after the source has confirmed the listing is
-- gone. The three meet at a listing and never at the same question.
--
-- THE ONE RULE #11 CANNOT BEND: UNKNOWN IS NOT DEAD. A timeout, a proxy failure, a parser failure,
-- a missing crawl, a 403 or a 500 must never remove a listing or start its deletion clock. That is
-- the same three-valued discipline docs/ops/LISTING_LIVENESS.md already makes architectural, and
-- `unknown_treated_as_dead` is the alert kind that fires when it is broken.
create or replace function public.incident_known_surfaces()
returns text[] language sql immutable as $fn$
  select array[
    -- product surfaces
    'advanced_filter','trending','search','matching','normal_filter','pagination','result_card',
    'auth','session','sidebar','chat_persistence','navigation','theme','voice','loading_states','modal',
    'agent','interview','share','feedback','account_menu','devices','support','browser','intro','mode_switch',
    -- data + pipeline surfaces
    'data_integrity','price','location','listing','scraper','ingestion',
    -- operational surfaces
    'deploy','monitoring','alerting','cron','seam','migration',
    -- the four objects added 2026-09-04
    'regression','production_truth','barrier','test_infra','lifecycle','inactive_listing'
  ]
$fn$;

create or replace function public.incident_route_owner(p_surface text)
returns text language sql immutable as $fn$
  select case lower(coalesce(p_surface, ''))
    when 'advanced_filter'   then 'routine-5-af-trending'
    when 'trending'          then 'routine-5-af-trending'
    when 'interview'         then 'routine-5-af-trending'
    when 'search'            then 'routine-4-search-qa'
    when 'matching'          then 'routine-4-search-qa'
    when 'normal_filter'     then 'routine-4-search-qa'
    when 'pagination'        then 'routine-4-search-qa'
    when 'result_card'       then 'routine-4-search-qa'
    when 'auth'              then 'routine-6-journey'
    when 'session'           then 'routine-6-journey'
    when 'sidebar'           then 'routine-6-journey'
    when 'chat_persistence'  then 'routine-6-journey'
    when 'navigation'        then 'routine-6-journey'
    when 'theme'             then 'routine-6-journey'
    when 'voice'             then 'routine-6-journey'
    when 'loading_states'    then 'routine-6-journey'
    when 'modal'             then 'routine-6-journey'
    when 'share'             then 'routine-6-journey'
    when 'feedback'          then 'routine-6-journey'
    when 'account_menu'      then 'routine-6-journey'
    when 'devices'           then 'routine-6-journey'
    when 'support'           then 'routine-6-journey'
    when 'browser'           then 'routine-6-journey'
    when 'intro'             then 'routine-6-journey'
    when 'mode_switch'       then 'routine-6-journey'
    when 'agent'             then 'routine-2-production'
    when 'data_integrity'    then 'routine-3-data-integrity'
    when 'price'             then 'routine-3-data-integrity'
    when 'location'          then 'routine-3-data-integrity'
    when 'listing'           then 'routine-3-data-integrity'
    when 'scraper'           then 'routine-1-scraping'
    when 'ingestion'         then 'routine-1-scraping'
    when 'deploy'            then 'routine-7-seam'
    when 'monitoring'        then 'routine-7-seam'
    when 'alerting'          then 'routine-7-seam'
    when 'cron'              then 'routine-7-seam'
    when 'seam'              then 'routine-7-seam'
    when 'migration'         then 'routine-7-seam'
    -- the four objects added 2026-09-04
    when 'regression'        then 'routine-8-regression-hunter'
    when 'production_truth'  then 'routine-9-red-team'
    when 'barrier'           then 'routine-10-barrier'
    when 'test_infra'        then 'routine-10-barrier'
    when 'lifecycle'         then 'routine-11-lifecycle'
    when 'inactive_listing'  then 'routine-11-lifecycle'
    else 'routine-2-production'
  end
$fn$;