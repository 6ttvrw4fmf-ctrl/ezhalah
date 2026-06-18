import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import type { Deal } from './taxonomy';

// Fetches the REAL Aqar listings + every column the new card design needs (rank/photo/title/
// price/RNPL badge/stat row/2-column features grid). Returns null on backend failure → the app's
// pools stay empty rather than swap in mocks. (user request: real listings only.)
export async function fetchListings(): Promise<Listing[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('aqar_residential_listings')
    .select(
      [
        'id', 'ad_number', 'listing_url',
        'property_type', 'transaction_type',
        'city', 'neighborhood',
        'price_annual', 'price_total',
        'area_m2', 'bedrooms', 'bathrooms',
        'master_bedrooms', 'halls',
        'parking', 'elevator', 'kitchen', 'maid_room',
        'air_conditioner', 'water_supply', 'electricity', 'sanitation',
        'private_entrance', 'optical_fibers', 'laundry_room', 'balcony_terrace',
        'photo_urls',
        'date_added',
        'rent_now_pay_later', 'rent_now_pay_later_monthly',
      ].join(', ')
    )
    .eq('active', true)
    .order('id', { ascending: false })
    .limit(1000);
  if (error || !data) return null;

  return data.map((r: any): Listing => {
    const deal: Deal = r.transaction_type === 'Buy' ? 'Buy' : 'Rent';
    const amount = deal === 'Rent' ? r.price_annual : r.price_total;
    const priceStr =
      typeof amount === 'number'
        ? `SAR ${amount.toLocaleString('en-US')}${deal === 'Rent' ? '/yr' : ''}`
        : 'Price on request';
    const photo = Array.isArray(r.photo_urls) && r.photo_urls.length > 0 ? r.photo_urls[0] : '';
    return {
      id: Number(r.id),
      type: r.property_type ?? 'Apartment',
      deal,
      city: r.city ?? '',
      district: r.neighborhood ?? '',
      road: '',
      price: priceStr,
      area: r.area_m2 ?? 0,
      beds: r.bedrooms ?? 0,
      source: 'Aqar',
      listed: r.date_added ?? 'recently',
      photo,
      source_url: r.listing_url,
      // Rich extras for the new card design — all optional, fall back to safe defaults.
      ad_number: r.ad_number,
      bathrooms: r.bathrooms ?? 0,
      master_bedrooms: r.master_bedrooms ?? 0,
      halls: r.halls ?? 0,
      photos: Array.isArray(r.photo_urls) ? r.photo_urls : [],
      rent_now_pay_later: !!r.rent_now_pay_later,
      rent_now_pay_later_monthly: r.rent_now_pay_later_monthly ?? null,
      features: {
        parking: !!r.parking,
        elevator: !!r.elevator,
        kitchen: !!r.kitchen,
        maid_room: !!r.maid_room,
        master_bedrooms: (r.master_bedrooms ?? 0) > 0,
        halls: (r.halls ?? 0) > 0,
        air_conditioner: !!r.air_conditioner,
        water_supply: !!r.water_supply,
        electricity: !!r.electricity,
        sanitation: !!r.sanitation,
        private_entrance: !!r.private_entrance,
        optical_fibers: !!r.optical_fibers,
        laundry_room: !!r.laundry_room,
        balcony_terrace: !!r.balcony_terrace,
      },
    };
  });
}
