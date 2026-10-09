import { PlatformLogo } from './platform-logo';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/theme/tokens';
import type { Listing } from '@/data/listings';
import { derivedTotalEquation } from '@/data/listings';
import { useI18n, t as tr, LOCATION_UNRESOLVED_AR, TYPE_UNRESOLVED_AR, ATTRIBUTE_UNRESOLVED_AR } from '@/i18n';
import { translitPlace, regionFromUrl } from '@/lib/translitPlace';
import { arabicOrPlaceholder, arabicOrPlaceholderForFreeText, hideArabicProseInEnglish, attrDisplayLabel, translateTrailingPeriodWord } from '@/lib/arabicText';
import { CARD_WIDE_BREAKPOINT } from '@/lib/responsive';
import { useAtLeast } from '@/lib/useAtLeast';
import { sourceName } from '@/lib/listingDisplay';
import { isStayLengthPriced, listingPrice } from '@/lib/listingDisplay';
import { afEvidence, AMENITY_COL, type ActiveAf } from '@/lib/afEvidence';

const IS_WEB = Platform.OS === 'web';

// Feature key → (icon, EN label key) — the wrapping amenities row on the listing card.
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

// Photo-first card approved by the owner: a clear source-link photo, then compact details.
// Prose stays hidden; every amenity and additional-information value is immediately visible.
//
// LAPTOP ROW (owner 2026-10-03: «the image is so big … for the laptop it should always be small»).
// With `row` set the same card lays out as a list row: a small rounded photo on the inline-start
// side, every detail beside it — about half the stacked height. 'roomy' (no ad pane beside the
// results) keeps every amenity and additional-information value visible, wrapped. 'tight' (the pane
// is beside the results, so the column is narrow) shrinks the photo again and holds the amenities
// and the additional information to ONE truncated line each; a tap on those lines unfolds them.
// Nothing is dropped in either mode, and the «مطابق لطلبك» strip is never truncated (R12A.1).
// `row` undefined is the phone/tablet card, unchanged.
export function ResultCard({
  listing,
  onOpen,
  rank,
  activeAf,
  row,
}: {
  listing: Listing;
  onOpen: () => void;
  variant?: 'compact' | 'grid'; // kept for backward compatibility — both render the new design
  rank?: number;
  // The Advanced-Filter predicates the turn's search ran with (afActive(m.result.query)) — one
  // stable reference per results turn; the memo comparator in agent.tsx compares it by identity.
  activeAf?: ActiveAf;
  row?: 'roomy' | 'tight';
}) {
  const { t, isRTL, locale } = useI18n();
  const tight = row === 'tight';
  // 'tight' only: the two truncated secondary lines, unfolded by a tap on them.
  const [unfolded, setUnfolded] = useState(false);
  // Evidence for the «مطابق لطلبك» strip: NEVER read from listing.features / listing.bathrooms (raw,
  // NULL-coerced) — only from listing.canon, the canonical row the predicate actually passed on.
  const evidence = useMemo(() => afEvidence(activeAf ?? [], listing.canon, t), [activeAf, listing.canon, t]);
  // EN UI: scraped Arabic district/city names get a fast client-side transliteration so users see
  // "Al Olaya, Riyadh" instead of "حي العليا, Riyadh". AR UI: pass through unchanged. (user request:
  // "when I send in English the place should be translated.")
  const place = (raw: string) => (locale === 'en' && raw ? translitPlace(raw) : raw);
  // English-leak guard (owner report, 2026-07-16): a raw scraped city that never matched the
  // Arabic catalog (e.g. "Eastern Province", "Baljurashi") used to render straight onto the card's
  // own headline — the ONLY empty-string fallback here never caught "present but not Arabic".
  // arabicOrPlaceholder is a no-op for an empty locale-'en' t(listing.city) (place() still
  // transliterates it below), and a no-op for any already-Arabic value.
  const cityAr = arabicOrPlaceholder(t(listing.city), locale, LOCATION_UNRESOLVED_AR);
  // Region (e.g. "north Riyadh") extracted from the Aqar listing URL — shown as a small chip so the
  // user sees which part of the city the property is in. (user request.)
  const region = regionFromUrl(listing.source_url);
  const regionLabel = region ? (locale === 'en' ? region.en : region.ar) : '';
  // Description (P2): show the source's text ONLY when it is REAL Arabic (Aqar keeps its own as-is).
  // English or empty (Wasalt carries none) shows nothing — we never translate or invent a description.
  // Force RTL base direction with a leading RLM (U+200F, zero-width) so the 3-line truncation ALWAYS ends
  // on the RTL side — the ellipsis lands right after the last visible Arabic word ("…عنه"), never leading.
  // Without it, a description that STARTS with LTR content (a URL / phone / emoji) flips the paragraph's
  // base direction and pushes the clamp ellipsis to the wrong side ("… عنه"). (owner 2026-07-08)
  // In the ENGLISH locale the raw Arabic paragraph is hidden rather than shown or translated (owner,
  // 2026-09-11) — hideArabicProseInEnglish is a no-op in Arabic, so this line is unchanged there.
  const descAr = hideArabicProseInEnglish((() => { const d = (listing.description ?? '').trim(); return d && /[ء-ي]/.test(d) ? '‏' + d : null; })(), locale);
  // Gathern Tier-1: Gathern is the only source that carries a rich Arabic listing.title AND no
  // description (0% desc), so we surface the title in the description slot — but ONLY for Gathern, so
  // no other platform's layout changes. Same RLM (U+200F) base-direction guard as descAr above.
  const isGathern = (listing.source || '').toLowerCase().includes('gathern');
  const titleAr = hideArabicProseInEnglish((() => { const s = (listing.title ?? '').trim(); return s && /[ء-ي]/.test(s) ? '‏' + s : null; })(), locale);
  // Guest rating (0–10) — present ONLY for sources that publish reviews (Gathern). null everywhere
  // else → the rating element renders nothing, so no other platform's card changes. (Gathern Tier-1.)
  const ratingVal = typeof listing.rating === 'number' && Number.isFinite(listing.rating) ? listing.rating : null;
  const reviewsCount = typeof listing.reviews_count === 'number' && listing.reviews_count > 0 ? listing.reviews_count : null;
  // The scraper sometimes captured a whole junk string into `listed` (e.g. "28/04/2026 آخر تحديث منذ
  // 22 ساعة ... المشاهدات 353 ..."). Show ONLY the clean DD/MM/YYYY date; if none, fall back to a
  // localized "recently". Works in both languages, no re-scrape needed. (user request: don't show
  // the Arabic junk on the English card.)
  const cleanDate = (raw?: string): string => {
    if (!raw) return '';
    const m = raw.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) return m[1];
    // ISO-8601 — «2025-09-21T20:33:43+03:00» — is what aqarcity, eaqartabuk and eastabha publish.
    // This function only knew DD/MM/YYYY, so an ISO stamp (25 chars) fell through the `length <= 12`
    // tail and returned '' — the «أضيف» chip silently vanished on 2,544 live listings that DO carry
    // a source-published date (audit 2026-08-23: 76 of 595 audited cards, every one ISO).
    // Read TEXTUALLY, never via `new Date()`: these stamps are +03:00 Saudi local, and re-reading the
    // day in the viewer's timezone would shift the date the SOURCE published by a day. The digits are
    // reordered into the card's one date format — same fact, nothing derived.
    const iso = raw.match(/^\s*(\d{4})-(\d{2})-(\d{2})(?!\d)/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    if (/^\s*recently\s*$|مؤخر/.test(raw)) return t('recently');
    return raw.length <= 12 ? raw : '';
  };
  const listedClean = cleanDate(listing.listed);
  // #1 (source-accurate, owner 2026-07-06): show the RAW scraped type when it is already Arabic
  // (dealapp "تاون هاوس", "ملحق علوي"…); for English-raw sources (aqar stores "Apartment") show the
  // source-matching Arabic via the clean mapping — never English on the card. Mapping stays filter-only.
  const typeLabel = arabicOrPlaceholder(
    /[ء-ي]/.test(listing.type || '') ? listing.type : t(listing.cleanType ?? listing.type),
    locale,
    TYPE_UNRESOLVED_AR,
  );
  // Responsive thumbnail sizing. Goes through useAtLeast so the FIRST client render reproduces the
  // server's answer (no window ⇒ compact); comparing the width inline here was the second half of
  // the React #418 P0 of 2026-08-21 — it differs only in style attributes, but React compares those
  // during hydration too, which is why the live page logged two errors and not one.
  const horizontal = useAtLeast(CARD_WIDE_BREAKPOINT);
  const txtAlign = isRTL ? ('right' as const) : ('left' as const);
  const wDir = isRTL ? ('rtl' as const) : ('ltr' as const);

  // Pull the features that are actually true on this listing — in the priority order above.
  const allActive = (listing.features
    ? FEATURE_META.filter((m) => Boolean(listing.features?.[m.key]))
    : []);
  // THE CARD LIGHTS UP WHAT THE USER ASKED FOR (owner 2026-10-05: «check mark and highlight — when the
  // user gets the answer, the property card shows it»). Every feature the Advanced Filter asked for is
  // drawn IN PLACE with a ✓ and the brand tint, and moved to the front of the grid; the bathrooms stat
  // lights up the same way. Display-only: the set comes from the active answers, and a feature is only
  // drawn at all when the listing itself carries it (the AF predicate is strict, so it always does).
  const pickedFeatures = useMemo(() => {
    const keys = activeAf?.find((a) => a.id === 'amenities')?.keys ?? [];
    return new Set(keys.map((k) => (k === 'balcony' ? 'balcony_terrace' : AMENITY_COL[k] ?? k)));
  }, [activeAf]);
  const bathPicked = !!activeAf?.some((a) => a.id === 'bathrooms');
  const visible = pickedFeatures.size
    ? [...allActive.filter((f) => pickedFeatures.has(f.key)), ...allActive.filter((f) => !pickedFeatures.has(f.key))]
    : allActive;
  // Land listings (amlakalahsa, etc.) legitimately have zero boolean amenities (no elevator/parking/
  // kitchen on raw land) while still having real street_width/parcel_number in additional_info — that
  // combo was rendering "No additional features listed" directly above a populated "Additional
  // Information" panel, which reads as self-contradicting even though the two sections cover different
  // data. Same filter AdditionalInformationPanel uses below, so the empty-state only fires when BOTH
  // panels would otherwise be blank. (owner-reported 2026-09-13, found while re-testing amlakalahsa.)
  const hasAddlInfo = !!listing.additional_info?.some((r) => r && r.label && r.value);

  return (
    // Keep the linked photo above a content-sized body on every screen.
    // NOTE: the feedback row (thumbs/share) is NOT here — owner 2026-07-09 moved it to render ONCE per
    // results response, below the «تبي أعرض لك المزيد…» message (see agent.tsx + FeedbackRow.tsx).
    // testID carries the listing's own id so a live journey can hold THIS card to THIS listing's
    // canonical row. R12A.2 («the chip shows the LISTING's value, not the filter's label») is only
    // checkable if a rendered card can be identified in the DOM; matching strips to rows by position
    // is unsound, because a row that earns no chip renders no strip and silently shifts the rest.
    // Rendering-only: no style, no behaviour, and web-only `testID` becomes `data-testid`.
    <View testID={`card-listing-${listing.id}`} style={[card.wrap, row && card.wrapRow, { direction: wDir }]}>
      {/* The whole photo keeps the existing source-listing action. */}
      <Pressable onPress={onOpen} accessibilityRole="link" accessibilityLabel={t('Clicking this property will take you to {host}', { host: sourceHost(listing.source) })} style={[card.photoCol, row ? [card.photoColRow, tight && card.photoColTight] : horizontal ? card.photoColWide : card.photoColMobile]}>
        <ListingPhoto photos={(listing.photos && listing.photos.length ? listing.photos : (listing.photo ? [listing.photo] : []))} style={card.photo} t={t} />
        {rank ? (
          <View style={[card.rankBadge, row && card.rankBadgeRow]} pointerEvents="none">
            <Text style={[card.rankText, row && card.rankTextRow]}>#{rank}</Text>
          </View>
        ) : null}
        {/* user request: removed the white "AQAR" pill that floated over the photo's top-right.
            Source attribution appears in the photo strip and the compact source row. */}
        {listing.source_url ? (
          <View style={[card.sourceStrip, row && card.sourceStripRow]} pointerEvents="none">
            <Text style={[card.photoAction, row && card.photoActionRow]}>{t('Click here 👆')}</Text>
            <Text style={[card.sourceText, row && card.sourceTextRow]} numberOfLines={row ? 1 : undefined}>{sourceHost(listing.source)}</Text>
          </View>
        ) : null}
      </Pressable>

      <View style={row ? card.bodyRow : card.body}>
      {/* ─── property info ───────────────────────── */}
      <Pressable onPress={onOpen} style={[card.midCol, row && card.midColRow]}>
        <View style={card.sourceRow}>
          <View style={card.hostHead}>
            <View style={card.hostBadge}><SourceBadge source={listing.source} /></View>
            <Text style={card.hostedOn}>{t('Hosted on {name}', { name: t(sourceName(listing.source)) })}</Text>
          </View>
          <Text style={card.typeLabel}>{typeLabel} {t(listing.deal === 'Rent' ? 'for Rent' : 'for Sale')}</Text>
        </View>
        {/* JUNK_LOCATION_TOKENS guard (2026-07-10 location-data-quality audit): city/district can
            legitimately both be empty here — a scraper's own resolver failed AND remote.ts correctly
            blanked a junk sentinel rather than passing it through raw. Show the neutral, honest
            «الموقع غير محدد» instead of an empty title / a bare ", السعودية" — never blank, never
            the raw junk token. A present district with no city (or vice versa) is the normal,
            non-bug case and is untouched. */}
        <View style={card.headline}>
        <Text style={[card.title, tight && card.titleTight, { textAlign: txtAlign, writingDirection: wDir }]}>
          {(place(arabicOrPlaceholder(t(listing.district), locale, LOCATION_UNRESOLVED_AR)) || place(cityAr) || LOCATION_UNRESOLVED_AR)}{listing.district ? `, ${place(cityAr) || LOCATION_UNRESOLVED_AR}` : ''}
        </Text>
        <Text style={isStayLengthPriced(listing.source) ? [card.stayNote, row && card.stayNoteRow] : [card.price, row && card.priceRow, tight && card.priceTight]} numberOfLines={isStayLengthPriced(listing.source) ? 2 : 1}>{listingPrice(listing, locale)}</Text>
        </View>
        <View style={card.locRow}>
          <Ionicons name="location-outline" size={12} color={colors.primary} />
          <Text style={card.locText}>{place(cityAr) || LOCATION_UNRESOLVED_AR}, {t('Saudi Arabia')}</Text>
          {regionLabel ? (
            <View style={card.regionChip}>
              <Ionicons name="compass-outline" size={10} color={colors.primary} />
              <Text style={card.regionChipText} numberOfLines={1}>{regionLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* Source-published «سعر المتر», e.g. «سعر المتر 175 ر.س». Shown ONLY when the source printed
            no total/annual price — i.e. exactly the listings whose price line reads «السعر عند الطلب»
            — so it adds information where there was none and never competes with a real price.
            'Price on request' is the literal sentinel finalize() emits for a price-less row
            (src/data/remote.ts), which tPrice maps to «السعر عند الطلب» (src/i18n.tsx).
            PLACEHOLDER RULE (evidence, live aqar 2026-07-26): a page printing «سعر المتر 1» with NO
            total is not quoting 1 SAR/m². On aqar the printed rate and printed total are locked
            together (98.5% of 12,465 priced Buy rows satisfy total ≈ area × rate), so a genuine
            1 SAR/m² ALWAYS arrives with a corroborating total — all 16 such rows have one. The 36
            rows that print 1 with no total instead name completely different prices in their own
            free text (ad 6696403 «المطلوب / مليون و500» on 510 m² ≈ 2,941/m²), i.e. 1 is the
            seller's "call me" token. Those 36 are WITHHELD (the card keeps «السعر عند الطلب»); no
            stored value is ever altered, and every other value — including fractional 1.09–1.97
            rates — surfaces verbatim.
            The gate is `> 1`, not `!== 1`: price_per_meter is an int4 column, and on platforms that
            USED to derive the rate as round(total/area) a later gate could null the total and leave
            a 0 behind — which rendered «سعر المتر ر.س 0» on 5 live dealapp cards (found 2026-07-26,
            scrapers fixed in PR#218). `> 1` withholds 0 and negatives as well as the placeholder. */}
        {/* DERIVED-TOTAL ROWS KEEP THEIR SOURCE RATE (owner rule 2026-09-03). When the total shown
            above is OUR per-metre x area arithmetic, the advertiser's own per-metre figure must stay
            on the card — it is the only source-published price the listing has, and it is what the
            derived total is accountable to. Without `|| listing.priceIsDerived` this line vanished
            the moment the row stopped saying «السعر عند الطلب», hiding the source value behind a
            number we computed. */}
        {(listing.price === 'Price on request' || listing.priceIsDerived)
          && listing.pricePerMeter != null
          && listing.pricePerMeter > 1 ? (
          <Text style={card.pricePerMeter} numberOfLines={1}>
            {/* UNIT-SUFFIXED, never prefix-only (owner 2026-08-09: "display it clearly as ريال/م²").
                Renders «سعر المتر 750 ريال/م²». The old form put the currency BEFORE the number
                («سعر المتر ر.س 750»), which reads like a total price with a label in front of it —
                the one thing this element must never be mistaken for. The unit now travels with the
                number, so a rate can never be misread as the price of the property. */}
            {t('Price Per m²')} <Text style={card.pricePerMeterStrong}>{Number(listing.pricePerMeter).toLocaleString('en-US')} {t('SAR/m²')}</Text>
          </Text>
        ) : null}
        {/* TRUTHFULNESS: a derived total is arithmetic, not an advertised price, and must say so.
            The figure above already carries '≈'; this states plainly where it came from, so nobody
            reads it as a number the seller published. (owner rule 2026-09-03) */}
        {/* THE WORKING, NOT JUST THE ANSWER (owner 2026-09-26): «320 ريال/م² × 900 م² = 288,000 ر.س».
            The '≈' figure above is our arithmetic; showing the three numbers lets anyone check it
            against the source's own per-metre rate and area. derivedTotalEquation runs the SAME
            function that produced the price, so this line and the price line cannot disagree. */}
        {listing.priceIsDerived ? (() => {
          const eq = derivedTotalEquation(listing.pricePerMeter, listing.area);
          return eq ? (
            <Text style={card.derivedTotalEquation} numberOfLines={1}>
              {`${eq.perMeter.toLocaleString('en-US')} ${t('SAR/m²')} × ${eq.area.toLocaleString('en-US')} ${t('m²')} = ${eq.total.toLocaleString('en-US')} ${t('SAR')}`}
            </Text>
          ) : null;
        })() : null}
        {listing.priceIsDerived ? (
          <Text style={card.derivedTotalNote} numberOfLines={1}>
            {t('Calculated from price per m² × area — not published by the source')}
          </Text>
        ) : null}
        {/* Guest rating — renders ONLY when the listing carries one (Gathern). e.g. ★ 9.9 (59 تقييم) */}
        {ratingVal != null ? (
          <View style={card.ratingRow}>
            <Ionicons name="star" size={13} color="#f5a623" />
            <Text style={card.ratingText}>
              {ratingVal}
              {reviewsCount != null ? <Text style={card.ratingCount}>{`  (${t('{n} reviews', { n: reviewsCount })})`}</Text> : null}
            </Text>
          </View>
        ) : null}
        {listing.rent_now_pay_later ? <RnplBanner monthly={listing.rent_now_pay_later_monthly ?? undefined} source={listing.source} t={t} /> : null}
        {descAr ? (
          <Text style={[card.desc, { textAlign: txtAlign, writingDirection: wDir }]} numberOfLines={3}>{descAr}</Text>
        ) : (isGathern && titleAr ? (
          // Gathern has no description → show its rich Arabic title here instead. Gated to Gathern so
          // no other platform (which shows nothing here when descAr is null) is affected.
          <Text style={[card.desc, { textAlign: txtAlign, writingDirection: wDir }]} numberOfLines={2}>{titleAr}</Text>
        ) : null)}
        <View style={card.statsRow}>
          {listing.beds > 0 ? <Stat icon="bed-outline" big={String(listing.beds)} small={t(listing.beds === 1 ? 'Bed' : 'Beds')} /> : null}
          {(listing.bathrooms ?? 0) > 0 ? <Stat icon="water-outline" big={String(listing.bathrooms)} small={t(listing.bathrooms === 1 ? 'Bath' : 'Baths')} picked={bathPicked} /> : null}
          {listing.area > 0 ? <Stat icon="resize-outline" big={`${listing.area} ${tr('m²')}`} small={t('Area')} /> : null}
          <Stat icon="business-outline" big={typeLabel} small={t('Property Type')} />
          {listedClean ? <Stat icon="calendar-outline" big={t('Added')} small={listedClean} /> : null}
        </View>
        {/* «مطابق لطلبك» — every active Advanced-Filter predicate this listing's canonical row proves,
            carrying the ROW's actual value («4 حمامات», «شمال», «عرض الشارع 20 م»), never the filter's
            label. Absent entirely when there is no evidence; an UNKNOWN column renders nothing for
            that question. The existing bath Stat / rating row / RNPL banner / feature grid are
            untouched.

            NO CAP, NO EXPANDER (2026-09-03). The 2026-09-02 draft showed the first 4 behind a «+N».
            R12A.1 requires an active selection to be "visible without expanding, scrolling a sub-panel,
            or opening the source", and rounds accumulate — 5+ committed answers is ordinary, so a cap
            of 4 would hide one the user explicitly asked for. The chips are small and wrap; showing
            them all is what the rule says. R12A.4 (a static priority cap must not hide a selected
            field) is satisfied the same way: whatever the feature grid below chooses to cap, every
            AF-selected field is already proven here, above it, unexpanded. */}
        {evidence.length > 0 ? (
          <View style={card.afRow} testID="card-af-evidence">
            <Text style={card.afLabel}>{t('Matches your request')}</Text>
            {evidence.map((c, i) => (
              <View key={`${c.id}:${i}`} style={card.afChip} testID={`card-af-evidence-${c.id}`}>
                <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
                <Text style={card.afChipText}>{c.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      {/* Amenities and additional information: full card width when stacked, under the facts in a
          row. 'tight' holds each to one truncated line; tapping them unfolds the full values. */}
      {tight ? (
        <Pressable
          onPress={() => setUnfolded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={t(unfolded ? 'Show less' : 'See more')}
          accessibilityState={{ expanded: unfolded }}
          style={[card.rightCol, card.rightColRow]}
        >
          {visible.length > 0 ? (
            <Text numberOfLines={unfolded ? undefined : 1} style={[card.oneLine, { textAlign: txtAlign, writingDirection: wDir }]}>
              {visible.map((f) => (
                <Text key={f.key} style={[card.featText, pickedFeatures.has(f.key) && card.featTextPicked]}>
                  <Ionicons name={pickedFeatures.has(f.key) ? 'checkmark-circle' : f.icon} size={12} color={colors.primary} />{` ${t(f.label)}\u2003`}
                </Text>
              ))}
            </Text>
          ) : hasAddlInfo ? null : (
            <Text style={card.noFeat}>{t('No additional features listed')}</Text>
          )}
          <AdditionalInformationPanel listing={listing} t={t} locale={locale} oneLine unfolded={unfolded} />
        </Pressable>
      ) : (
      <View style={[card.rightCol, row && card.rightColRow]}>
        {visible.length > 0 ? (
          <View style={card.featGrid}>
            {visible.map((f) => {
              const picked = pickedFeatures.has(f.key);
              return (
                <View key={f.key} style={[card.featCell, picked && card.featCellPicked]} testID={picked ? `card-feature-picked-${f.key}` : undefined}>
                  <Ionicons name={picked ? 'checkmark-circle' : f.icon} size={14} color={colors.primary} />
                  <Text style={[card.featText, picked && card.featTextPicked]}>{t(f.label)}</Text>
                </View>
              );
            })}
          </View>
        ) : hasAddlInfo ? null : (
          <Text style={card.noFeat}>{t('No additional features listed')}</Text>
        )}
        {/* Wasalt-only "Additional Information" panel — Property usage / Age / Facade / Street /
            Ad source / Plan number / Land number, etc. Aqar rows have additional_info = null and
            the panel is hidden (Aqar's card stays exactly as it was). (user request 2026-06.) */}
        <AdditionalInformationPanel listing={listing} t={t} locale={locale} />

      </View>
      )}
      </View>
    </View>
  );
}

// ── Arabic display for the additional-info ENUM values (owner 2026-07-10). The panel already
// translates the LABEL via t(); the VALUE was rendered raw, leaking English (Residential/New/East…).
// Map only the finite enum sets found in production; FREE-TEXT (Street, Other obligations, Ad source,
// plan/land numbers) is NEVER translated — it's real source content. The raw DB is untouched; this is
// display-only. Yes/No is translated for any field (never a legitimate street name).
const AR_YESNO: Record<string, string> = { yes: 'نعم', no: 'لا' };
// ONE furnishing value map shared by BOTH label spellings ('Furnishing' = satel, 'Furniture' = wasalt/
// aldarim). Declared once so the two AR_ENUM keys below physically cannot drift apart — renaming one of
// them silently stranded 2,757 wasalt/aldarim cards in raw English once already (2026-07-17).
const FURNISH_VALUES_AR: Record<string, string> = {
  furnished: 'مفروش', 'fully furnished': 'مفروش بالكامل',
  'un-furnished': 'غير مفروش', unfurnished: 'غير مفروش',
  'semi-furnished': 'نصف مفروش', 'partially furnished': 'مفروش جزئياً',
};
const AR_ENUM: Record<string, Record<string, string>> = {
  // (owner report, 2026-07-16 Arabic-only sweep) 'agricultural'/'mixed' added — eaqartabuk/erapulse
  // raw values that fell through the enum lookup and rendered raw English.
  'property usage': { residential: 'سكني', commercial: 'تجاري', agricultural: 'زراعي', mixed: 'مختلط' },
  // BOTH label spellings are real and must BOTH be kept — see FURNISH_VALUES_AR below.
  // (fix, 2026-07-16) satel's ADDL_FIELDS label is 'Furnishing' ('Fully furnished'/'Unfurnished'/
  //   'Partially furnished', 203 rows).
  // (fix, 2026-07-17) RENAMING to 'furnishing' silently broke the OTHER shape: wasalt + aldarim send the
  //   legacy label 'Furniture' (2,757 live rows: Un-Furnished 2,617 / Furnished 83 / Semi-Furnished 57),
  //   which then matched no key and rendered «الأثاث: Un-Furnished» — an Arabic label with an English
  //   value, on the highest-volume platform. Two labels, one value map: alias them (below) so the two
  //   additional_info shapes can never drift apart again. Do NOT rename one into the other.
  furnishing: FURNISH_VALUES_AR,
  furniture: FURNISH_VALUES_AR,
  'property floor': { upper: 'علوي', ground: 'أرضي', basement: 'قبو' },
  facade: {
    east: 'شرقية', west: 'غربية', north: 'شمالية', south: 'جنوبية',
    'north east': 'شمالية شرقية', 'north west': 'شمالية غربية',
    'south east': 'جنوبية شرقية', 'south west': 'جنوبية غربية',
  },
  // Below: 4 new enums added 2026-07-16 — all satel-only, ~200 raw-English rows each with zero
  // prior translation (no AR_ENUM entry existed for any of these labels at all).
  status: { available: 'متاح', 'rented out': 'مؤجر' },
  'parking type': { underground: 'تحت الأرض', outdoor: 'مكشوف', shadedoutdoor: 'مكشوف مظلل' },
  'ac type': { split: 'سبليت', concealed: 'مخفي', both: 'مركزي وسبليت' },
  kitchen: { 'with-appliances': 'مجهز بأجهزة', 'without-appliances': 'غير مجهز بأجهزة' },
  // mizlaj's raw 'approved' (27 rows) — every other platform already sends this pre-translated.
  'license status': { approved: 'معتمد' },
};
// FREE-TEXT labels checked for an English-leak via arabicOrPlaceholderForFreeText below (only a
// Latin LETTER with no Arabic char is flagged — pure numeric/code content is untouched). Covers
// every label that is genuine prose/status text, NOT a code: license/plan/parcel/postal "codes"
// (rega_ad_license_number, broker_fal_license, parcel_number, plan_number, postal_code — see
// ADDL_FIELDS) legitimately contain Latin LETTERS as part of a real ID (e.g. "FAL1234567") and
// must stay excluded, or a real license number would get wrongly blanked.
// (Widened 2026-07-16, owner report: was 'address' only — added every other prose/status/enum
// label as defense-in-depth, so an UNMAPPED future enum value or a stray leak on any of these
// falls back to a placeholder instead of rendering raw, the same way 'address' already does.)
// ('furniture' added 2026-07-17 for parity with 'furnishing' — the two are the same attribute under two
// source label spellings, so the leak guard must cover both or the unguarded one leaks raw English.)
const FREE_TEXT_PROSE_LABELS = new Set([
  'address', 'amenities', 'property services', 'furnishing', 'furniture', 'property usage',
  'status', 'parking type', 'ac type', 'kitchen', 'license status', 'warranties', 'deed location',
]);
// DEFENCE IN DEPTH (2026-08-18): `value`/`label` are TYPED as string, but they originate in a
// source-scraped JSON column, and Wasalt's legacy additional_info array publishes NUMBERS
// (`{"key":"noOfFloors","label":"Total Floors","value":2}`). Before buildAdditionalInfo() started
// coercing that branch, `(2).trim()` threw here and the uncaught TypeError unmounted the entire
// app — production rendered a blank white page for any search containing such a listing. The
// boundary fix in remote.ts is the root-cause fix; String() here means no future caller (or a
// newly-added shape on another platform) can turn one odd source value into a blank screen again.
function arAttrValue(label: string, value: string, locale: string): string {
  const v = String(value ?? '').trim();
  if (!v) return value;
  const ll = String(label ?? '').trim().toLowerCase();
  const lv = v.toLowerCase();
  if (AR_YESNO[lv]) return AR_YESNO[lv];                                   // Electricity/Water/booleans
  if (ll === 'age') {
    if (lv === 'new') return 'جديد';
    if (lv === '<1 year' || lv === 'less than 1 year') return 'أقل من سنة';
    const plus = /^(\d+)\s*\+\s*years?$/i.exec(v); if (plus) return `أكثر من ${plus[1]} سنوات`;
    const yrs = /^(\d+)\s*years?$/i.exec(v);
    if (yrs) { const n = +yrs[1]; return n === 1 ? 'سنة واحدة' : n === 2 ? 'سنتان' : `${n} سنوات`; }
    return v;
  }
  if (ll === 'facade') {
    if (AR_ENUM.facade[lv]) return AR_ENUM.facade[lv];
    const st = /^(\d+)\s*streets?$/i.exec(v); if (st) return `${st[1]} شوارع`;
    // (fix, 2026-07-16) dealapp's scraper mis-captures raw HTML/meta-tag fragments into this
    // field (e.g. '<meta name="twitter:title" content="...') — neither the compass-direction
    // enum nor the digit-streets regex above matches garbage/English, so it used to render
    // verbatim. Same free-text leak guard as the generic fallback below.
    return arabicOrPlaceholderForFreeText(v, locale, ATTRIBUTE_UNRESOLVED_AR);
  }
  const map = AR_ENUM[ll];
  if (map && map[lv]) return map[lv];
  // Free-text (never translated — real source content). English-leak check (owner report,
  // 2026-07-16: abeea.com.sa's street_address is captured in English) is scoped to genuine prose
  // labels only, so a license/plan/parcel number containing a Latin letter is never blanked.
  if (FREE_TEXT_PROSE_LABELS.has(ll)) return arabicOrPlaceholderForFreeText(v, locale, ATTRIBUTE_UNRESOLVED_AR);
  // A mixed-script value (therc's «5,000 ر.س / yearly») carries an Arabic char, so the free-text
  // leak guard above rightly passes it through as real source content — and the English period word
  // rode along with it onto an Arabic card. Closed enum, display-layer only. (2026-09-18)
  return translateTrailingPeriodWord(v, locale);
}

// Render Wasalt's "Additional Information" rows on the card. Shows first 4 rows, with a
// "See more" toggle that reveals the rest. Hidden entirely for Aqar (and for any Wasalt row
// where the field hasn't been backfilled yet). Mirrors the on-site Wasalt panel design.
function AdditionalInformationPanel({ listing, t, locale, oneLine, unfolded }: {
  listing: Listing; t: (k: string, p?: any) => string; locale: string;
  /** Laptop 'tight' row: the same rows as one truncated line (the card unfolds it on tap). */
  oneLine?: boolean; unfolded?: boolean;
}) {
  const rows = listing.additional_info;
  if (!rows || rows.length === 0) return null;
  // Preserve the existing valid-row filter; all rows are visible without an expander.
  const all = rows.filter((r) => r && r.label && r.value);
  if (all.length === 0) return null;
  const visible = all;
  if (oneLine) {
    return (
      <Text numberOfLines={unfolded ? undefined : 1} style={[card.oneLine, locale === 'ar' ? card.oneLineRtl : card.oneLineLtr]}>
        {visible.map((r) => (
          <Text key={r.key}>
            <Text style={card.addlLabel}>{attrDisplayLabel(t(r.label), r.key, locale, ATTRIBUTE_UNRESOLVED_AR)} </Text>
            <Text style={card.addlValue}>{arAttrValue(r.label, r.value, locale)}</Text>
            {'\u2003'}
          </Text>
        ))}
      </Text>
    );
  }
  return (
    <View style={card.addlPanel}>
      <View style={card.addlGrid}>
        {visible.map((r) => (
          <View key={r.key} style={card.addlCell}>
            {/* The source's own Arabic `key` outranks the placeholder — see attrDisplayLabel. */}
            <Text style={card.addlLabel}>{attrDisplayLabel(t(r.label), r.key, locale, ATTRIBUTE_UNRESOLVED_AR)}</Text>
            <Text style={card.addlValue}>{arAttrValue(r.label, r.value, locale)}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}

// Original brand artwork shared with the website picker. Source aliases remain explicit below.
const AQAR_LOGO = require('../../assets/images/platform-logos/sa-aqar-fm.png');
const WASALT_LOGO = require('../../assets/images/platform-logos/wasalt-sa.png');
const ALDARIM_LOGO = require('../../assets/images/platform-logos/aldarim-sa.png');
const AQARGATE_LOGO = require('../../assets/images/platform-logos/aqargate-com.png');
const ALHOSHAN_LOGO = require('../../assets/images/platform-logos/alhoshan-sa.png');
const HAJER_LOGO = require('../../assets/images/platform-logos/hajerhouses-com.png');
const SANADAK_LOGO = require('../../assets/images/platform-logos/sanadak-sa.png');
const EASTABHA_LOGO = require('../../assets/images/platform-logos/eastabha-sa.png');
const AQARCITY_LOGO = require('../../assets/images/aqarcity-logo.png');
const RAGHDAN_LOGO = require('../../assets/images/platform-logos/raghdan-sa.png');
const EAQARTABUK_LOGO = require('../../assets/images/platform-logos/eaqartabuk-com.png');
const SATEL_LOGO = require('../../assets/images/platform-logos/satel-sa.png');
const SADIN_LOGO = require('../../assets/images/sadin.png');
const TOOR_LOGO = require('../../assets/images/toor.png');
const MUSTQR_LOGO = require('../../assets/images/platform-logos/mustqr-sa.png');
const RAMZALQASIM_LOGO = require('../../assets/images/ramzalqassim.png');
const FURSAGHYR_LOGO = require('../../assets/images/platform-logos/fursaghyr-com.png');
const JAZWTN_LOGO = require('../../assets/images/platform-logos/jazwtn-sa.png');
const MUKTAMEL_LOGO = require('../../assets/images/platform-logos/muktamel-com.png');
const MIZLAJ_LOGO = require('../../assets/images/platform-logos/mizlaj-com-sa.png');
const DEALAPP_LOGO = require('../../assets/images/dealapp.png');
const GATHERN_LOGO = require('../../assets/images/platform-logos/gathern-co.png');
const OCTOBER_LOGO = require('../../assets/images/platform-logos/1october-com-sa.png');
const ARKAAN_LOGO = require('../../assets/images/platform-logos/arkaanalaqar-com.png');
const ABRALOSOL_LOGO = require('../../assets/images/platform-logos/abralosol-com.png');
const THERC_LOGO = require('../../assets/images/platform-logos/therc-sa.png');
const RAWASIDARK_LOGO = require('../../assets/images/platform-logos/rawasi-dark-com.png');
const AOUJ_LOGO = require('../../assets/images/platform-logos/aoujestates-com.png');
const AQARATIKOM_LOGO = require('../../assets/images/platform-logos/nawait-sa.png');
const BAHADHABAB_LOGO = require('../../assets/images/platform-logos/bahadhabab-res-com.png');
const ALOBID_LOGO = require('../../assets/images/platform-logos/alobidoffice-com.png');
const ABWBNA_LOGO = require('../../assets/images/platform-logos/abwbna-com.png');
const REMAL_LOGO = require('../../assets/images/platform-logos/remalre-com.png');
const AMAALL_LOGO = require('../../assets/images/amaall.png');
const AQARALSAUDIA_LOGO = require('../../assets/images/aqaralsaudia.png');
const SUWAR_LOGO = require('../../assets/images/platform-logos/suwar-sa.png');
const GUDAI_LOGO = require('../../assets/images/platform-logos/gudai-inblaj-net.png');
const SAFERA_LOGO = require('../../assets/images/platform-logos/safera-inblaj-net.png');
const ALHUMAIDAN_LOGO = require('../../assets/images/alhumaidan.png');
const AQARNAJRAN_LOGO = require('../../assets/images/platform-logos/aqarnajran-com.png');
const FAHADALSHAHRI_LOGO = require('../../assets/images/platform-clean/maqam.png');
const COMPOUNDIN_LOGO = require('../../assets/images/platform-logos/compoundin-com.png');
const WSLNAA_LOGO = require('../../assets/images/wslnaa.png');
const RAKEZ_LOGO = require('../../assets/images/platform-logos/rakez-sa.png');
const AKARIYOUN_LOGO = require('../../assets/images/platform-logos/akariyoun-sa.png');
// Owner-supplied logos replace the former generic office placeholders.
const MOFTAH_LOGO = require('../../assets/images/platform-logos/moftah-aleaqar-com.png');
const MASAR_LOGO = require('../../assets/images/platform-logos/masaraqarat-com.png');
const GOMENASSAT_LOGO = require('../../assets/images/platform-clean/menassat.png');
const SAKAN_LOGO = require('../../assets/images/platform-logos/sa-sakan-co.png');
const BOSSBIH_LOGO = require('../../assets/images/platform-logos/bossbihoffice-com-sa.png');
const ALSHAWAF_LOGO = require('../../assets/images/platform-logos/alshawaf-com-sa.png');
const IALQARAWI_LOGO = require('../../assets/images/platform-logos/ialqarawi-com.png');
const ALJASSIM_LOGO = require('../../assets/images/platform-logos/aljassimaqar-com.png');
const ALMOTMKENAH_LOGO = require('../../assets/images/platform-logos/almotmkenah-com.png');
const NUFOUTH_LOGO = require('../../assets/images/nufouth.png');
const ALSIDRA_LOGO = require('../../assets/images/platform-logos/alsidra.png');
const SHATRI_LOGO = require('../../assets/images/platform-logos/shatri.png');
const ALQASEM_LOGO = require('../../assets/images/platform-logos/alqasem.png');
const FKRALEMAR_LOGO = require('../../assets/images/platform-logos/fkralemar.png');
const WADOD_LOGO = require('../../assets/images/platform-logos/wadod.png');
const ALMUTEB_LOGO = require('../../assets/images/platform-clean/almuteb.png');
const AALBARRAK_LOGO = require('../../assets/images/platform-logos/aalbarrak.png');
const ALRIFAI_LOGO = require('../../assets/images/platform-clean/alrifai-small.png');
const SODASYAT_LOGO = require('../../assets/images/platform-logos/sodasyat.png');
const HASAAD_LOGO = require('../../assets/images/platform-logos/hasaad.png');
const AQARALRIYADH_LOGO = require('../../assets/images/platform-logos/aqaralriyadh.png');
const SNAM_LOGO = require('../../assets/images/platform-logos/snam.png');
const JAWHER_LOGO = require('../../assets/images/platform-logos/jawher.png');
const M3TMD_LOGO = require('../../assets/images/platform-logos/m3tmd.png');
const SENAN_LOGO = require('../../assets/images/platform-logos/senan.png');
const YAMEEN_LOGO = require('../../assets/images/platform-logos/yameen.png');
const ALBDAH_LOGO = require('../../assets/images/platform-logos/albdah.png');
const EYDAH_LOGO = require('../../assets/images/platform-logos/eydah.png');
const TAMYAZ_LOGO = require('../../assets/images/platform-logos/tamyaz.png');
const HAZIM_LOGO = require('../../assets/images/platform-logos/hazim.png');
const VILLASSA_LOGO = require('../../assets/images/platform-logos/villassa.png');
const MARKSA_LOGO = require('../../assets/images/platform-logos/marksa.png');
const LIVINGCOMPOUND_LOGO = require('../../assets/images/platform-logos/livingcompound.png');
const AZURE_LOGO = require('../../assets/images/platform-logos/azure.png');
const EXPATTRUSTED_LOGO = require('../../assets/images/platform-logos/expattrusted.png');
const FLOW_LOGO = require('../../assets/images/platform-clean/flow.png');
const SQUARES_LOGO = require('../../assets/images/platform-logos/squares.png');
const RAWAF_LOGO = require('../../assets/images/platform-logos/rawaf.png');
const MACSAIB_LOGO = require('../../assets/images/platform-logos/macsaib.png');
const ARSHGLOBAL_LOGO = require('../../assets/images/platform-logos/arsh.png');
const SUPEROFFICE_LOGO = require('../../assets/images/platform-logos/superoffice.png');
const MAKTAB_LOGO = require('../../assets/images/platform-logos/maktab.png');
const WAJAF_LOGO = require('../../assets/images/platform-logos/wajaf.png');
const ALBUKAERI_LOGO = require('../../assets/images/platform-logos/albukaeri.png');
const RYADAH_LOGO = require('../../assets/images/platform-logos/ryadah.png');
const SQCC_LOGO = require('../../assets/images/platform-logos/sqcc.png');
const DARAA_LOGO = require('../../assets/images/platform-logos/daraa.png');
const TAWIA_LOGO = require('../../assets/images/platform-logos/tawia.png');
const MANZO_LOGO = require('../../assets/images/platform-logos/manzo.png');
const EIGHTFLOOR_LOGO = require('../../assets/images/platform-logos/eightfloor.png');
const HOLOUL_LOGO = require('../../assets/images/platform-logos/holoul.png');
const NAFITHH_LOGO = require('../../assets/images/platform-logos/nafithh.png');
const MOBASHER_LOGO = require('../../assets/images/platform-logos/mobasher.png');
const MUAJARH_LOGO = require('../../assets/images/platform-logos/muajarh.png');
const DALLALI_LOGO = require('../../assets/images/platform-logos/dallali.png');
const MAQAMCO_LOGO = require('../../assets/images/platform-logos/maqam.png');
const EARTHAPP_LOGO = require('../../assets/images/platform-logos/earthapp.png');
const NAWAFETH_LOGO = require('../../assets/images/platform-logos/nawafeth.png');
const REMAX_LOGO = require('../../assets/images/platform-logos/remaxsa.png');
const QMRA_LOGO = require('../../assets/images/platform-logos/qmra.png');
const ALAJLAN_LOGO = require('../../assets/images/platform-logos/alajlan.png');
const EGO_LOGO = require('../../assets/images/platform-logos/ego.png');
const SAFA_LOGO = require('../../assets/images/platform-logos/safa.png');
const DWELLEO_LOGO = require('../../assets/images/platform-logos/dwelleo-sa.png');
const MUHAYSINI_LOGO = require('../../assets/images/platform-logos/aqaralmuhaysini-com.png');
const TUBA_LOGO = require('../../assets/images/platform-logos/tuba-com-sa.png');
const NOFODH_LOGO = require('../../assets/images/platform-logos/nofodh-sa.png');
const AQALEMHAJER_LOGO = require('../../assets/images/platform-logos/aqalemhajer-com.png');
const WAHADAT_LOGO = require('../../assets/images/platform-logos/wahadat-sa.png');
const ASHAB_LOGO = require('../../assets/images/platform-logos/ashab-sa.png');
const REINVEST_LOGO = require('../../assets/images/platform-logos/reinvest-sa.png');
const SIRDAB_LOGO = require('../../assets/images/platform-logos/marketplace-sirdab-co.png');
const SOKOK_LOGO = require('../../assets/images/platform-logos/sokok-sa.png');
const ABAAD_LOGO = require('../../assets/images/platform-logos/app-abaadapp-sa.png');
const ALSAEDAN_LOGO = require('../../assets/images/alsaedan.png');
const SAKANI_LOGO = require('../../assets/images/sakani.png');
const SUKNA_LOGO = require('../../assets/images/platform-logos/sukna-app.png');
const DARYUSUF_LOGO = require('../../assets/images/platform-logos/daryusuf-com.png');
const EILMALRIYADA_LOGO = require('../../assets/images/eilmalriyada.png');
const GOLDENDEAL_LOGO = require('../../assets/images/platform-logos/goldendeal-sa.png');
const EBRIZA_LOGO = require('../../assets/images/platform-logos/ebriza-com-sa.png');
const SHOMOU_LOGO = require('../../assets/images/platform-logos/shomoalaqar-com-sa.png');
const VMKSA_LOGO = require('../../assets/images/platform-logos/vm-ksa-com.png');
const IBAAX_LOGO = require('../../assets/images/platform-logos/ibaax-sa.png');
const THOUSAND_LOGO = require('../../assets/images/platform-logos/1000-com-sa.png');
const RAZRE_LOGO = require('../../assets/images/platform-clean/raz.png');
const MAQRAT_LOGO = require('../../assets/images/platform-clean/maqrat.png');
const OPENSOOQ_LOGO = require('../../assets/images/platform-logos/sa-opensooq-com.png');
const JUSTSA_LOGO = require('../../assets/images/platform-logos/just-sa.png');
const MANAFE_LOGO = require('../../assets/images/platform-logos/manafe-com-sa.png');
const RIGHTCOMPOUND_LOGO = require('../../assets/images/platform-logos/rightcompound-com.png');
const KSAAQAR_LOGO = require('../../assets/images/platform-logos/ksaaqar-com.png');
const SADIQELTAJER_LOGO = require('../../assets/images/platform-logos/sadiq-eltajer-sa.png');
const AMLAKALAHSA_LOGO = require('../../assets/images/platform-logos/amlakalahsa-com.png');
const ALTA_LOGO = require('../../assets/images/alta.png');
const SHMOUALSHMAL_LOGO = require('../../assets/images/platform-logos/shmoua-alshmal-com.png');
const AWAL_LOGO = require('../../assets/images/awal.png');
const AZDAD_LOGO = require('../../assets/images/platform-logos/azdadalaqaria-com.png');
const ALKHAAS_LOGO = require('../../assets/images/platform-logos/alkhaas-net.png');
const ABEEA_LOGO = require('../../assets/images/platform-logos/abeea-com-sa.png');
const JURASH_LOGO = require('../../assets/images/platform-logos/jurash-sa.png');
const ALNOKHBA_LOGO = require('../../assets/images/alnokhba.png');
const SOUQ24_LOGO = require('../../assets/images/platform-logos/24-com-sa.png');
const ERAPULSE_LOGO = require('../../assets/images/platform-logos/erapulse-sa.png');
const NOWAISIRY_LOGO = require('../../assets/images/nowaisiry.png');
// Card hero photo with graceful fallback. Some sources (e.g. aqarcity) carry photo URLs that have
// been deleted on their CDN and 302→/notfound, or are only published as thumbnails — listing one
// dead URL would leave the card with an empty grey block. We try each URL in order and, if every
// one fails (or the listing genuinely has no photo), render a clean "no photo" placeholder.
function ListingPhoto({ photos, style, t }: { photos: string[]; style: any; t: (k: string) => string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [photos.join('|')]);

  // ON WEB, expo-image's onError DOES NOT FIRE when the browser BLOCKS the response rather than
  // failing to fetch it. Verified live 2026-09-06 against sadin.com.sa, whose media replies
  // `cross-origin-resource-policy: same-origin` — Chrome refuses the embed with
  // ERR_BLOCKED_BY_RESPONSE.NotSameOrigin. The rendered <img> sat at complete=false,
  // naturalWidth=0, STILL ON PHOTO #1 after 20s: the onError below never ran, idx never advanced,
  // the `!uri` placeholder was never reached, and the card showed a 240x200 EMPTY BOX. A listing
  // with 20 real photos in the database rendered as a blank rectangle, forever.
  //
  // A bare `new window.Image()` on the SAME url fires `error` normally, so we do our own probe and
  // advance idx ourselves. This retires the whole class, not just this host: a CORP-blocked image,
  // a 404, a deleted CDN object and a hotlink-denied referer all end at the honest placeholder
  // instead of a blank box. Native keeps expo-image's own onError, which works there.
  //
  // The probe costs one extra request per candidate; the browser cache then serves the <img>
  // render for free, and a URL that loads is never probed twice (idx stops advancing).
  const key = photos.join('|');
  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const uri = photos[idx];
    if (!uri) return;
    let cancelled = false;
    const probe = new window.Image();
    // Only ever advance PAST the url we probed — a stale probe resolving late must not skip a
    // good photo that a newer render already settled on.
    probe.onerror = () => { if (!cancelled) setIdx((i) => (i === idx ? i + 1 : i)); };
    probe.src = uri;
    return () => { cancelled = true; probe.onerror = null; };
  }, [key, idx]);

  const uri = photos[idx];
  if (!uri) {
    return (
      <View style={[style, card.photoFallback]}>
        <Ionicons name="image-outline" size={28} color={colors.muted} />
        <Text style={card.photoFallbackText}>{t('No photo available')}</Text>
      </View>
    );
  }
  return (
    <Image
      key={uri}
      source={{ uri }}
      style={style}
      contentFit="cover"
      transition={150}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

export function SourceBadge({ source }: { source: string }) {
  // SPACING IS NOT IDENTITY (production defect, 2026-09-04). Every branch below tests a closed-up
  // slug, but the DB `source` value is a human brand string that often carries SPACES: production
  // stores 'Abr Alosol', 'THE RC' and 'Rawasi Dark', so `includes('abralosol' | 'therc' |
  // 'rawasidark')` all missed and 3,165 live listings fell through to the Aqar fallback below —
  // Aqar's name, Aqar's logo, and a click-through to sa.aqar.fm on another company's listing. Same
  // trap that hit 'Al Khaas' and 'Al Nokhba', which were each patched one-off with an extra alias.
  // Searching BOTH the raw string and a space-stripped copy retires the whole class instead of the
  // next instance of it: a spaced brand and its slug now match the same branch, and the existing
  // spaced tokens ('al khaas') keep working because the raw form is still in the haystack. The '|'
  // separator cannot appear in any token, so nothing can match across the join.
  const raw = source.toLowerCase();
  const s = raw + '|' + raw.replace(/\s+/g, '');
  if (s.includes('wasalt')) return <PlatformLogo source={WASALT_LOGO} />;
  if (s.includes('aldarim')) return <PlatformLogo source={ALDARIM_LOGO} />;
  if (s.includes('aqargate')) return <PlatformLogo source={AQARGATE_LOGO} />;
  if (s.includes('alhoshan')) return <PlatformLogo source={ALHOSHAN_LOGO} />;
  if (s.includes('aqalemhajer') || s.includes('مكتب أقاليم هجر للخدمات العقارية')) return <PlatformLogo source={AQALEMHAJER_LOGO} />; // 2026-09-24: BEFORE 'hajer', which 'aqalemhajer' contains
  if (s.includes('hajer')) return <PlatformLogo source={HAJER_LOGO} />;
  if (s.includes('sanadak')) return <PlatformLogo source={SANADAK_LOGO} />;
  if (s.includes('eastabha')) return <PlatformLogo source={EASTABHA_LOGO} />;
  if (s.includes('aqarcity')) return <PlatformLogo source={AQARCITY_LOGO} />;
  if (s.includes('raghdan')) return <PlatformLogo source={RAGHDAN_LOGO} />;
  if (s.includes('eaqartabuk')) return <PlatformLogo source={EAQARTABUK_LOGO} />;
  if (s.includes('satel')) return <PlatformLogo source={SATEL_LOGO} />;
  if (s.includes('sadin')) return <PlatformLogo source={SADIN_LOGO} />;
  if (s.includes('toor')) return <PlatformLogo source={TOOR_LOGO} />;
  if (s.includes('mustqr')) return <PlatformLogo source={MUSTQR_LOGO} />;
  if (s.includes('ramzalqasim')) return <PlatformLogo source={RAMZALQASIM_LOGO} />;
  if (s.includes('fursaghyr')) return <PlatformLogo source={FURSAGHYR_LOGO} />;
  if (s.includes('jazwtn')) return <PlatformLogo source={JAZWTN_LOGO} />;
  if (s.includes('muktamel')) return <PlatformLogo source={MUKTAMEL_LOGO} />;
  if (s.includes('mizlaj')) return <PlatformLogo source={MIZLAJ_LOGO} />;
  // Batch 7 — text-chips until the user supplies logos.
  if (s.includes('aqaratikom')) return <PlatformLogo source={AQARATIKOM_LOGO} />;
  if (s.includes('shmou al shmal') || s.includes('shmoualshmal')) return <PlatformLogo source={SHMOUALSHMAL_LOGO} />;
  if (s.includes('bahadhabab')) return <PlatformLogo source={BAHADHABAB_LOGO} />;
  if (s.includes('alobid')) return <PlatformLogo source={ALOBID_LOGO} />;
  if (s.includes('abwbna')) return <PlatformLogo source={ABWBNA_LOGO} />;
  if (s.includes('remal')) return <PlatformLogo source={REMAL_LOGO} />;
  if (s.includes('amaall')) return <PlatformLogo source={AMAALL_LOGO} />;
  // Owner supplied this office's own logo 2026-09-13, so it no longer renders bare. It MUST stay
  // above any bare 'aqar' branch: the slug 'aqaralsaudia' contains 'aqar', and falling through
  // would stamp عقار's mark on another company's listing — the misattribution the owner flagged
  // as a legal problem, not a cosmetic one.
  // عقارات السعودية (ksaaqar) / صادق التاجر (sadiqeltajer) — owner is supplying the logo files
  // later, so these render as TEXT CHIPS for now (the same deliberate `null` suwar/راكز held).
  // They MUST stay above the fallback, and ksaaqar MUST stay above any bare 'aqar' branch: the
  // slug 'ksaaqar' contains 'aqar', and falling through would stamp عقار's mark on another
  // company's listing — the misattribution the owner flagged as a legal problem, not cosmetic.
  if (s.includes('ksaaqar') || s.includes('ksa aqar') || s.includes('عقارات السعودية')) return <PlatformLogo source={KSAAQAR_LOGO} />;
  if (s.includes('sadiqeltajer') || s.includes('sadiq eltajer') || s.includes('sadiq-eltajer') || s.includes('صادق التاجر')) return <PlatformLogo source={SADIQELTAJER_LOGO} />;
  // توور — the owner keeps toor on the platform list for its brand even though it currently
  // returns no listings, so the badge must exist: 'toor' would otherwise fall through to the
  // عقار fallback at the end of this function and stamp another company's mark on it.
  if (s.includes('toor') || s.includes('توور')) return <PlatformLogo source={TOOR_LOGO} />;
  if (s.includes('aqaralsaudia')) return <PlatformLogo source={AQARALSAUDIA_LOGO} />;
  // سوار العقارية / راكز العقارية — logos landed 2026-09-15, so these two branches now render the
  // real mark instead of the deliberate `null` they held while the owner was still supplying the
  // files. They must keep EXISTING either way: the fallback at the end of this function returns
  // عقار's logo, so deleting a branch would stamp another company's mark on their listings — the
  // misattribution the owner flagged as a legal problem, not a cosmetic one.
  // Same two assets the search-loading strip uses (src/data/loaderPlatforms.ts); that duplication
  // is deliberate so the card path is never coupled to the loader's, and both must be updated when
  // an asset is renamed.
  if (s.includes('suwar')) return <PlatformLogo source={SUWAR_LOGO} />;
  if (s.includes('rakez')) return <PlatformLogo source={RAKEZ_LOGO} />;
  // ── onboarded 2026-09-20; placeholder mark until the owner supplies each real logo ──────────
  if (s.includes('gudai') || s.includes('غدي')) return <PlatformLogo source={GUDAI_LOGO} />;
  if (s.includes('safera') || s.includes('سفيرة')) return <PlatformLogo source={SAFERA_LOGO} />;
  if (s.includes('alhumaidan') || s.includes('al humaidan') || s.includes('الحميدان')) return <PlatformLogo source={ALHUMAIDAN_LOGO} />;
  // MUST stay above any bare 'aqar' branch: 'aqarnajran' CONTAINS 'aqar'.
  if (s.includes('aqarnajran') || s.includes('aqar najran') || s.includes('عقار نجران')) return <PlatformLogo source={AQARNAJRAN_LOGO} />;
  if (s.includes('fahadalshahri') || s.includes('fahad alshahri') || s.includes('فهد الشهري')) return <PlatformLogo source={FAHADALSHAHRI_LOGO} />;
  if (s.includes('compoundin') || s.includes('كومباوند')) return <PlatformLogo source={COMPOUNDIN_LOGO} />;
  if (s.includes('wslnaa') || s.includes('waslna') || s.includes('وصلنا')) return <PlatformLogo source={WSLNAA_LOGO} />;
  if (s.includes('akariyoun') || s.includes('عقاريون')) return <PlatformLogo source={AKARIYOUN_LOGO} />;
  if (s.includes('amlakalahsa')) return <PlatformLogo source={AMLAKALAHSA_LOGO} />;
  if (s.includes('alta')) return <PlatformLogo source={ALTA_LOGO} />;
  if (s.includes('awal')) return <PlatformLogo source={AWAL_LOGO} />;
  if (s.includes('azdad')) return <PlatformLogo source={AZDAD_LOGO} />;
  // DB source value is 'Al Khaas' (with a space, confirmed live, 0 exceptions) — 'alkhaas' alone never
  // matched it, so every Al Khaas listing silently fell through to the AQAR default (wrong name/host/
  // logo, found live 2026-07-25). Also match the no-space form in case that ever appears.
  if (s.includes('al khaas') || s.includes('alkhaas')) return <PlatformLogo source={ALKHAAS_LOGO} />;
  if (s.includes('abeea')) return <PlatformLogo source={ABEEA_LOGO} />;
  if (s.includes('jurash')) return <PlatformLogo source={JURASH_LOGO} />;
  if (s.includes('al nokhba') || s.includes('alnokhba')) return <PlatformLogo source={ALNOKHBA_LOGO} />;
  if (s.includes('gathern')) return <PlatformLogo source={GATHERN_LOGO} />;
  // 2026-06 batch — text-chips until the user supplies logos.
  if (s.includes('goldendeal') || s.includes('الصفقة الذهبية العقارية')) return <PlatformLogo source={GOLDENDEAL_LOGO} />; // 2026-09-24: BEFORE 'deal', which 'goldendeal' contains
  if (s.includes('deal')) return <PlatformLogo source={DEALAPP_LOGO} />;
  if (s.includes('souq')) return <PlatformLogo source={SOUQ24_LOGO} />;
  if (s.includes('pulse')) return <PlatformLogo source={ERAPULSE_LOGO} />;
  if (s.includes('nowaisiry')) return <PlatformLogo source={NOWAISIRY_LOGO} />;
  if (s.includes('october')) return <PlatformLogo source={OCTOBER_LOGO} />;
  if (s.includes('therc')) return <PlatformLogo source={THERC_LOGO} />;
  if (s.includes('aouj')) return <PlatformLogo source={AOUJ_LOGO} />;
  if (s.includes('abralosol')) return <PlatformLogo source={ABRALOSOL_LOGO} />;
  if (s.includes('arkaan')) return <PlatformLogo source={ARKAAN_LOGO} />;
  if (s.includes('rawasidark')) return <PlatformLogo source={RAWASIDARK_LOGO} />;
  // Keep new source aliases after the established specific matches.
  if (s.includes('alsidra') || s.includes('al sidra') || s.includes('السدرة')) return <PlatformLogo source={ALSIDRA_LOGO} />;
  if (s.includes('moftah') || s.includes('مفتاح العقار')) return <PlatformLogo source={MOFTAH_LOGO} />;
  if (s.includes('masar') || s.includes('مسار المستقبل')) return <PlatformLogo source={MASAR_LOGO} />;
  if (s.includes('menassat') || s.includes('منصات')) return <PlatformLogo source={GOMENASSAT_LOGO} />;
  if (s.includes('sakani') || s.includes('سكني')) return <PlatformLogo source={SAKANI_LOGO} />; // 2026-09-24: BEFORE 'sakan', which 'sakani' contains
  if (s.includes('sakan')) return <PlatformLogo source={SAKAN_LOGO} />;
  if (s.includes('bossbih') || s.includes('بوصبيح')) return <PlatformLogo source={BOSSBIH_LOGO} />;
  if (s.includes('alshawaf') || s.includes('al shawaf') || s.includes('الشواف')) return <PlatformLogo source={ALSHAWAF_LOGO} />;
  if (s.includes('alqarawi') || s.includes('القرعاوي')) return <PlatformLogo source={IALQARAWI_LOGO} />;
  if (s.includes('aljassim') || s.includes('al jassim') || s.includes('الجاسم')) return <PlatformLogo source={ALJASSIM_LOGO} />;
  if (s.includes('almotmkenah') || s.includes('المتمكنة')) return <PlatformLogo source={ALMOTMKENAH_LOGO} />;
  // نفوذ للاستثمار العقاري (nofodh.sa) BEFORE نفوذ (nufouth.com): «نفوذ» is a SUBSTRING of the longer
  // name, and first match wins, so the shorter branch would steal every nofodh card and show it under
  // another company's brand and domain. Specific token first. Caught by
  // verify-platform-registration-complete, which is the barrier that exists for exactly this.
  if (s.includes('نفوذ للاستثمار العقاري') || s.includes('nofodh')) return <PlatformLogo source={NOFODH_LOGO} />;
  if (s.includes('nufouth') || s.includes('نفوذ')) return <PlatformLogo source={NUFOUTH_LOGO} />;
  // Specific aliases above must precede shorter brand names.
  if (s.includes('dwelleo') || s.includes('دويليو')) return <PlatformLogo source={DWELLEO_LOGO} />;
  if (s.includes('shatri') || s.includes('الشاطري للتطوير العقاري')) return <PlatformLogo source={SHATRI_LOGO} />;
  if (s.includes('alqasem') || s.includes('القاسم العقارية')) return <PlatformLogo source={ALQASEM_LOGO} />;
  if (s.includes('fkralemar') || s.includes('فكر الإعمار')) return <PlatformLogo source={FKRALEMAR_LOGO} />;
  if (s.includes('wadod') || s.includes('ودود العقارية')) return <PlatformLogo source={WADOD_LOGO} />;
  if (s.includes('almuteb') || s.includes('آل متعب العقارية')) return <PlatformLogo source={ALMUTEB_LOGO} />;
  if (s.includes('aalbarrak') || s.includes('البراك للعقارات')) return <PlatformLogo source={AALBARRAK_LOGO} />;
  if (s.includes('alrifai') || s.includes('الرفاعي للعقار')) return <PlatformLogo source={ALRIFAI_LOGO} />;
  if (s.includes('sodasyat') || s.includes('سداسيات العقارية')) return <PlatformLogo source={SODASYAT_LOGO} />;
  if (s.includes('hasaad') || s.includes('حصاد الاقتصادية للعقارات')) return <PlatformLogo source={HASAAD_LOGO} />;
  if (s.includes('aqaralriyadh') || s.includes('عقار الرياض')) return <PlatformLogo source={AQARALRIYADH_LOGO} />;
  if (s.includes('justsa') || s.includes('فقط نقطة العقارية')) return <PlatformLogo source={JUSTSA_LOGO} />;
  if (s.includes('snam') || s.includes('سنام العقارية')) return <PlatformLogo source={SNAM_LOGO} />;
  if (s.includes('jawher') || s.includes('جواهر للوساطة والتسويق العقاري')) return <PlatformLogo source={JAWHER_LOGO} />;
  if (s.includes('m3tmd') || s.includes('مقر المعتمد')) return <PlatformLogo source={M3TMD_LOGO} />;
  if (s.includes('senan') || s.includes('سنان العقارية')) return <PlatformLogo source={SENAN_LOGO} />;
  if (s.includes('thousand') || s.includes('1000 العقارية')) return <PlatformLogo source={THOUSAND_LOGO} />;
  if (s.includes('yameen') || s.includes('يمين العقارية')) return <PlatformLogo source={YAMEEN_LOGO} />;
  if (s.includes('ebriza') || s.includes('إبريزة العقارية')) return <PlatformLogo source={EBRIZA_LOGO} />;
  if (s.includes('eilmalriyada') || s.includes('علم الريادة الإدارية')) return <PlatformLogo source={EILMALRIYADA_LOGO} />;
  if (s.includes('daryusuf') || s.includes('دار يوسف العقارية')) return <PlatformLogo source={DARYUSUF_LOGO} />;
  if (s.includes('albdah') || s.includes('البداح للعقارات')) return <PlatformLogo source={ALBDAH_LOGO} />;
  if (s.includes('eydah') || s.includes('الإيضاح')) return <PlatformLogo source={EYDAH_LOGO} />;
  if (s.includes('tamyaz') || s.includes('تمايز العقارية')) return <PlatformLogo source={TAMYAZ_LOGO} />;
  if (s.includes('hazim') || s.includes('حازم')) return <PlatformLogo source={HAZIM_LOGO} />;
  if (s.includes('villassa') || s.includes('فلل')) return <PlatformLogo source={VILLASSA_LOGO} />;
  if (s.includes('marksa') || s.includes('مار العقارية')) return <PlatformLogo source={MARKSA_LOGO} />;
  if (s.includes('rightcompound')) return <PlatformLogo source={RIGHTCOMPOUND_LOGO} />;
  if (s.includes('livingcompound')) return <PlatformLogo source={LIVINGCOMPOUND_LOGO} />;
  if (s.includes('azure')) return <PlatformLogo source={AZURE_LOGO} />;
  if (s.includes('expattrusted') || s.includes('expat trusted housing')) return <PlatformLogo source={EXPATTRUSTED_LOGO} />;
  if (s.includes('flow')) return <PlatformLogo source={FLOW_LOGO} />;
  if (s.includes('أبعاد') || s.includes('abaad')) return <PlatformLogo source={ABAAD_LOGO} />;
  if (s.includes('آي باكس') || s.includes('ibaax')) return <PlatformLogo source={IBAAX_LOGO} />;
  if (s.includes('وحدات') || s.includes('wahadat')) return <PlatformLogo source={WAHADAT_LOGO} />;
  if (s.includes('المربعات') || s.includes('squares')) return <PlatformLogo source={SQUARES_LOGO} />;
  if (s.includes('رواف') || s.includes('rawaf')) return <PlatformLogo source={RAWAF_LOGO} />;
  if (s.includes('المسوق الافتراضي') || s.includes('vm-ksa') || s.includes('vmksa')) return <PlatformLogo source={VMKSA_LOGO} />;
  if (s.includes('مكسب العقارية') || s.includes('macsaib')) return <PlatformLogo source={MACSAIB_LOGO} />;
  if (s.includes('maqrat')) return <PlatformLogo source={MAQRAT_LOGO} />;
  if (raw === 'arsh' || s.includes('عرش العقارية') || s.includes('arshglobal')) return <PlatformLogo source={ARSHGLOBAL_LOGO} />;
  if (s.includes('سوبر أوفيس') || s.includes('superoffice') || s.includes('super office')) return <PlatformLogo source={SUPEROFFICE_LOGO} />;
  if (s.includes('شموع العقار') || s.includes('shomou')) return <PlatformLogo source={SHOMOU_LOGO} />;
  if (s.includes('منصة مكتب') || s.includes('maktab')) return <PlatformLogo source={MAKTAB_LOGO} />;
  if (s.includes('سرداب') || s.includes('sirdab')) return <PlatformLogo source={SIRDAB_LOGO} />;
  if (raw === 'ashab' || s.includes('عشاب العقارية') || s.includes('ashab.sa')) return <PlatformLogo source={ASHAB_LOGO} />;
  if (s.includes('منافع العقارية') || s.includes('manafe')) return <PlatformLogo source={MANAFE_LOGO} />;
  if (s.includes('وجف العقارية') || s.includes('wajaf')) return <PlatformLogo source={WAJAF_LOGO} />;
  if (s.includes('البكيري العقارية') || s.includes('albukaeri')) return <PlatformLogo source={ALBUKAERI_LOGO} />;
  if (s.includes('ريادة العقارية') || s.includes('ryadah')) return <PlatformLogo source={RYADAH_LOGO} />;
  if (s.includes('مجموعة صالح القرشي العقارية') || s.includes('sqcc')) return <PlatformLogo source={SQCC_LOGO} />;
  if (s.includes('دارا للتطوير العقاري') || s.includes('daraa')) return <PlatformLogo source={DARAA_LOGO} />;
  if (s.includes('مكتب طوية للعقار') || s.includes('tawia')) return <PlatformLogo source={TAWIA_LOGO} />;
  if (s.includes('مانزو') || s.includes('manzo')) return <PlatformLogo source={MANZO_LOGO} />;
  if (s.includes('الطابق الثامن') || s.includes('8floor') || s.includes('eightfloor')) return <PlatformLogo source={EIGHTFLOOR_LOGO} />;
  if (s.includes('حلول') || s.includes('holoul')) return <PlatformLogo source={HOLOUL_LOGO} />;
  if (s.includes('السوق المفتوح') || s.includes('opensooq')) return <PlatformLogo source={OPENSOOQ_LOGO} />;
  if (s.includes('معرض نافذة') || s.includes('nafithh')) return <PlatformLogo source={NAFITHH_LOGO} />;
  if (s.includes('مباشر') || s.includes('mobasher')) return <PlatformLogo source={MOBASHER_LOGO} />;
  if (s.includes('مؤاجرة') || s.includes('muajarh')) return <PlatformLogo source={MUAJARH_LOGO} />;
  if (s.includes('دلّالي') || s.includes('dallali')) return <PlatformLogo source={DALLALI_LOGO} />;
  if (raw === 'maqam' || s.includes('شركة مقام للتطوير العقاري') || s.includes('maqamco') || s.includes('maqam development')) return <PlatformLogo source={MAQAMCO_LOGO} />;
  if (s.includes('تطبيق أرض') || s.includes('earthapp')) return <PlatformLogo source={EARTHAPP_LOGO} />;
  if (s.includes('نوافذ الوطن') || s.includes('nawafeth') || s.includes('nawafethalwatan')) return <PlatformLogo source={NAWAFETH_LOGO} />;
  if (s.includes('re/max') || s.includes('remaxsa')) return <PlatformLogo source={REMAX_LOGO} />;
  if (s.includes('قمرا') || s.includes('qmra')) return <PlatformLogo source={QMRA_LOGO} />;
  if (s.includes('العجلان') || s.includes('alajlan')) return <PlatformLogo source={ALAJLAN_LOGO} />;
  if (s.includes('آل سعيدان') || s.includes('alsaedan')) return <PlatformLogo source={ALSAEDAN_LOGO} />;
  if (s.includes('إيجو عقار') || s.includes('ego')) return <PlatformLogo source={EGO_LOGO} />;
  if (s.includes('أحمد المحيسني العقارية') || s.includes('muhaysini')) return <PlatformLogo source={MUHAYSINI_LOGO} />;
  if (s.includes('راز العقارية') || s.includes('razre')) return <PlatformLogo source={RAZRE_LOGO} />;
  if (s.includes('ري إنفست') || s.includes('reinvest')) return <PlatformLogo source={REINVEST_LOGO} />;
  if (s.includes('صفا للاستثمار') || s.includes('safa')) return <PlatformLogo source={SAFA_LOGO} />;
  if (s.includes('صكوك العقارية') || s.includes('sokok')) return <PlatformLogo source={SOKOK_LOGO} />;
  if (s.includes('سكنة') || s.includes('sukna')) return <PlatformLogo source={SUKNA_LOGO} />;
  if (s.includes('طوبة العقارية') || s.includes('tuba')) return <PlatformLogo source={TUBA_LOGO} />;
  return <PlatformLogo source={AQAR_LOGO} />;
}

// Hostname helper for the "Hosted on X" labels. Mirrors SourceBadge's matching. (`sourceName` moved
// to src/lib/listingDisplay.ts, owner 2026-08-22, so Read Aloud shares the exact same platform-name
// mapping instead of a second copy that could drift.)
function sourceHost(source: string): string {
  // SPACING IS NOT IDENTITY (production defect, 2026-09-04). Every branch below tests a closed-up
  // slug, but the DB `source` value is a human brand string that often carries SPACES: production
  // stores 'Abr Alosol', 'THE RC' and 'Rawasi Dark', so `includes('abralosol' | 'therc' |
  // 'rawasidark')` all missed and 3,165 live listings fell through to the Aqar fallback below —
  // Aqar's name, Aqar's logo, and a click-through to sa.aqar.fm on another company's listing. Same
  // trap that hit 'Al Khaas' and 'Al Nokhba', which were each patched one-off with an extra alias.
  // Searching BOTH the raw string and a space-stripped copy retires the whole class instead of the
  // next instance of it: a spaced brand and its slug now match the same branch, and the existing
  // spaced tokens ('al khaas') keep working because the raw form is still in the haystack. The '|'
  // separator cannot appear in any token, so nothing can match across the join.
  const raw = source.toLowerCase();
  const s = raw + '|' + raw.replace(/\s+/g, '');
  // onboarded 2026-09-20. 'aqarnajran' MUST precede any bare 'aqar' branch — it contains it.
  if (s.includes('gudai') || s.includes('غدي')) return 'gudai.inblaj.net';
  if (s.includes('safera') || s.includes('سفيرة')) return 'safera.inblaj.net';
  if (s.includes('alhumaidan') || s.includes('الحميدان')) return 'al-humaidan.inblaj.net';
  if (s.includes('aqarnajran') || s.includes('عقار نجران')) return 'aqarnajran.com';
  if (s.includes('fahadalshahri') || s.includes('فهد الشهري')) return 'fahadalshahri.com';
  if (s.includes('compoundin') || s.includes('كومباوند')) return 'compoundin.com';
  if (s.includes('wslnaa') || s.includes('waslna') || s.includes('وصلنا')) return 'wslnaa.com';
  if (s.includes('wasalt')) return 'wasalt.sa';
  if (s.includes('aldarim')) return 'aldarim.sa';
  if (s.includes('aqargate')) return 'aqargate.com';
  if (s.includes('alhoshan')) return 'alhoshan.sa';
  if (s.includes('aqalemhajer') || s.includes('مكتب أقاليم هجر للخدمات العقارية')) return 'aqalemhajer.com'; // 2026-09-24: BEFORE 'hajer', which 'aqalemhajer' contains
  if (s.includes('hajer')) return 'hajerhouses.com';
  if (s.includes('sanadak')) return 'sanadak.sa';
  if (s.includes('eastabha')) return 'eastabha.sa';
  if (s.includes('aqarcity')) return 'aqarcity.net';
  if (s.includes('raghdan')) return 'raghdan.sa';
  if (s.includes('eaqartabuk')) return 'eaqartabuk.com';
  if (s.includes('satel')) return 'satel.sa';
  if (s.includes('sadin')) return 'sadin.com.sa';
  if (s.includes('toor')) return 'toor.ooo';
  if (s.includes('mustqr')) return 'mustqr.sa';
  if (s.includes('ramzalqasim')) return 'ramzalqasim.com';
  if (s.includes('fursaghyr')) return 'fursaghyr.com';
  if (s.includes('jazwtn')) return 'jazwtn.sa';
  if (s.includes('mizlaj')) return 'mizlaj.com.sa';
  if (s.includes('muktamel')) return 'muktamel.com';
  // Real Aqaratikom listing_url is always nawait.sa (confirmed live, 0 exceptions) — matches
  // sourceName()'s own 'Nawait' label for the same source string. (found live 2026-07-25.)
  if (s.includes('aqaratikom')) return 'nawait.sa';
  if (s.includes('shmou al shmal') || s.includes('shmoualshmal')) return 'shmoua-alshmal.com';
  if (s.includes('bahadhabab')) return 'bahadhabab-res.com';
  if (s.includes('alobid')) return 'alobidoffice.com';
  if (s.includes('abwbna')) return 'abwbna.com';
  if (s.includes('remal')) return 'remalre.com';
  if (s.includes('amaall')) return 'amaall.com';
  // MUST be tested BEFORE any bare 'aqar' branch and before the AQAR default: the slug
  // 'aqaralsaudia' CONTAINS 'aqar', so without this line every one of this office's
  // listings is attributed to عقار — a different company — and the card links a user to
  // sa.aqar.fm instead of the office that actually published the ad. Owner flagged this
  // 2026-09-13 as a legal problem, not a cosmetic one.
  if (s.includes('aqaralsaudia')) return 'aqaralsaudia.com';
  if (s.includes('suwar')) return 'suwar.sa';
  if (s.includes('rakez')) return 'rakez.sa';
  if (s.includes('amlakalahsa')) return 'amlakalahsa.com';
  if (s.includes('alta')) return 'alta.com.sa';
  if (s.includes('awal')) return 'awaalun.com';
  if (s.includes('azdad')) return 'azdadalaqaria.com';
  // The DB source is Arabic («عقاريون», scrapers/akariyoun/run.py) — the slug alone never matched it.
  if (s.includes('akariyoun') || s.includes('عقاريون')) return 'akariyoun.sa';
  // DB source value is 'Al Khaas' (with a space, confirmed live, 0 exceptions) — 'alkhaas' alone never
  // matched it, so every Al Khaas listing silently fell through to the AQAR default (wrong name/host/
  // logo, found live 2026-07-25). Also match the no-space form in case that ever appears.
  if (s.includes('al khaas') || s.includes('alkhaas')) return 'alkhaas.net';
  if (s.includes('abeea')) return 'abeea.com.sa';
  if (s.includes('jurash')) return 'jurash.sa';
  if (s.includes('al nokhba') || s.includes('alnokhba')) return 'alnokhba-services.com';
  if (s.includes('gathern')) return 'gathern.co';
  if (s.includes('goldendeal') || s.includes('الصفقة الذهبية العقارية')) return 'goldendeal.sa'; // 2026-09-24: BEFORE 'deal', which 'goldendeal' contains
  if (s.includes('deal')) return 'dealapp.sa';
  if (s.includes('souq')) return '24.com.sa';
  if (s.includes('pulse')) return 'erapulse.sa';
  if (s.includes('nowaisiry')) return 'alnowaisiry.com';
  if (s.includes('october')) return '1october.com.sa';
  if (s.includes('therc')) return 'therc.sa';
  if (s.includes('aouj')) return 'aoujestates.com';
  if (s.includes('abralosol')) return 'abralosol.com';
  if (s.includes('arkaan')) return 'arkaanalaqar.com';
  if (s.includes('rawasidark')) return 'rawasi-dark.com';
  // Same ordering rule as SourceBadge: 'ksaaqar' contains 'aqar', and the fallback below is
  // عقار's own domain, so without these two the card would claim another company hosts them.
  if (s.includes('toor') || s.includes('توور')) return 'toor.ooo';
  if (s.includes('ksaaqar') || s.includes('ksa aqar') || s.includes('عقارات السعودية')) return 'ksaaqar.com';
  if (s.includes('sadiqeltajer') || s.includes('sadiq eltajer') || s.includes('sadiq-eltajer') || s.includes('صادق التاجر')) return 'sadiq-eltajer.sa';
  // onboarded 2026-09-21 — last, right above the fallback, for the same reason as in SourceBadge.
  if (s.includes('alsidra') || s.includes('al sidra') || s.includes('السدرة')) return 'alsidra.com.sa';
  if (s.includes('moftah') || s.includes('مفتاح العقار')) return 'moftah-aleaqar.com';
  if (s.includes('masar') || s.includes('مسار المستقبل')) return 'masaraqarat.com';
  if (s.includes('menassat') || s.includes('منصات')) return 'gomenassat.com';
  if (s.includes('sakani') || s.includes('سكني')) return 'sakani.sa'; // 2026-09-24: BEFORE 'sakan', which 'sakani' contains
  if (s.includes('sakan')) return 'sa.sakan.co';
  if (s.includes('bossbih') || s.includes('بوصبيح')) return 'bossbihoffice.com.sa';
  if (s.includes('alshawaf') || s.includes('al shawaf') || s.includes('الشواف')) return 'alshawaf.com.sa';
  if (s.includes('alqarawi') || s.includes('القرعاوي')) return 'ialqarawi.com';
  if (s.includes('aljassim') || s.includes('al jassim') || s.includes('الجاسم')) return 'aljassimaqar.com';
  if (s.includes('almotmkenah') || s.includes('المتمكنة')) return 'almotmkenah.com';
  // نفوذ للاستثمار العقاري (nofodh.sa) BEFORE نفوذ (nufouth.com): «نفوذ» is a SUBSTRING of the longer
  // name, and first match wins, so the shorter branch would steal every nofodh card and show it under
  // another company's brand and domain. Specific token first. Caught by
  // verify-platform-registration-complete, which is the barrier that exists for exactly this.
  if (s.includes('نفوذ للاستثمار العقاري') || s.includes('nofodh')) return 'nofodh.sa';
  if (s.includes('nufouth') || s.includes('نفوذ')) return 'nufouth.com';
  // onboarded 2026-09-24 (batch 36) — last, right above the fallback, for the same reason as in SourceBadge.
  if (s.includes('dwelleo') || s.includes('دويليو')) return 'dwelleo.sa';
  if (s.includes('shatri') || s.includes('الشاطري للتطوير العقاري')) return 'shatrirealestate.com';
  if (s.includes('alqasem') || s.includes('القاسم العقارية')) return 'alqasem.com.sa';
  if (s.includes('fkralemar') || s.includes('فكر الإعمار')) return 'fkralemar.com';
  if (s.includes('wadod') || s.includes('ودود العقارية')) return 'wadod.sa';
  if (s.includes('almuteb') || s.includes('آل متعب العقارية')) return 'almuteb.sa';
  if (s.includes('aalbarrak') || s.includes('البراك للعقارات')) return 'aalbarrak.com';
  if (s.includes('alrifai') || s.includes('الرفاعي للعقار')) return 'alrifai.com.sa';
  if (s.includes('sodasyat') || s.includes('سداسيات العقارية')) return 'sodasyat.sa';
  if (s.includes('hasaad') || s.includes('حصاد الاقتصادية للعقارات')) return 'hasaadestate.com';
  if (s.includes('aqaralriyadh') || s.includes('عقار الرياض')) return 'aqaralriyadh.com';
  if (s.includes('justsa') || s.includes('فقط نقطة العقارية')) return 'just.sa';
  if (s.includes('snam') || s.includes('سنام العقارية')) return 'snam.sa';
  if (s.includes('jawher') || s.includes('جواهر للوساطة والتسويق العقاري')) return 'jawher2030.com';
  if (s.includes('m3tmd') || s.includes('مقر المعتمد')) return 'm3tmd.com';
  if (s.includes('senan') || s.includes('سنان العقارية')) return 'senanrealestate.sa';
  if (s.includes('thousand') || s.includes('1000 العقارية')) return '1000.com.sa';
  if (s.includes('yameen') || s.includes('يمين العقارية')) return 'yameen.sa';
  if (s.includes('ebriza') || s.includes('إبريزة العقارية')) return 'ebriza.com.sa';
  if (s.includes('eilmalriyada') || s.includes('علم الريادة الإدارية')) return 'eilmalriyada.com';
  if (s.includes('daryusuf') || s.includes('دار يوسف العقارية')) return 'daryusuf.com';
  if (s.includes('albdah') || s.includes('البداح للعقارات')) return 'albdah.sa';
  if (s.includes('eydah') || s.includes('الإيضاح')) return 'eydah.com';
  if (s.includes('tamyaz') || s.includes('تمايز العقارية')) return 'tamyaz-sa.com';
  if (s.includes('hazim') || s.includes('حازم')) return 'hazim.sa';
  if (s.includes('villassa') || s.includes('فلل')) return 'villas-sa.com';
  if (s.includes('marksa') || s.includes('مار العقارية')) return 'mar-ksa.com';
  if (s.includes('rightcompound')) return 'rightcompound.com';
  if (s.includes('livingcompound')) return 'livingcompound.com';
  if (s.includes('azure')) return 'azure.sa';
  if (s.includes('expattrusted') || s.includes('expat trusted housing')) return 'expattrustedhousingriyadh.com';
  if (s.includes('flow')) return 'flow.life';
  if (s.includes('أبعاد') || s.includes('abaad')) return 'app.abaadapp.sa';
  if (s.includes('آي باكس') || s.includes('ibaax')) return 'ibaax.sa';
  if (s.includes('وحدات') || s.includes('wahadat')) return 'wahadat.sa';
  if (s.includes('المربعات') || s.includes('squares')) return 'squares.com.sa';
  if (s.includes('رواف') || s.includes('rawaf')) return 'rawaf.ai';
  if (s.includes('المسوق الافتراضي') || s.includes('vm-ksa') || s.includes('vmksa')) return 'vm-ksa.com';
  if (s.includes('مكسب العقارية') || s.includes('macsaib')) return 'macsaib.sa';
  if (s.includes('maqrat')) return 'maqrat.com';
  if (s.includes('عرش العقارية') || s.includes('arshglobal')) return 'arshglobal.com.sa';
  if (s.includes('سوبر أوفيس') || s.includes('superoffice') || s.includes('super office')) return 'superoffice.sa';
  if (s.includes('شموع العقار') || s.includes('shomou')) return 'shomoalaqar.com.sa';
  if (s.includes('منصة مكتب') || s.includes('maktab')) return 'maktab.sa';
  if (s.includes('سرداب') || s.includes('sirdab')) return 'marketplace.sirdab.co';
  if (s.includes('عشاب العقارية') || s.includes('ashab.sa')) return 'ashab.sa';
  if (s.includes('منافع العقارية') || s.includes('manafe')) return 'manafe.com.sa';
  if (s.includes('وجف العقارية') || s.includes('wajaf')) return 'wajaf.sa';
  if (s.includes('البكيري العقارية') || s.includes('albukaeri')) return 'albukaeri.sa';
  if (s.includes('ريادة العقارية') || s.includes('ryadah')) return 'ryadah.com.sa';
  if (s.includes('مجموعة صالح القرشي العقارية') || s.includes('sqcc')) return 'sqcc.sa';
  if (s.includes('دارا للتطوير العقاري') || s.includes('daraa')) return 'daraa.sa';
  if (s.includes('مكتب طوية للعقار') || s.includes('tawia')) return 'tawia.sa';
  if (s.includes('مانزو') || s.includes('manzo')) return 'manzo.com.sa';
  if (s.includes('الطابق الثامن') || s.includes('8floor') || s.includes('eightfloor')) return 'www.8floor.sa';
  if (s.includes('حلول') || s.includes('holoul')) return 'holoul.io';
  if (s.includes('السوق المفتوح') || s.includes('opensooq')) return 'sa.opensooq.com';
  if (s.includes('معرض نافذة') || s.includes('nafithh')) return 'nafithh.sa';
  if (s.includes('مباشر') || s.includes('mobasher')) return 'mobasher.sa';
  if (s.includes('مؤاجرة') || s.includes('muajarh')) return 'muajarh.com';
  if (s.includes('دلّالي') || s.includes('dallali')) return 'dallali.com';
  if (s.includes('شركة مقام للتطوير العقاري') || s.includes('maqamco') || s.includes('maqam development')) return 'property.maqamco.sa';
  if (s.includes('تطبيق أرض') || s.includes('earthapp')) return 'earthapp.com.sa';
  if (s.includes('نوافذ الوطن') || s.includes('nawafeth') || s.includes('nawafethalwatan')) return 'nawafethalwatan.com';
  if (s.includes('re/max') || s.includes('remaxsa')) return 'remax.sa';
  if (s.includes('قمرا') || s.includes('qmra')) return 'qmra.sa';
  if (s.includes('العجلان') || s.includes('alajlan')) return 'alajlan-re.com';
  if (s.includes('آل سعيدان') || s.includes('alsaedan')) return 'alsaedan.com';
  if (s.includes('إيجو عقار') || s.includes('ego')) return 'ego-aqar.com';
  if (s.includes('أحمد المحيسني العقارية') || s.includes('muhaysini')) return 'aqaralmuhaysini.com';
  if (s.includes('راز العقارية') || s.includes('razre')) return 'razre.sa';
  if (s.includes('ري إنفست') || s.includes('reinvest')) return 'reinvest.sa';
  if (s.includes('صفا للاستثمار') || s.includes('safa')) return 'safainv.sa';
  if (s.includes('صكوك العقارية') || s.includes('sokok')) return 'sokok.sa';
  if (s.includes('سكنة') || s.includes('sukna')) return 'sukna.app';
  if (s.includes('طوبة العقارية') || s.includes('tuba')) return 'tuba.com.sa';
  return 'sa.aqar.fm';
}

// EJARI × ريلز "Rent now, pay later" banner — uses the official EJARI×ريلز partnership graphic
// (assets/images/ejari-rnpl.png) the user supplied. Shown only when the listing is RNPL-eligible.
// If the scraped data carries a monthly figure, the "from SAR X/month" subline appears underneath.
// (user request: pixel-perfect official badge — replaced the code-drawn approximation.)
const EJARI_LOGO = require('../../assets/images/ejari-rnpl.png');
const AQSAT_LOGO = require('../../assets/images/aqsat.png');
function RnplBanner({ monthly, source, t }: { monthly?: number; source?: string; t: (k: string, p?: any) => string }) {
  // أقساط (Aqsat) variant for Al Hoshan — its own rent-now-pay-later brand (annual rent over 12
  // monthly installments). The official أقساط PNG already includes the "استأجر الحين.. وادفع بعدين"
  // tagline, so no separate CTA text is needed — just the logo + the monthly subline.
  if ((source || '').toLowerCase().includes('alhoshan')) {
    return (
      <View style={[card.rnplBanner, card.aqsatBanner]}>
        <Image source={AQSAT_LOGO} style={card.aqsatLogo} contentFit="contain" />
        {monthly ? (
          <Text style={card.rnplFromLine}>
            {t('Over 12 months')} · <Text style={card.rnplFromStrong}>{t('SAR')} {Number(monthly).toLocaleString('en-US')}</Text>/{t('month')}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={card.rnplBanner}>
      <View style={card.rnplRow}>
        <Image source={EJARI_LOGO} style={card.ejariLogo} contentFit="contain" />
        <View style={card.rnplChevs}>
          <Ionicons name="chevron-forward" size={13} color={colors.rnplInk} style={{ marginRight: -6 }} />
          <Ionicons name="chevron-forward" size={13} color={colors.rnplInk} />
        </View>
        <Text style={card.rnplCta}>{t('Rent now, pay later')}</Text>
      </View>
      {monthly ? (
        <Text style={card.rnplFromLine}>
          {t('from')} <Text style={card.rnplFromStrong}>{t('SAR')} {Number(monthly).toLocaleString('en-US')}</Text>/{t('month')}
        </Text>
      ) : null}
    </View>
  );
}

// One stat chip — used in the middle column's stats row.
function Stat({ icon, big, small, picked }: { icon: any; big: string; small: string; picked?: boolean }) {
  return (
    <View style={[card.statChip, picked && card.statChipPicked]} testID={picked ? 'card-stat-picked' : undefined}>
      <Ionicons name={picked ? 'checkmark-circle' : icon} size={14} color={colors.primary} />
      <View style={card.statWords}>
        <Text style={card.statBig} numberOfLines={1}>{big}</Text>
        <Text style={card.statSmall} numberOfLines={1}>{small}</Text>
      </View>
    </View>
  );
}

// Approved photo-first layout; content height follows the actual listing details.
const card = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.fieldLine,
    overflow: 'hidden',
    alignItems: 'stretch',
  },
  // Full-width photo with compact, naturally wrapping details underneath.
  body: { minWidth: 0 },
  photoCol: { position: 'relative', backgroundColor: colors.tint, overflow: 'hidden' },
  photoColWide: { width: '100%', height: 235 },
  photoColMobile: { width: '100%', height: 185 },
  // Laptop row: a small rounded photo on the inline-start side that grows only as tall as the
  // details beside it; 'tight' is the narrower column beside the ad pane.
  wrapRow: { flexDirection: 'row' },
  bodyRow: { flex: 1, minWidth: 0 },
  photoColRow: { width: 168, minHeight: 118, margin: 8, borderRadius: 8, alignSelf: 'stretch' },
  photoColTight: { width: 124, minHeight: 100, margin: 6 },
  rankBadgeRow: { top: 5, left: 5, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  rankTextRow: { fontSize: 10 },
  sourceStripRow: { paddingVertical: 4, paddingHorizontal: 7, columnGap: 6, rowGap: 0 },
  photoActionRow: { fontSize: 10.5 },
  sourceTextRow: { fontSize: 9, flexShrink: 1 },
  midColRow: { paddingStart: 4, paddingEnd: 12, paddingTop: 7, paddingBottom: 0, gap: 2 },
  rightColRow: { paddingStart: 4, paddingEnd: 12, paddingTop: 3, paddingBottom: 8, gap: 1 },
  titleTight: { fontSize: 14 },
  priceRow: { fontSize: 17 },
  priceTight: { fontSize: 15.5 },
  stayNoteRow: { fontSize: 12 },
  // One truncated line of amenities / additional information ('tight'); unfolds to wrap on tap.
  oneLine: { fontSize: 11.5, lineHeight: 18, color: colors.ink },
  oneLineRtl: { writingDirection: 'rtl', textAlign: 'right' },
  oneLineLtr: { writingDirection: 'ltr', textAlign: 'left' },
  photo: { width: '100%', height: '100%' },
  photoFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface2 },
  photoFallbackText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  rankBadge: {
    position: 'absolute', top: 8, left: 8, backgroundColor: colors.selFill,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  rankText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  platformBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: colors.surface,
    borderRadius: 14, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  platformText: { color: colors.primary, fontSize: 10.5, fontWeight: '700' },
  sourceStrip: {
    position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 9, paddingHorizontal: 10,
    backgroundColor: 'rgba(22,52,35,0.93)', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 5,
  },
  sourceText: { color: '#fff', fontSize: 10, fontWeight: '500', writingDirection: 'ltr' },
  photoAction: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // MIDDLE: property info
  midCol: { minWidth: 0, paddingHorizontal: 10, paddingTop: 5, paddingBottom: 2, gap: 3 },
  sourceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8 },
  headline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 8, rowGap: 2 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  typeLabel: { fontSize: 10.5, color: colors.muted, fontWeight: '500', flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.3, flexShrink: 1 },
  // Owner 2026-10-01: omit the bio from compact cards; details remain on the source page.
  desc: { display: 'none' },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  locText: { fontSize: 11, color: colors.primary, fontWeight: '500' },
  // Small region pill (e.g. "North Riyadh") next to the city line — light green, compact.
  regionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.tint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 2,
  },
  regionChipText: { fontSize: 10.5, color: colors.primary, fontWeight: '700' },
  // «مطابق لطلبك» evidence strip — the regionChip idiom (tint background, primary bold text), one
  // checkmark per proven predicate, wrapping under the stats row on both layouts.
  afRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  afLabel: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  afChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.tint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
  },
  afChipText: { fontSize: 10.5, color: colors.primary, fontWeight: '700' },
  price: { fontSize: 20, fontWeight: '800', color: colors.primary, maxWidth: '100%', flexShrink: 0 },
  // Gathern / Aqar Monthly price line is a sentence, not a figure: same colour, sized as a prompt to tap.
  stayNote: { fontSize: 13, fontWeight: '700', color: colors.primary, maxWidth: '100%', flexShrink: 1 },
  // Guest-rating chip (Gathern) — star + score, with a muted review-count suffix. Sits just under
  // the price; only rendered when the listing actually carries a rating. (Gathern Tier-1.)
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  ratingText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  ratingCount: { fontSize: 11, fontWeight: '500', color: colors.muted },

  // Source-published «سعر المتر» subline, rendered directly under the price line on listings that
  // have no total price. Deliberately quieter than `price` (muted, smaller) so it reads as
  // supporting information the source happened to publish, never as the listing's headline price.
  derivedTotalNote: { fontSize: 10.5, color: colors.muted, marginTop: 2, textAlign: 'right' },
  derivedTotalEquation: { fontSize: 12, color: colors.muted, marginTop: 2, textAlign: 'right', fontWeight: '600' },
  pricePerMeter: { fontSize: 11.5, color: colors.muted, fontWeight: '500', marginTop: 2 },
  pricePerMeterStrong: { fontWeight: '700', color: colors.ink },

  // EJARI × ريلز "Rent now, pay later" branded banner — light EJARI blue background, two-line
  // layout (brand row on top, "from SAR X/mo" subline below). Premium feel — rounded corners,
  // subtle border, generous padding. Self-aligned so it hugs content instead of stretching full
  // width. (user-visible RNPL CTA — must read as an official partnership badge.)
  rnplBanner: {
    backgroundColor: colors.rnplBg, borderRadius: 10, borderWidth: 1, borderColor: colors.rnplLine,
    paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 4, gap: 4,
  },
  rnplRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The official EJARI×ريلز PNG is wider than tall — fixed height + contain keeps the aspect
  // ratio and lets the parent banner's padding control the surround.
  ejariLogo: { width: 90, height: 28 },
  rnplChevs: { flexDirection: 'row', alignItems: 'center' },
  rnplCta: { fontSize: 11.5, fontWeight: '700', color: colors.rnplInk },
  // أقساط (Aqsat) variant — Al Hoshan's own RNPL brand; deeper indigo than EJARI's blue.
  // The official PNG is the wordmark + tagline stacked, so it's a bit taller than the EJARI strip.
  aqsatBanner: { backgroundColor: colors.aqsatBg, borderColor: colors.aqsatLine },
  aqsatLogo: { width: 104, height: 40 },
  rnplFromLine: { fontSize: 10.5, color: colors.muted, fontWeight: '500' },
  rnplFromStrong: { color: colors.ink, fontWeight: '700' },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 4, marginTop: 2 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  statChipPicked: { backgroundColor: colors.tint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  statWords: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 3, flexShrink: 1 },
  statBig: { fontSize: 12.5, fontWeight: '700', color: colors.ink, lineHeight: 15 },
  statSmall: { fontSize: 10, color: colors.muted, lineHeight: 12 },

  // Full-width amenities and compact source footer.
  rightCol: { paddingHorizontal: 10, paddingBottom: 9, paddingTop: 4, gap: 3 },
  hostHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  hostBadge: { width: 96, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  thercBadge: { borderRadius: 8, backgroundColor: '#1f5f8b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  aoujBadge: { borderRadius: 8, backgroundColor: '#8b5a1f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  abralosolBadge: { borderRadius: 8, backgroundColor: '#3f6b4a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  arkaanBadge: { borderRadius: 8, backgroundColor: '#6b3a5f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  rawasidarkBadge: { borderRadius: 8, backgroundColor: '#2f5f6b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  aldarimBadge: { borderRadius: 8, backgroundColor: '#14506b', alignItems: 'center', justifyContent: 'center' },
  aqargateBadge: { borderRadius: 8, backgroundColor: '#0d6e63', alignItems: 'center', justifyContent: 'center' },
  hajerBadge: { borderRadius: 8, backgroundColor: '#6b4a2f', alignItems: 'center', justifyContent: 'center' },
  sanadakBadge: { borderRadius: 8, backgroundColor: '#1f7a5a', alignItems: 'center', justifyContent: 'center' },
  toorBadge:   { borderRadius: 8, backgroundColor: '#2a4d6e', alignItems: 'center', justifyContent: 'center' },
  mustqrBadge: { borderRadius: 8, backgroundColor: '#7c3a3a', alignItems: 'center', justifyContent: 'center' },
  ramzBadge:   { borderRadius: 8, backgroundColor: '#3d5a2b', alignItems: 'center', justifyContent: 'center' },
  fursaBadge:  { borderRadius: 8, backgroundColor: '#8a6a1f', alignItems: 'center', justifyContent: 'center' },
  jazwtnBadge: { borderRadius: 8, backgroundColor: '#1f6b5a', alignItems: 'center', justifyContent: 'center' },
  mizlajBadge: { borderRadius: 8, backgroundColor: '#6b2f4a', alignItems: 'center', justifyContent: 'center' },
  muktamelBadge: { borderRadius: 8, backgroundColor: '#2f5d7a', alignItems: 'center', justifyContent: 'center' },
  aqaratikomBadge: { borderRadius: 8, backgroundColor: '#1f6b6b', alignItems: 'center', justifyContent: 'center' },
  awalBadge: { borderRadius: 8, backgroundColor: '#5a3a7a', alignItems: 'center', justifyContent: 'center' },
  alkhaasBadge: { borderRadius: 8, backgroundColor: '#3a5a2f', alignItems: 'center', justifyContent: 'center' },
  abeeaBadge: { borderRadius: 8, backgroundColor: '#7a4a1f', alignItems: 'center', justifyContent: 'center' },
  jurashBadge: { borderRadius: 8, backgroundColor: '#2f5a5a', alignItems: 'center', justifyContent: 'center' },
  alnokhbaBadge: { borderRadius: 8, backgroundColor: '#5a2f3a', alignItems: 'center', justifyContent: 'center' },
  gathernBadge:  { borderRadius: 8, backgroundColor: '#e87820', alignItems: 'center', justifyContent: 'center' },
  dealappBadge:  { borderRadius: 8, backgroundColor: '#1d4a37', alignItems: 'center', justifyContent: 'center' },
  souq24Badge:   { borderRadius: 8, backgroundColor: '#2f5d7a', alignItems: 'center', justifyContent: 'center' },
  erapulseBadge: { borderRadius: 8, backgroundColor: '#7a4a1f', alignItems: 'center', justifyContent: 'center' },
  nowaisiryBadge:{ borderRadius: 8, backgroundColor: '#3a5a2f', alignItems: 'center', justifyContent: 'center' },
  octoberBadge:  { borderRadius: 8, backgroundColor: '#6b3a2f', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 11, lineHeight: 13, textAlign: 'center' },
  hostedOn: { fontSize: 10.5, fontWeight: '500', color: colors.ink, flexShrink: 1 },
  hostHint: { fontSize: 10, color: colors.muted, lineHeight: 13 },
  featGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },
  featCell: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, maxWidth: '100%' },
  featText: { fontSize: 11.5, color: colors.ink, fontWeight: '500', flexShrink: 1 },
  // An Advanced-Filter pick, lit in place: the «مطابق لطلبك» chip's tint, primary bold text, ✓ icon.
  featCellPicked: { backgroundColor: colors.tint, borderRadius: 6, paddingHorizontal: 6 },
  featTextPicked: { color: colors.primary, fontWeight: '700' },
  noFeat: { fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.fieldLine,
  },
  moreText: { fontSize: 11.5, fontWeight: '600', color: colors.primary },
  // Wasalt "Additional Information" panel — sits BELOW the features grid, with a soft separator
  // line so it reads as its own section. Each label/value pair wraps as one group.
  addlPanel: {
    marginTop: 0, paddingTop: 3,
  },
  addlTitle: { fontSize: 11.5, fontWeight: '700', color: colors.ink, marginBottom: 3 },
  addlGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 2 },
  addlCell: {
    maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', paddingVertical: 2, columnGap: 5, rowGap: 1,
  },
  // Keep explicit direction on source labels and values: bare numeric values must remain
  // aligned with their own Arabic label when the inline groups wrap.
  addlLabel: { fontSize: 10.5, color: colors.muted, fontWeight: '500', writingDirection: 'rtl' },
  addlValue: { flexShrink: 1, fontSize: 11, color: colors.ink, fontWeight: '600', writingDirection: 'rtl' },
  addlMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, marginTop: 4,
  },
  addlMoreText: { fontSize: 11.5, fontWeight: '600', color: colors.primary },
});
