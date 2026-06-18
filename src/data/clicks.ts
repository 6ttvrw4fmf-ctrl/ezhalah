import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';

// CPC monetization seam (PRD §13). Ezhalah's revenue is pay-per-click: every qualified click-through
// to a partner listing is logged here, and that row is what partners are billed against. Tracking
// must never interrupt the user — it no-ops without a backend and swallows its own errors.
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
    await supabase.from('clicks').insert(event);
  } catch {
    // Billing telemetry is best-effort; a failed insert must not break the click-through.
  }
}
