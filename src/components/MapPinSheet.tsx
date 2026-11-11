// THE CARD SHEET UNDER A TAPPED PIN (owner 2026-11-02, Zillow-style: «when user clicks it shows … property card … I
// scroll down I see the others»). A tapped pin hands its row up; this sheet slides over the bottom of the map and
// shows the listing's own Ezhalah card — the same ResultCard the search shows — and, for a gold pin (several
// listings on the exact same coordinates), every one of them as its own card, scrollable, each with its own site
// and link. Nothing is dropped. The cards come through fetchListingCards(), the same finalize() path the search and
// the ad page use, table by table.
// THE SAME PROPERTY IS ONE CARD (owner 2026-11-10, the final pin rule): ads PROVEN to be one property (same licence,
// the same site's exact repost, or a whole property of the same type and size at this pin — foldSameProperty) show as
// together, the cheapest first, and every other site's ad right under it as its OWN FULL CARD (owner 2026-11-10: «show
// all options» — a small link button for the other site was not enough).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ResultCard } from '@/components/ResultCard';
import { fetchListingCards } from '@/data/remote';
import { openListing } from '@/lib/openListing';
import { useI18n, englishCatalogText } from '@/i18n';
import { colors } from '@/theme/tokens';
import type { Listing } from '@/data/listings';
import { foldSameProperty, idsByTable, orderLike, pinHead, sameKindSummary, type FoldFacts, type PinRow } from '@/lib/mapPins';
import { listingPrice } from '@/lib/listingDisplay';
import { translitPlace } from '@/lib/translitPlace';

// What the fold may compare: the index's own facts. No facts (the index read failed) → no site → never grouped.
const factsOf = (l: Listing): FoldFacts => ({ site: l.fold ? l.source : '', lic: l.fold?.lic, dealAr: l.fold?.dealAr, typeAr: l.fold?.typeAr, area: l.fold?.area, price: l.fold?.price, beds: typeof l.beds === 'number' ? l.beds : null, floor: l.fold?.floor });

export default function MapPinSheet({ row, onClose }: { row: PinRow; onClose: () => void }) {
  const { t, isRTL, locale } = useI18n();
  const [cards, setCards] = useState<Listing[] | null>(null);   // null = loading
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(row.ids ?? []);
  useEffect(() => {
    let gone = false;
    setCards(null); setFailed(false);
    const groups = idsByTable(row);
    Promise.all([...groups].map(([table, ids]) => fetchListingCards(table, ids)))
      .then((lists) => {
        if (gone) return;
        const all = orderLike(row, lists.flat());
        // A FAILED FETCH IS NOT AN EMPTY ANSWER: ids were given and nothing came back → say it failed, not «none».
        if (!all.length && (row.ids?.length ?? 0) > 0) setFailed(true);
        setCards(all);
      })
      .catch(() => { if (!gone) { setFailed(true); setCards([]); } });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The head's own words show at once — the price («650 ألف») or the count — while the cards load (owner 2026-11-02:
  // «why does it load like this»): never a blank sheet with only a spinner.
  // A DISTRICT MARKER (src/lib/mapNoPin.ts, owner 2026-11-09): titled by its district, never by a price — these listings
  // have no exact location, and the note says so before the first card.
  // In English the place name is written in English letters too («88 listings in An Narjis»), like the cards do.
  const place = row.noPin ? (row.noPin.district || row.noPin.city) : '';
  // A BUILDING SAYS WHAT IT HOLDS (owner 2026-11-10: «12 شقة للإيجار من 40,000»): once every ad of the pin is loaded
  // and they are all one type and one deal. Until then, and for a mixed pin, the plain count stays.
  const kind = !row.noPin && cards ? sameKindSummary(row.n, cards.map((l) => ({ ...factsOf(l), showsPrice: listingPrice(l, locale) !== '' }))) : null;
  // THE TITLE CARRIES NO COUNT, ONLY THE PRICE (owner 2026-11-10: «It says 8 but there is 3» → «we don't say 2 instead
  // we just put the price»): the same price rule as the pin head (pinHead/priceHead in src/lib/mapPins.ts), after the
  // type and deal when every ad is one kind («فيلا للبيع · من 750 ألف»).
  const groups = cards ? foldSameProperty(cards, factsOf) : [];
  const head = pinHead(row, isRTL ? 'ar' : 'en');
  const title = row.noPin
    ? t('{n} listings in {district}', { n: row.n, district: isRTL ? place : translitPlace(place) })
    : row.n > 1
      ? (kind ? `${locale === 'en' ? englishCatalogText(kind.typeAr) : kind.typeAr} ${t(kind.dealAr === 'بيع' ? 'for sale' : 'for rent')} · ${head}` : head)
      : `${t('Listing')} · ${head}`;
  const shown = row.ids?.length ?? 0;
  return (
    <View style={s.sheet} testID="map-pin-sheet">
      <View style={[s.head, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Text style={s.title}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Close')} testID="map-pin-sheet-close" style={s.close}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>
      {row.noPin ? (
        <View style={s.noPinNote} testID="map-pin-sheet-no-pin-note">
          <Ionicons name="location-outline" size={15} color={colors.muted} />
          <Text style={s.noPinText}>
            {t('The source site gives no exact location for these listings; they are shown at the centre of the district.')}
            {row.n > shown && shown > 0 ? ` ${t('Showing the first {k} of {n}', { k: shown, n: row.n })}` : ''}
          </Text>
        </View>
      ) : null}
      {cards === null ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : failed && !cards.length ? (
        <View style={s.center}><Text style={s.note}>{t('Could not load this listing. Try again.')}</Text></View>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listInner} showsVerticalScrollIndicator>
          {/* EVERY AD IS A FULL CARD (owner 2026-11-10: «show both … don't show like a button … show all options»). The ads
              proven to be one property sit together: its cheapest first, then each other site's own full card. */}
          {groups.map(({ main, others }) => (
            <View key={`${main.sourceTable}#${main.id}`} style={s.card}>
              <ResultCard listing={main} onOpen={() => { void openListing(main); }} row="tight" />
              {others.length ? <Text style={s.alsoLabel} testID="map-pin-sheet-also-on">{t('Same property on other sites:')}</Text> : null}
              {others.map((o) => (
                <ResultCard key={`${o.sourceTable}#${o.id}`} listing={o} onOpen={() => { void openListing(o); }} row="tight" />
              ))}
            </View>
          ))}
          {failed && cards.length < (row.ids?.length ?? 0) ? <Text style={s.note}>{t('Some listings could not be loaded.')}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 8, maxHeight: '80%', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.tintLine, overflow: 'hidden', zIndex: 20 },
  head: { alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.tintLine },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 0 },
  listInner: { padding: 10, gap: 10 },
  card: { gap: 8 },
  alsoLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', paddingHorizontal: 6 },
  center: { padding: 24, alignItems: 'center' },
  note: { color: colors.muted, fontSize: 13, textAlign: 'center', padding: 8 },
  noPinNote: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.tintLine },
  noPinText: { flex: 1, color: colors.muted, fontSize: 12.5, lineHeight: 17 },
});
