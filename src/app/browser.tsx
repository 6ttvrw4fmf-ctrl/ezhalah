import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import type { Listing } from '@/data/listings';
import { useApp } from '@/store';
import { useI18n, t as tr, tPrice } from '@/i18n';
import { translitPlace, regionFromUrl } from '@/lib/translitPlace';

const IS_WEB = Platform.OS === 'web';

// Feature flags → (icon, label) for the detail page's amenities grid. Mirrors the card's set.
const FEATURE_META: Array<{ key: keyof NonNullable<Listing['features']>; icon: any; label: string }> = [
  { key: 'parking', icon: 'car-outline', label: 'Parking' },
  { key: 'maid_room', icon: 'person-outline', label: 'Maid Room' },
  { key: 'elevator', icon: 'arrow-up-circle-outline', label: 'Elevator' },
  { key: 'master_bedrooms', icon: 'bed-outline', label: 'Master Bedrooms' },
  { key: 'kitchen', icon: 'restaurant-outline', label: 'Kitchen' },
  { key: 'halls', icon: 'home-outline', label: 'Halls / Majlis' },
  { key: 'balcony_terrace', icon: 'leaf-outline', label: 'Balcony / Terrace' },
  { key: 'laundry_room', icon: 'water-outline', label: 'Laundry Room' },
  { key: 'private_entrance', icon: 'walk-outline', label: 'Private Entrance' },
  { key: 'air_conditioner', icon: 'snow-outline', label: 'Air Conditioning' },
  { key: 'optical_fibers', icon: 'wifi-outline', label: 'Fiber Internet' },
  { key: 'water_supply', icon: 'water-outline', label: 'Water Supply' },
  { key: 'electricity', icon: 'flash-outline', label: 'Electricity' },
  { key: 'sanitation', icon: 'shield-checkmark-outline', label: 'Sanitation' },
];

