import { supabase } from '@/lib/supabase';
import { reportError, reportMessage } from '@/lib/observability';
import type { Listing } from './listings';

// CPC monetization seam (PRD §13). Ezhalah's revenue is pay-per-click: every qualified click-through
// to a partner listing is logged here, and that row is what partners are billed against. Tracking
// must never interrupt the user — it no-ops without a backend and never throws. It does NOT swallow
// silently: every refused insert is reported (2026-11-07 — a stale FK refused every click from 06-18
// for five months, the error was dropped here, and `clicks` sat at 33 rows with nothing alarmed). The
// DB side is watched too: mon_detect_heartbeat_silent pages when `clicks` stops growing.
export type ClickEvent = {
  listing_id: number;
  source: string;
  deal: string;
  city: string;
  type: string;
  user_sub: string | null;
  ts: string;
};

export async function trackClick(listing: Listing, userSub: string | null): Promise<void> {
  const event: ClickEvent = {
    listing_id: listing.id,
    source: listing.source,
    deal: listing.deal,
    city: listing.city,
    type: listing.type,
    user_sub: userSub,
    ts: new Date().toISOString(),
  };
  if (!supabase) {
    if (__DEV__) console.log('[cpc] click', event);
    return;
  }
  try {
    const { error } = await supabase.from('clicks').insert(event);
    if (error) reportMessage('click_insert_failed', { code: error.code, message: error.message, source: event.source });
  } catch (e) {
    // A failed insert must not break the click-through — but it is reported, never dropped.
    reportError(e, { where: 'trackClick', source: event.source });
  }
}
