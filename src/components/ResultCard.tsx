import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import type { Listing } from '@/data/listings';
import { useI18n, t as tr, tPrice } from '@/i18n';

const IS_WEB = Platform.OS === 'web';

// Feature key → (icon, EN label key) — the 2-column grid on the right side of the residential card.
// The label is run through t() so it localizes to Arabic. Order matters: most useful features first.
const FEATURE_META: Array<{ key: keyof NonNullable<Listing['features']>; icon: any; label: string }> = [
  { key: 'parking',          icon: 'car-outline',           label: 'Parking' },
  { key: 'maid_room',        icon: 'person-outline',        label: 'Maid Room' },
  { key: 'elevator',         icon: 'arrow-up-circle-outline', label: 'Elevator' },
  { key: 'master_bedrooms',  icon: 'bed-outline',           label: 'Master Bedrooms' },
  { key: 'kitchen',          icon: 'restaurant-outline',    label: 'Kitchen' },
  { key: 'halls',            icon: 'home-outline',          label: 'Halls / Majlis' },
  { key: 'balcony_terrace',  icon: 'leaf-outline',          label: 'Balcony / Terrace' },
  { key: 'laundry_room',     icon: 'water-outline',         label: 'Laundry Room' },
  { key: 'private_entrance', icon: 'walk-outline',          label: 'Private Entrance' },
  { key: 'air_conditioner',  icon: 'snow-outline',          label: 'Air Conditioning' },
  { key: 'optical_fibers',   icon: 'wifi-outline',          label: 'Fiber Internet' },
  { key: 'water_supply',     icon: 'water-outline',         label: 'Water Supply' },
  { key: 'electricity',      icon: 'flash-outline',         label: 'Electricity' },
  { key: 'sanitation',       icon: 'shield-checkmark-outline', label: 'Sanitation' },
];

// Pop-in wrapper: each card fades + lifts + scales into place, staggered by its index so the results
// reveal one-by-one instead of all landing at once — on web AND phone. (user request.)
export function PopIn({ index, style, children }: { index: number; style?: any; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: 380,
      delay: index * 110,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: !IS_WEB,
    });
    anim.start();
    return () => anim.stop();
  }, [v, index]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Listing card. Two shapes:
//  • "compact" (phone / default): a small horizontal row — image left, details right.
//  • "grid" (web): a bigger vertical card — image on top, details below — that tiles across the
//    screen in a wrap grid so the user barely scrolls. (user request.)
// The rich residential card — design locked by the user. Three sections side-by-side on web:
//   LEFT  : photo with rank badge + platform badge + source URL strip
//   MIDDLE: type label, city/district title, price, RNPL pill, stat row (beds/baths/area/type/date)
//   RIGHT : "Hosted on AQAR" panel + 2-column features grid + "+N More Features" expander
// On phones the three stack vertically. Land/Camp/Building (no beds) gracefully drops the beds chip.
// Aqar-only for now; other platforms can plug into the same shape once their scrapers land.
export function ResultCard({
  listing,
  onOpen,
  rank,
}: {
  listing: Listing;
  onOpen: () => void;
  variant?: 'compact' | 'grid'; // kept for backward compatibility — both render the new design
  rank?: number;
}) {
  const { t, isRTL } = useI18n();
  const { width } = useWindowDimensions();
  const horizontal = IS_WEB && width >= 820; // desktop 3-column layout
  const [expanded, setExpanded] = useState(false);
  const txtAlign = isRTL ? ('right' as const) : ('left' as const);
  const wDir = isRTL ? ('rtl' as const) : ('ltr' as const);

  // Pull the features that are actually true on this listing — in the priority order above.
  const allActive = (listing.features
    ? FEATURE_META.filter((m) => Boolean(listing.features?.[m.key]))
    : []);
  const VISIBLE = 6;
  const visible = expanded ? allActive : allActive.slice(0, VISIBLE);
  const overflow = Math.max(0, allActive.length - VISIBLE);

  return (
    <View style={card.wrap}>
      {/* ─── LEFT: photo block ────────────────────────────── */}
      <Pressable onPress={onOpen} style={[card.photoCol, horizontal ? card.photoColWide : card.photoColTall]}>
        <Image source={{ uri: listing.photo }} style={card.photo} contentFit="cover" transition={150} />
        {rank ? (
          <View style={card.rankBadge} pointerEvents="none">
            <Text style={card.rankText}>#{rank}</Text>
          </View>
        ) : null}
        <View style={card.platformBadge} pointerEvents="none">
          <Ionicons name="location" size={11} color={colors.primary} />
          <Text style={card.platformText}>{t('AQAR')}</Text>
        </View>
        {listing.source_url ? (
          <View style={card.sourceStrip} pointerEvents="none">
            <Text style={card.sourceText} numberOfLines={1}>AQAR · sa.aqar.fm</Text>
            <Ionicons name="open-outline" size={11} color="#fff" />
          </View>
        ) : null}
      </Pressable>

      {/* ─── MIDDLE: property info ───────────────────────── */}
      <Pressable onPress={onOpen} style={card.midCol}>
        <View style={card.typeRow}>
          <Ionicons name="home-outline" size={13} color={colors.muted} />
          <Text style={card.typeLabel}>{t(listing.type)} {t(listing.deal === 'Rent' ? 'for Rent' : 'for Sale')}</Text>
        </View>
        <Text style={[card.title, { textAlign: txtAlign, writingDirection: wDir }]} numberOfLines={1}>
          {t(listing.district) || t(listing.city)}{listing.district ? `, ${t(listing.city)}` : ''}
        </Text>
        <View style={card.locRow}>
          <Ionicons name="location-outline" size={12} color={colors.primary} />
          <Text style={card.locText}>{t(listing.city)}, {t('Saudi Arabia')}</Text>
        </View>
        <Text style={card.price} numberOfLines={1}>{tPrice(listing.price)}</Text>
        {listing.rent_now_pay_later ? (
          <View style={card.rnplPill}>
            <Text style={card.rnplLabel}>EJARI</Text>
            <Text style={card.rnplDot}>·</Text>
            <Text style={card.rnplLabelAr}>ريلز</Text>
            <Ionicons name="chevron-forward" size={11} color={colors.primary} />
            <Text style={card.rnplCta}>{t('Rent now, pay later')}</Text>
            {listing.rent_now_pay_later_monthly ? (
              <Text style={card.rnplFrom}>· {t('from')} SAR {Number(listing.rent_now_pay_later_monthly).toLocaleString('en-US')}/mo</Text>
            ) : null}
          </View>
        ) : null}
        <View style={card.statsRow}>
          {listing.beds > 0 ? <Stat icon="bed-outline" big={String(listing.beds)} small={t(listing.beds === 1 ? 'Bed' : 'Beds')} /> : null}
          {(listing.bathrooms ?? 0) > 0 ? <Stat icon="water-outline" big={String(listing.bathrooms)} small={t(listing.bathrooms === 1 ? 'Bath' : 'Baths')} /> : null}
          {listing.area > 0 ? <Stat icon="resize-outline" big={`${listing.area} ${tr('m²')}`} small={t('Area')} /> : null}
          <Stat icon="business-outline" big={t(listing.type)} small={t('Property Type')} />
          {listing.listed ? <Stat icon="calendar-outline" big={t('Added')} small={listing.listed} /> : null}
        </View>
      </Pressable>

      {/* ─── RIGHT: features panel ───────────────────────── */}
      <View style={card.rightCol}>
        <View style={card.hostHead}>
          <View style={card.hostBadge}>
            <Ionicons name="location" size={13} color={colors.primary} />
            <Text style={card.hostBadgeText}>{t('AQAR')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={card.hostedOn}>{t('Hosted on AQAR')}</Text>
            <Text style={card.hostHint} numberOfLines={2}>
              {t('Clicking this property will take you to sa.aqar.fm')}
            </Text>
          </View>
        </View>
        {visible.length > 0 ? (
          <View style={card.featGrid}>
            {visible.map((f) => (
              <View key={f.key} style={card.featCell}>
                <Ionicons name={f.icon} size={14} color={colors.primary} />
                <Text style={card.featText} numberOfLines={1}>{t(f.label)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={card.noFeat}>{t('No additional features listed')}</Text>
        )}
        {overflow > 0 ? (
          <Pressable onPress={() => setExpanded((x) => !x)} style={card.moreBtn}>
            <Text style={card.moreText}>
              {expanded ? t('Show fewer features') : t('+{n} More Features', { n: overflow })}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// One stat chip — used in the middle column's stats row.
function Stat({ icon, big, small }: { icon: any; big: string; small: string }) {
  return (
    <View style={card.statChip}>
      <Ionicons name={icon} size={14} color={colors.primary} />
      <View>
        <Text style={card.statBig} numberOfLines={1}>{big}</Text>
        <Text style={card.statSmall} numberOfLines={1}>{small}</Text>
      </View>
    </View>
  );
}

// New rich residential card — three side-by-side sections on desktop, stacked on phone.
const card = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.fieldLine,
    overflow: 'hidden', ...cardShadow,
    flexDirection: 'row', alignItems: 'stretch',
  },
  // LEFT: photo column
  photoCol: { position: 'relative', backgroundColor: colors.tint, overflow: 'hidden' },
  photoColWide: { width: 240, height: 200 },
  photoColTall: { width: 110, height: 110 },
  photo: { width: '100%', height: '100%' },
  rankBadge: {
    position: 'absolute', top: 8, left: 8, backgroundColor: colors.primary,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  rankText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  platformBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: '#fff',
    borderRadius: 14, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  platformText: { color: colors.primary, fontSize: 10.5, fontWeight: '700' },
  sourceStrip: {
    position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 5, paddingHorizontal: 8,
    backgroundColor: 'rgba(8,32,18,0.62)', flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  sourceText: { color: '#fff', fontSize: 10, fontWeight: '600', flex: 1 },

  // MIDDLE: property info
  midCol: { flex: 1.5, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  typeLabel: { fontSize: 11.5, color: colors.muted, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '800', color: colors.dark, letterSpacing: -0.3 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  price: { fontSize: 16.5, fontWeight: '800', color: colors.primary, marginTop: 2 },
  rnplPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#e8f1ff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
    alignSelf: 'flex-start', marginTop: 2, flexWrap: 'wrap',
  },
  rnplLabel: { fontSize: 10.5, color: '#1d4a8b', fontWeight: '700', letterSpacing: 0.3 },
  rnplLabelAr: { fontSize: 10.5, color: '#1d4a8b', fontWeight: '700' },
  rnplDot: { fontSize: 10.5, color: '#1d4a8b' },
  rnplCta: { fontSize: 10.5, color: colors.primary, fontWeight: '600' },
  rnplFrom: { fontSize: 10, color: colors.muted, fontWeight: '500' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statBig: { fontSize: 12.5, fontWeight: '700', color: colors.dark, lineHeight: 15 },
  statSmall: { fontSize: 10, color: colors.muted, lineHeight: 12 },

  // RIGHT: features
  rightCol: {
    width: 240, paddingHorizontal: 14, paddingVertical: 12, gap: 9,
    borderLeftWidth: 1, borderLeftColor: colors.fieldLine,
  },
  hostHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hostBadge: {
    width: 38, height: 38, borderRadius: 9, backgroundColor: colors.tint,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2,
  },
  hostBadgeText: { fontSize: 9, fontWeight: '800', color: colors.primary },
  hostedOn: { fontSize: 12, fontWeight: '700', color: colors.dark },
  hostHint: { fontSize: 10, color: colors.muted, lineHeight: 13 },
  featGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  featCell: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  featText: { fontSize: 11.5, color: colors.dark, fontWeight: '500', flexShrink: 1 },
  noFeat: { fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.fieldLine,
  },
  moreText: { fontSize: 11.5, fontWeight: '600', color: colors.primary },
});