// In-app listing detail page. We CANNOT iframe the source platform (Aqar sends x-frame-options:
// SAMEORIGIN, which the browser enforces — "refused to connect"). Instead Ezhalah shows its OWN
// detail page from the data we already scraped (photos, price, specs, features), keeping the user
// inside the app, and only sends them to the partner via an explicit "View on Aqar" button when they
// want to contact the agent. This is the standard aggregator pattern and can never break. (user
// request: keep the experience in-app; "find a way to solve" the iframe block.)
export default function Browser() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, isRTL } = useI18n();
  const { trackOpen, findListing } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();

  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [resolving, setResolving] = useState(true);
  useEffect(() => {
    let alive = true;
    setResolving(true);
    findListing(Number(id)).then((l) => {
      if (!alive) return;
      setListing(l);
      setResolving(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Resolve the partner URL in the app's language (Aqar has an /en variant) for the "View on Aqar"
  // hand-off. We don't iframe it — only open it in a new tab / system browser on demand.
  const localizeAqarUrl = (url?: string | null): string | undefined => {
    if (!url) return undefined;
    if (locale !== 'en') return url;
    const m = url.match(/^(https?:\/\/sa\.aqar\.fm)(\/.*)$/);
    if (!m) return url;
    if (m[2].startsWith('/en/') || m[2] === '/en') return url;
    return `${m[1]}/en${m[2]}`;
  };
  const sourceUrl = localizeAqarUrl(listing?.source_url);

  // Open the source listing — counts as the CPC click-through (PRD §13) since this is the moment the
  // user actually leaves to the partner.
  const openSource = () => {
    if (!sourceUrl) return;
    if (listing) trackOpen(listing);
    if (IS_WEB && typeof window !== 'undefined') window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    else Linking.openURL(sourceUrl);
  };

  if (resolving) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  if (!listing) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <Text>{t('Listing not found.')}</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.primary, marginTop: 8 }}>{t('Done')}</Text></Pressable>
      </View>
    );
  }

  const txtAlign = isRTL ? ('right' as const) : ('left' as const);
  const wDir = isRTL ? ('rtl' as const) : ('ltr' as const);
  const place = (raw: string) => (locale === 'en' && raw ? translitPlace(raw) : raw);
  const region = regionFromUrl(listing.source_url);
  const regionLabel = region ? (locale === 'en' ? region.en : region.ar) : '';
  // Clean photo list — drop malformed entries the scraper occasionally captured.
  const photos = (listing.photos && listing.photos.length ? listing.photos : (listing.photo ? [listing.photo] : []))
    .filter((u) => typeof u === 'string' && /^https?:\/\/\S+\.(jpg|jpeg|png|webp)/i.test(u));
  const features = listing.features ? FEATURE_META.filter((m) => Boolean(listing.features?.[m.key])) : [];

  const detail = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Photo gallery — horizontal swipe. */}
      {photos.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.gallery}>
          {photos.map((u, i) => (
            <Image key={i} source={{ uri: u }} style={[s.galleryPhoto, { width: Math.min(width, 980) }]} contentFit="cover" transition={150} />
          ))}
        </ScrollView>
      ) : (
        <View style={[s.gallery, s.galleryEmpty]}><Ionicons name="image-outline" size={40} color={colors.muted} /></View>
      )}

      <View style={s.body}>
        {/* Type + deal */}
        <View style={s.typeRow}>
          <Ionicons name="home-outline" size={14} color={colors.muted} />
          <Text style={s.typeLabel}>{t(listing.type)} {t(listing.deal === 'Rent' ? 'for Rent' : 'for Sale')}</Text>
        </View>
        {/* Title */}
        <Text style={[s.titleBig, { textAlign: txtAlign, writingDirection: wDir }]}>
          {place(t(listing.district)) || place(t(listing.city))}{listing.district ? `, ${place(t(listing.city))}` : ''}
        </Text>
        {/* Location + region chip */}
        <View style={s.locRow}>
          <Ionicons name="location-outline" size={13} color={colors.primary} />
          <Text style={s.locText}>{place(t(listing.city))}, {t('Saudi Arabia')}</Text>
          {regionLabel ? (
            <View style={s.regionChip}>
              <Ionicons name="compass-outline" size={10} color={colors.primary} />
              <Text style={s.regionChipText}>{regionLabel}</Text>
            </View>
          ) : null}
        </View>
        {/* Price */}
        <Text style={s.priceBig}>{tPrice(listing.price)}</Text>
        {/* RNPL */}
        {listing.rent_now_pay_later ? (
          <View style={s.rnpl}>
            <Text style={s.rnplCta}>EJARI · {t('Rent now, pay later')}</Text>
            {listing.rent_now_pay_later_monthly ? (
              <Text style={s.rnplFrom}>{t('from')} SAR {Number(listing.rent_now_pay_later_monthly).toLocaleString('en-US')}/{t('month')}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Key specs */}
        <View style={s.specsGrid}>
          {listing.beds > 0 ? <Spec icon="bed-outline" k={t(listing.beds === 1 ? 'Bed' : 'Beds')} v={String(listing.beds)} /> : null}
          {(listing.bathrooms ?? 0) > 0 ? <Spec icon="water-outline" k={t(listing.bathrooms === 1 ? 'Bath' : 'Baths')} v={String(listing.bathrooms)} /> : null}
          {listing.area > 0 ? <Spec icon="resize-outline" k={t('Area')} v={`${listing.area} ${tr('m²')}`} /> : null}
          {(listing.halls ?? 0) > 0 ? <Spec icon="home-outline" k={t('Halls / Majlis')} v={String(listing.halls)} /> : null}
          {(listing.master_bedrooms ?? 0) > 0 ? <Spec icon="bed-outline" k={t('Master Bedrooms')} v={String(listing.master_bedrooms)} /> : null}
          {listing.listed ? <Spec icon="calendar-outline" k={t('Added')} v={listing.listed} /> : null}
        </View>

        {/* Features */}
        {features.length > 0 ? (
          <>
            <Text style={[s.sec, { textAlign: txtAlign }]}>{t('Features')}</Text>
            <View style={s.featGrid}>
              {features.map((f) => (
                <View key={f.key} style={s.featCell}>
                  <Ionicons name={f.icon} size={15} color={colors.primary} />
                  <Text style={s.featText}>{t(f.label)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Source disclaimer */}
        <View style={s.hostNote}>
          <Ionicons name="information-circle-outline" size={15} color={colors.muted} />
          <Text style={[s.hostNoteText, { textAlign: txtAlign }]}>
            {t('This listing is hosted on AQAR. Open it there to contact the advertiser.')}
          </Text>
        </View>
      </View>
    </ScrollView>
  );

  // The sticky "View on Aqar" CTA — the only path that leaves the app.
  const cta = sourceUrl ? (
    <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable style={s.viewBtn} onPress={openSource}>
        <Text style={s.viewBtnText}>{t('View on AQAR')}</Text>
        <Ionicons name="open-outline" size={17} color="#fff" />
      </Pressable>
    </View>
  ) : null;

  // WEB: a centered modal card over the dimmed app. NATIVE: a full-screen sheet.
  if (IS_WEB) {
    return (
      <>
        {(() => {
          const Style: any = 'style';
          return (
            <Style>{`
              @keyframes ezhalah-backdrop-in { from { opacity: 0 } to { opacity: 1 } }
              @keyframes ezhalah-card-in { from { opacity: 0; transform: scale(0.96) translateY(10px) } to { opacity: 1; transform: scale(1) translateY(0) } }
            `}</Style>
          );
        })()}
        {(() => {
          const D: any = 'div';
          return <D onClick={() => router.back()} style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,12,0.55)', zIndex: 9998, animation: 'ezhalah-backdrop-in 220ms ease-out both' }} />;
        })()}
        {(() => {
          const Card: any = 'div';
          return (
            <Card style={{ position: 'fixed', top: '4%', left: '50%', transform: 'translateX(-50%)', width: 'min(980px, 92vw)', height: '92%', background: colors.paper, borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 50px rgba(8,18,12,0.35)', zIndex: 9999, display: 'flex', flexDirection: 'column', animation: 'ezhalah-card-in 320ms cubic-bezier(0.2,0.8,0.2,1) both' }}>
              <Pressable
                onPress={() => router.back()}
                style={({ hovered }: any) => ({ position: 'absolute' as any, top: 12, right: 12, zIndex: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' })}
              >
                <Ionicons name="close" size={18} color={colors.ink} />
              </Pressable>
              {detail}
              {cta}
            </Card>
          );
        })()}
      </>
    );
  }

  // Native
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={[s.nativeBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Ionicons name="chevron-back" size={24} color={colors.ink} /></Pressable>
        <Text style={s.nativeBarTitle} numberOfLines={1}>{place(t(listing.district)) || place(t(listing.city))}</Text>
        <View style={{ width: 24 }} />
      </View>
      {detail}
      {cta}
    </View>
  );
}

function Spec({ icon, k, v }: { icon: any; k: string; v: string }) {
  return (
    <View style={s.spec}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <View>
        <Text style={s.specV}>{v}</Text>
        <Text style={s.specK}>{k}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },

  gallery: { height: 300, backgroundColor: colors.tint },
  galleryPhoto: { height: 300 },
  galleryEmpty: { alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: 18, paddingTop: 16, gap: 8 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeLabel: { fontSize: 12.5, color: colors.muted, fontWeight: '500' },
  titleBig: { fontSize: 22, fontWeight: '800', color: colors.dark, letterSpacing: -0.3 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  locText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  regionChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.tint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  regionChipText: { fontSize: 10.5, color: colors.primary, fontWeight: '700' },
  priceBig: { fontSize: 24, fontWeight: '800', color: colors.primary, marginTop: 4 },
  rnpl: { backgroundColor: '#e8efff', borderRadius: 10, borderWidth: 1, borderColor: '#cdd9f5', paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start', marginTop: 2 },
  rnplCta: { fontSize: 12.5, fontWeight: '700', color: '#3868c8' },
  rnplFrom: { fontSize: 11, color: colors.muted, fontWeight: '500', marginTop: 2 },

  specsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  spec: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minWidth: 110 },
  specV: { fontSize: 15, fontWeight: '800', color: colors.dark, lineHeight: 18 },
  specK: { fontSize: 10.5, color: colors.muted, lineHeight: 13 },

  sec: { fontSize: 14, fontWeight: '700', color: colors.dark, marginTop: 18, marginBottom: 2 },
  featGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  featCell: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6 },
  featText: { fontSize: 13, color: colors.dark, fontWeight: '500', flexShrink: 1 },

  hostNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.tint, borderRadius: 10, padding: 12, marginTop: 20 },
  hostNoteText: { flex: 1, fontSize: 11.5, color: colors.body, lineHeight: 17 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.fieldLine },
  viewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15 },
  viewBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },

  nativeBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.fieldLine },
  nativeBarTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
});
