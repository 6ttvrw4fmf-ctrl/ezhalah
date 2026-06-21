import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import type { Listing } from '@/data/listings';
import { useI18n, t as tr, tPrice } from '@/i18n';
import { translitPlace, regionFromUrl } from '@/lib/translitPlace';

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
  const { t, isRTL, locale } = useI18n();
  // EN UI: scraped Arabic district/city names get a fast client-side transliteration so users see
  // "Al Olaya, Riyadh" instead of "حي العليا, Riyadh". AR UI: pass through unchanged. (user request:
  // "when I send in English the place should be translated.")
  const place = (raw: string) => (locale === 'en' && raw ? translitPlace(raw) : raw);
  // Region (e.g. "north Riyadh") extracted from the Aqar listing URL — shown as a small chip so the
  // user sees which part of the city the property is in. (user request.)
  const region = regionFromUrl(listing.source_url);
  const regionLabel = region ? (locale === 'en' ? region.en : region.ar) : '';
  // The scraper sometimes captured a whole junk string into `listed` (e.g. "28/04/2026 آخر تحديث منذ
  // 22 ساعة ... المشاهدات 353 ..."). Show ONLY the clean DD/MM/YYYY date; if none, fall back to a
  // localized "recently". Works in both languages, no re-scrape needed. (user request: don't show
  // the Arabic junk on the English card.)
  const cleanDate = (raw?: string): string => {
    if (!raw) return '';
    const m = raw.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) return m[1];
    if (/^\s*recently\s*$|مؤخر/.test(raw)) return t('recently');
    return raw.length <= 12 ? raw : '';
  };
  const listedClean = cleanDate(listing.listed);
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
    // Desktop (≥820px): 3 columns side-by-side. Mobile/narrow: STACK vertically (photo on top, then
    // info, then features) — the row layout crammed all 3 columns into a phone width and broke badly.
    // (user-reported: "look how it looks like in the phone, it's horrible".)
    <View style={[card.wrap, { flexDirection: horizontal ? 'row' : 'column' }]}>
      {/* ─── photo block (full-width banner on mobile) ───── */}
      <Pressable onPress={onOpen} style={[card.photoCol, horizontal ? card.photoColWide : card.photoColMobile]}>
        <Image source={{ uri: listing.photo }} style={card.photo} contentFit="cover" transition={150} />
        {rank ? (
          <View style={card.rankBadge} pointerEvents="none">
            <Text style={card.rankText}>#{rank}</Text>
          </View>
        ) : null}
        {/* user request: removed the white "AQAR" pill that floated over the photo's top-right.
            Source attribution still appears in the bottom strip and in the right-side panel. */}
        {listing.source_url ? (
          <View style={card.sourceStrip} pointerEvents="none">
            <Text style={card.sourceText} numberOfLines={1}>{sourceName(listing.source).toUpperCase()} · {sourceHost(listing.source)}</Text>
            <Ionicons name="open-outline" size={11} color="#fff" />
          </View>
        ) : null}
      </Pressable>

      {/* ─── property info ───────────────────────── */}
      <Pressable onPress={onOpen} style={[card.midCol, horizontal && card.midColFlex]}>
        <View style={card.typeRow}>
          <Ionicons name="home-outline" size={13} color={colors.muted} />
          <Text style={card.typeLabel}>{t(listing.type)} {t(listing.deal === 'Rent' ? 'for Rent' : 'for Sale')}</Text>
        </View>
        <Text style={[card.title, { textAlign: txtAlign, writingDirection: wDir }]} numberOfLines={1}>
          {place(t(listing.district)) || place(t(listing.city))}{listing.district ? `, ${place(t(listing.city))}` : ''}
        </Text>
        <View style={card.locRow}>
          <Ionicons name="location-outline" size={12} color={colors.primary} />
          <Text style={card.locText}>{place(t(listing.city))}, {t('Saudi Arabia')}</Text>
          {regionLabel ? (
            <View style={card.regionChip}>
              <Ionicons name="compass-outline" size={10} color={colors.primary} />
              <Text style={card.regionChipText} numberOfLines={1}>{regionLabel}</Text>
            </View>
          ) : null}
        </View>
        <Text style={card.price} numberOfLines={1}>{tPrice(listing.price)}</Text>
        {listing.rent_now_pay_later ? <RnplBanner monthly={listing.rent_now_pay_later_monthly ?? undefined} t={t} /> : null}
        <View style={card.statsRow}>
          {listing.beds > 0 ? <Stat icon="bed-outline" big={String(listing.beds)} small={t(listing.beds === 1 ? 'Bed' : 'Beds')} /> : null}
          {(listing.bathrooms ?? 0) > 0 ? <Stat icon="water-outline" big={String(listing.bathrooms)} small={t(listing.bathrooms === 1 ? 'Bath' : 'Baths')} /> : null}
          {listing.area > 0 ? <Stat icon="resize-outline" big={`${listing.area} ${tr('m²')}`} small={t('Area')} /> : null}
          <Stat icon="business-outline" big={t(listing.type)} small={t('Property Type')} />
          {listedClean ? <Stat icon="calendar-outline" big={t('Added')} small={listedClean} /> : null}
        </View>
      </Pressable>

      {/* ─── features panel (full-width below info on mobile) ─ */}
      <View style={[card.rightCol, horizontal ? card.rightColSide : card.rightColBottom]}>
        <View style={card.hostHead}>
          <SourceBadge source={listing.source} />
          <View style={{ flex: 1 }}>
            <Text style={card.hostedOn}>{t('Hosted on {name}', { name: sourceName(listing.source) })}</Text>
            <Text style={card.hostHint} numberOfLines={2}>
              {t('Clicking this property will take you to {host}', { host: sourceHost(listing.source) })}
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
        {/* Wasalt-only "Additional Information" panel — Property usage / Age / Facade / Street /
            Ad source / Plan number / Land number, etc. Aqar rows have additional_info = null and
            the panel is hidden (Aqar's card stays exactly as it was). (user request 2026-06.) */}
        <AdditionalInformationPanel listing={listing} t={t} />
      </View>
    </View>
  );
}

