// THE MAP CARD FOR A RESIDENTIAL SALE (owner 2026-11-14 — the picture agreed in chat; docs/ARCHITECTURE.md «THE MAP BOX
// AND ITS CARD»). What each line SAYS is decided in src/lib/mapCard.ts (executed by scripts/verify-map-card.ts); this
// file only lays it out: the title is the user's choice read out, the site logos, ONE disclaimer sentence, the price
// sentence, three numbers, the comparison with nearby districts under the SAME filters, the price by rooms, the weekly
// graph (only once the complete record has 3 finished weeks), a clear «عرض تفاصيل أكثر» button, and the falconer.
// Arabic reads from the right: rows use plain 'row' (the page is already right-to-left) and the graph runs right to left.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as XImage } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { DISCLAIMER, saleDetails, saleDiffs, saleNumbers, saleRooms, saleSentence, saleSites, saleSubtitle, saleTitle, saleWeeks,
  nearbyPrices, typeLabel, type ChipFilter, type MapCard, type WeekPoint } from '@/lib/mapCard';
import { PLATFORM_META, normalizeSource } from '@/data/loaderPlatforms';
import { PlatformLogo } from '@/components/platform-logo';
import { translitPlace } from '@/lib/translitPlace';
import { useI18n } from '@/i18n';
import { HOW_IT_WORKS } from '@/lib/insightHowItWorks';

const FALCONER = require('../../assets/images/falconer-final.svg');
const INK = '#1c1b1f', MUTED = '#6e6a75', LINE = '#ecebee', SOFT = '#f6f5f3', GREEN = '#2f7247';

const metaFor = (slug: string) => {
  const name = normalizeSource(slug);
  return name ? PLATFORM_META.find((m) => m.name === name) ?? null : null;
};

/** A site logo in a small tile (the shared 96×48 logo frame, drawn at half size). */
function Logo({ slug }: { slug: string }) {
  const meta = metaFor(slug);
  if (!meta) return null;
  return (
    <View style={s.logoTile}>
      <View style={s.logoScale}><PlatformLogo source={meta.logo} /></View>
    </View>
  );
}

function WeekGraph({ weeks, loc }: { weeks: WeekPoint[]; loc: 'ar' | 'en' }) {
  const W = 300, H = 60;
  const pts = weeks.map((w) => w.ppm as number);
  const mn = Math.min(...pts), mx = Math.max(...pts), pad = Math.max(50, (mx - mn) * 0.25);
  const rtl = loc === 'ar';
  const xy = pts.map((v, i) => { const x = 20 + i * ((W - 40) / Math.max(1, pts.length - 1)); return [rtl ? W - x : x, H - ((v - (mn - pad)) / ((mx + pad) - (mn - pad))) * H] as const; });
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const labels = rtl ? weeks : weeks;
  return (
    <View testID="map-card-weeks">
      <Svg width="100%" height={70} viewBox={`-5 -8 ${W + 10} ${H + 16}`}>
        <Path d={`${d} L ${xy[xy.length - 1][0]} ${H} L ${xy[0][0]} ${H} Z`} fill={GREEN} opacity={0.08} />
        <Path d={d} fill="none" stroke={GREEN} strokeWidth={2.2} strokeLinejoin="round" />
        {xy.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={i === xy.length - 1 ? 4.5 : 3} fill={i === xy.length - 1 ? GREEN : '#fff'} stroke={GREEN} strokeWidth={2} />)}
      </Svg>
      <View style={[s.weekRow, { flexDirection: 'row' }]}>
        {labels.map((w, i) => (
          <View key={w.start} style={s.weekCell}>
            <Text style={s.weekV}>{(w.ppm as number).toLocaleString('en-US')}</Text>
            <Text style={s.weekL}>{loc === 'ar' ? `الأسبوع ${i + 1}` : `Week ${i + 1}`}</Text>
          </View>
        ))}
      </View>
      <Text style={s.small}>{loc === 'ar' ? 'للإعلانات الجديدة كل أسبوع، بنفس الفلاتر التي اخترتها' : 'New ads each week, with the same filters you picked'}</Text>
    </View>
  );
}

type Props = {
  card: MapCard; filter: ChipFilter | null; place: string; loc: 'ar' | 'en'; priceType: string | null;
  onPickType: (t: string) => void; onHow: () => void;
};