// Render Wasalt's "Additional Information" rows on the card. Shows first 4 rows, with a
// "See more" toggle that reveals the rest. Hidden entirely for Aqar (and for any Wasalt row
// where the field hasn't been backfilled yet). Mirrors the on-site Wasalt panel design.
function AdditionalInformationPanel({ listing, t }: { listing: Listing; t: (k: string, p?: any) => string }) {
  const rows = listing.additional_info;
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;
  // Defensive cap: even if the scraper later expands the field set, the UI stays tidy.
  const all = rows.filter((r) => r && r.label && r.value);
  if (all.length === 0) return null;
  const visible = open ? all : all.slice(0, 4);
  return (
    <View style={card.addlPanel}>
      <Text style={card.addlTitle}>{t('Additional Information')}</Text>
      <View style={card.addlGrid}>
        {visible.map((r) => (
          <View key={r.key} style={card.addlCell}>
            <Text style={card.addlLabel}>{r.label}</Text>
            <Text style={card.addlValue} numberOfLines={2}>{r.value}</Text>
          </View>
        ))}
      </View>
      {all.length > 4 ? (
        <Pressable onPress={() => setOpen((x) => !x)} style={card.addlMoreBtn}>
          <Text style={card.addlMoreText}>{open ? t('See less') : t('See more')}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Source-aware brand badge — same square shape for every platform, just swaps the logo art.
// Both PNGs are pre-baked with their own background + rounded shape, so contentFit="contain"
// shows the whole logo without halos. Defaults to Aqar (the original source) for unknown values.
// (user request: replace Aqar with Wasalt cleanly, both rendered identical shape.)
const AQAR_LOGO = require('../../assets/images/aqar-logo.png');
const WASALT_LOGO = require('../../assets/images/wasalt-logo.png');
function SourceBadge({ source }: { source: string }) {
  const s = source.toLowerCase();
  if (s.includes('wasalt')) return <Image source={WASALT_LOGO} style={card.hostBadge} contentFit="contain" />;
  // Aldarim has no logo file yet — clean branded fallback (a navy square + building mark). Swap for
  // the real logo when the user supplies it (same as Aqar/Wasalt PNGs).
  if (s.includes('aldarim')) {
    return (
      <View style={[card.hostBadge, card.aldarimBadge]}>
        <Ionicons name="business" size={22} color="#fff" />
      </View>
    );
  }
  return <Image source={AQAR_LOGO} style={card.hostBadge} contentFit="contain" />;
}

// Pretty-print and hostname helpers for the "Hosted on X" labels. Mirrors SourceBadge's matching.
function sourceName(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('wasalt')) return 'Wasalt';
  if (s.includes('aldarim')) return 'Aldarim Real Estate';
  return 'AQAR';
}
function sourceHost(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('wasalt')) return 'wasalt.sa';
  if (s.includes('aldarim')) return 'aldarim.sa';
  return 'sa.aqar.fm';
}

// EJARI × ريلز "Rent now, pay later" banner — uses the official EJARI×ريلز partnership graphic
// (assets/images/ejari-rnpl.png) the user supplied. Shown only when the listing is RNPL-eligible.
// If the scraped data carries a monthly figure, the "from SAR X/month" subline appears underneath.
// (user request: pixel-perfect official badge — replaced the code-drawn approximation.)
const EJARI_LOGO = require('../../assets/images/ejari-rnpl.png');
function RnplBanner({ monthly, t }: { monthly?: number; t: (k: string, p?: any) => string }) {
  return (
    <View style={card.rnplBanner}>
      <View style={card.rnplRow}>
        <Image source={EJARI_LOGO} style={card.ejariLogo} contentFit="contain" />
        <View style={card.rnplChevs}>
          <Ionicons name="chevron-forward" size={13} color="#3868c8" style={{ marginRight: -6 }} />
          <Ionicons name="chevron-forward" size={13} color="#3868c8" />
        </View>
        <Text style={card.rnplCta}>{t('Rent now, pay later')}</Text>
      </View>
      {monthly ? (
        <Text style={card.rnplFromLine}>
          {t('from')} <Text style={card.rnplFromStrong}>SAR {Number(monthly).toLocaleString('en-US')}</Text>/{t('month')}
        </Text>
      ) : null}
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
    alignItems: 'stretch', // flexDirection set inline (row desktop / column mobile)
  },
  // photo column — fixed-size on desktop, full-width banner on mobile
  photoCol: { position: 'relative', backgroundColor: colors.tint, overflow: 'hidden' },
  photoColWide: { width: 240, height: 200 },
  photoColMobile: { width: '100%', height: 200 },
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
  midCol: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  midColFlex: { flex: 1.5 }, // desktop only — in the mobile column stack, flex would collapse it
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  typeLabel: { fontSize: 11.5, color: colors.muted, fontWeight: '500' },
  title: { fontSize: 18, fontWeight: '800', color: colors.dark, letterSpacing: -0.3 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  locText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  // Small region pill (e.g. "North Riyadh") next to the city line — light green, compact.
  regionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.tint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 2,
  },
  regionChipText: { fontSize: 10.5, color: colors.primary, fontWeight: '700' },
  price: { fontSize: 16.5, fontWeight: '800', color: colors.primary, marginTop: 2 },

  // EJARI × ريلز "Rent now, pay later" branded banner — light EJARI blue background, two-line
  // layout (brand row on top, "from SAR X/mo" subline below). Premium feel — rounded corners,
  // subtle border, generous padding. Self-aligned so it hugs content instead of stretching full
  // width. (user-visible RNPL CTA — must read as an official partnership badge.)
  rnplBanner: {
    backgroundColor: '#e8efff', borderRadius: 10, borderWidth: 1, borderColor: '#cdd9f5',
    paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 4, gap: 4,
  },
  rnplRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The official EJARI×ريلز PNG is wider than tall — fixed height + contain keeps the aspect
  // ratio and lets the parent banner's padding control the surround.
  ejariLogo: { width: 90, height: 28 },
  rnplChevs: { flexDirection: 'row', alignItems: 'center' },
  rnplCta: { fontSize: 11.5, fontWeight: '700', color: '#3868c8' },
  rnplFromLine: { fontSize: 10.5, color: colors.muted, fontWeight: '500' },
  rnplFromStrong: { color: colors.dark, fontWeight: '700' },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statBig: { fontSize: 12.5, fontWeight: '700', color: colors.dark, lineHeight: 15 },
  statSmall: { fontSize: 10, color: colors.muted, lineHeight: 12 },

  // RIGHT: features
  rightCol: { paddingHorizontal: 14, paddingVertical: 12, gap: 9 },
  rightColSide: { width: 240, borderLeftWidth: 1, borderLeftColor: colors.fieldLine },     // desktop: side column
  rightColBottom: { width: '100%', borderTopWidth: 1, borderTopColor: colors.fieldLine },  // mobile: below info
  hostHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The PNG carries its own background and rounded corners — we just size the slot. NO container
  // background here (would bleed through the PNG's transparent margins).
  hostBadge: { width: 44, height: 44 },
  aldarimBadge: { borderRadius: 8, backgroundColor: '#14506b', alignItems: 'center', justifyContent: 'center' },
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
  // Wasalt "Additional Information" panel — sits BELOW the features grid, with a soft separator
  // line so it reads as its own section. Two-column responsive grid matching the live Wasalt page.
  addlPanel: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.fieldLine,
  },
  addlTitle: { fontSize: 12.5, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  addlGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  addlCell: {
    width: '50%', paddingVertical: 4, paddingRight: 6, gap: 1,
  },
  addlLabel: { fontSize: 10.5, color: colors.muted, fontWeight: '500' },
  addlValue: { fontSize: 11.5, color: colors.ink, fontWeight: '600' },
  addlMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, marginTop: 4,
  },
  addlMoreText: { fontSize: 11.5, fontWeight: '600', color: colors.primary },
});