export default function MapSaleCard({ card, filter, place, loc, priceType, onPickType, onHow }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const ar = loc === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const typePicked = !!(filter?.types?.length || filter?.scope?.types2?.length);
  const bedsPicked = !!filter?.beds?.length;
  const filtered = typePicked || bedsPicked || filter?.areaMin != null || filter?.areaMax != null || filter?.priceMin != null
    || filter?.priceMax != null || filter?.furnished != null || filter?.postedWithinDays != null || !!filter?.poly;
  const type = priceType ?? card.priceType;
  const tr = (x: string) => (ar ? x : translitPlace(x));
  const sites = saleSites(card, loc);
  const siteNames = sites.shown.map((slug) => { const m = metaFor(slug); return m ? t(m.i18nKey) : null; }).filter((x): x is string => !!x);
  const sentence = saleSentence(card, filtered, loc);
  const diffs = saleDiffs(card, bedsPicked, loc);
  const rooms = saleRooms(card, bedsPicked, loc);
  const weeks = filter?.postedWithinDays != null ? null : saleWeeks(card);
  const details = saleDetails(card, loc);
  const near = nearbyPrices(card, loc).map((d) => ({ name: ar ? `حي ${d.name}` : translitPlace(d.name), text: d.text }));
  // type buttons only when the user did not pick the type and the place has more than one type to show
  const tabs = !typePicked && card.priceTypes.length > 1 ? card.priceTypes : [];
  return (
    <View testID="map-card-sale">
      <Text style={[s.title, { writingDirection: dir }]}>{saleTitle(type, filter, loc)}</Text>
      <Text style={[s.sub, { writingDirection: dir }]}>{saleSubtitle(card, place, loc, tr)}</Text>
      {sites.shown.length ? (
        <View style={[s.logos, { flexDirection: 'row' }]} testID="map-card-logos">
          {sites.shown.map((slug) => <Logo key={slug} slug={slug} />)}
        </View>
      ) : null}
      {siteNames.length ? <Text style={[s.small, { writingDirection: dir }]}>{`${ar ? 'المصادر: ' : 'Sources: '}${siteNames.join(ar ? '، ' : ', ')}${sites.more ? ` ${sites.more}` : ''}`}</Text> : null}
      <Text style={[s.disclaimer, { writingDirection: dir }]} testID="map-card-disclaimer">{DISCLAIMER[loc]}</Text>
      {tabs.length ? (
        <View style={[s.tabs, { flexDirection: 'row' }]}>
          {tabs.map((x) => (
            <Pressable key={x} onPress={() => onPickType(x)} accessibilityRole="button" style={[s.tab, x === type && s.tabOn]}>
              <Text style={[s.tabT, x === type && s.tabTOn]}>{ar ? `${typeLabel(x, 'ar').replace(/^ال/, '')} للبيع` : `${typeLabel(x, 'en')} for sale`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {sentence ? <Text style={[s.sentence, { writingDirection: dir }]}>{sentence}</Text> : null}
      <View style={[s.nums, { flexDirection: 'row' }]} testID="map-card-numbers">
        {saleNumbers(card, loc).map((n, i) => (
          <View key={n.label} style={[s.num, i > 0 && s.numSep]}>
            <Text style={s.numV}>{n.value}</Text>
            <Text style={s.numL}>{n.label}</Text>
          </View>
        ))}
      </View>
      {diffs.length ? (
        <View style={s.box} testID="map-card-compare">
          <Text style={[s.boxT, { writingDirection: dir }]}>{ar ? 'مقارنة بالأحياء القريبة (بنفس الفلاتر)' : 'Compared with nearby districts (same filters)'}</Text>
          {diffs.map((d) => (
            <View key={d} style={[s.bullet, { flexDirection: 'row' }]}>
              <Text style={s.dot}>•</Text>
              <Text style={[s.bulletT, { writingDirection: dir }]}>{d}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {rooms.length ? (
        <View testID="map-card-rooms">
          <Text style={[s.h, { writingDirection: dir }]}>{ar ? 'السعر المعروض حسب عدد الغرف' : 'Displayed price by number of rooms'}</Text>
          {rooms.map((r, i) => (
            <View key={r.label} style={[s.row, { flexDirection: 'row' }, i < rooms.length - 1 && s.rowLine]}>
              <Text style={s.rowK}>{r.label}</Text><Text style={s.rowV}>{r.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {weeks ? (
        <View>
          <Text style={[s.h, { writingDirection: dir }]}>{ar ? 'سعر المتر المعروض، كل أسبوع' : 'Displayed price / m², by week'}</Text>
          <WeekGraph weeks={weeks} loc={loc} />
        </View>
      ) : null}
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={[s.more, { flexDirection: 'row' }]} testID="map-card-more">
        <Text style={s.moreT}>{open ? (ar ? 'إخفاء التفاصيل' : 'Hide details') : (ar ? 'عرض تفاصيل أكثر' : 'Show more details')}</Text>
        <Text style={s.moreT}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open ? (
        <View testID="map-card-details">
          {details.map((r) => (
            <View key={r.label} style={[s.row, { flexDirection: 'row' }]}>
              <Text style={s.rowKMuted}>{r.label}</Text><Text style={s.rowV}>{r.value}</Text>
            </View>
          ))}
          {near.length ? (
            <View>
              <Text style={[s.h, { writingDirection: dir }]}>{ar ? 'الأحياء القريبة · بنفس الفلاتر · سعر المتر المعروض' : 'Nearby districts · same filters · displayed price / m²'}</Text>
              {near.map((d, i) => (
                <View key={d.name} style={[s.row, { flexDirection: 'row' }, i < near.length - 1 && s.rowLine]}>
                  <Text style={s.rowK}>{d.name}</Text><Text style={s.rowV}>{d.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <Pressable onPress={onHow} accessibilityRole="button" accessibilityLabel={HOW_IT_WORKS[loc].title} style={[s.how, { flexDirection: 'row' }]} testID="map-card-how">
        <XImage source={FALCONER} contentFit="contain" accessible={false} style={s.howIcon} />
        <Text style={s.howT}>{HOW_IT_WORKS[loc].title}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: INK, paddingRight: 36, textAlign: 'auto' },
  sub: { fontSize: 12.5, color: MUTED, marginTop: 3 },
  logos: { gap: 5, marginTop: 8, flexWrap: 'wrap' },
  logoTile: { width: 48, height: 24, borderWidth: 1, borderColor: LINE, borderRadius: 7, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  logoScale: { width: 96, height: 48, transform: [{ scale: 0.5 }] },
  small: { fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 16 },
  disclaimer: { marginTop: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#faf6ec', borderWidth: 1, borderColor: '#eee2c4', fontSize: 11.5, lineHeight: 17, color: '#6b5a2e' },
  tabs: { gap: 6, marginTop: 10, flexWrap: 'wrap' },
  tab: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: LINE },
  tabOn: { backgroundColor: INK, borderColor: INK },
  tabT: { fontSize: 13, color: INK },
  tabTOn: { color: '#fff' },
  sentence: { fontSize: 15, lineHeight: 23, color: '#2c2a30', marginTop: 12 },
  nums: { borderWidth: 1, borderColor: LINE, borderRadius: 14, marginTop: 12 },
  num: { flex: 1, paddingVertical: 11, paddingHorizontal: 4, alignItems: 'center' },
  numSep: { borderStartWidth: 1, borderStartColor: LINE },
  numV: { fontSize: 18, fontWeight: '700', color: INK },
  numL: { fontSize: 11.5, color: MUTED, marginTop: 2, textAlign: 'center' },
  box: { marginTop: 12, padding: 11, backgroundColor: SOFT, borderRadius: 12 },
  boxT: { fontSize: 13.5, color: INK, fontWeight: '600' },
  bullet: { gap: 8, marginTop: 5 },
  dot: { color: MUTED, fontSize: 13 },
  bulletT: { flex: 1, fontSize: 13, color: '#3b3940', lineHeight: 19 },
  h: { fontSize: 12.5, fontWeight: '600', color: MUTED, marginTop: 16, marginBottom: 4 },
  row: { justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: LINE },
  rowK: { fontSize: 14, color: INK },
  rowKMuted: { fontSize: 14, color: MUTED },
  rowV: { fontSize: 14, color: INK, fontWeight: '600' },
  weekRow: { justifyContent: 'space-between', paddingHorizontal: 4 },
  weekCell: { alignItems: 'center', minWidth: 50 },
  weekV: { fontSize: 11.5, fontWeight: '600', color: INK },
  weekL: { fontSize: 11, color: MUTED },
  more: { marginTop: 16, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1.5, borderColor: INK, borderRadius: 12, justifyContent: 'center', alignItems: 'center', gap: 8 },
  moreT: { fontSize: 14.5, fontWeight: '700', color: INK },
  how: { alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  howIcon: { width: 30, height: 32 },
  howT: { fontSize: 13.5, color: INK, textDecorationLine: 'underline' },
});
