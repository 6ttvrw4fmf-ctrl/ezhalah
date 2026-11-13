// THE MAP CARD (owner 2026-11-12/13 — docs/ARCHITECTURE.md «THE MAP BOX AND ITS CARD»): what a signed-in user sees when
// they tap the box. One card that fits one phone screen: the table, each nearby district's price, «نظرة سريعة», the note.
// Loaded only when first tapped (AppleMap imports it on demand), so it never adds to the first download.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchMapCard, type CardTarget } from '@/data/mapCard';
import { cardRow, quickLook, nearbyPrices, COLUMNS, CARD_NOTE, typeLabel, type MapCard, type Tone } from '@/lib/mapCard';

// «للشقق» (ل + الشقق), never «لـالشقق»
const forType = (label: string) => (label.startsWith('ال') ? `لل${label.slice(2)}` : `لـ${label}`);

type Props = { target: CardTarget; title: string; signedIn: boolean; loc: 'ar' | 'en'; onClose: () => void; onSignIn: () => void };

export default function MapFactsCard({ target, title, signedIn, loc, onClose, onSignIn }: Props) {
  const [card, setCard] = useState<MapCard | 'locked' | null | undefined>(undefined);
  useEffect(() => {
    let stale = false;
    setCard(undefined);
    void fetchMapCard(target, signedIn).then((c) => { if (!stale) setCard(c); });
    return () => { stale = true; };
  }, [target, signedIn]);
  const ar = loc === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const toneStyle = (t: Tone) => (t === 'up' ? s.up : t === 'down' ? s.down : null);
  return (
    <View style={s.wrap} testID="map-card">
      {/* plain 'row' everywhere: the page is already right-to-left in Arabic (see PostedWindowMenu) */}
      <View style={s.head}>
        <Text style={[s.title, { writingDirection: dir }]} numberOfLines={1}>{title}</Text>
      </View>
      {/* ✕ always top-right (owner rule), placed physically like the map's own close button */}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={ar ? 'إغلاق' : 'Close'} style={s.close} testID="map-card-close">
          <Text style={s.closeT}>✕</Text>
        </Pressable>
      {card === undefined ? <Text style={[s.muted, s.center]}>{ar ? 'جار التحميل…' : 'Loading…'}</Text> : null}
      {card === null ? <Text style={[s.muted, s.center]}>{ar ? 'تعذر تحميل الأرقام، حاول مرة أخرى' : 'The numbers could not load. Try again.'}</Text> : null}
      {card === 'locked' ? (
        <Pressable onPress={onSignIn} accessibilityRole="button"><Text style={[s.ask, s.center]}>{ar ? '🔒 سجل الدخول لعرض الأرقام' : '🔒 Sign in to see the numbers'}</Text></Pressable>
      ) : null}
      {card && card !== 'locked' ? (
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 6 }}>
          <Text style={[s.sub, { writingDirection: dir }]}>
            {ar ? `${card.any.toLocaleString('en-US')} إعلان` : `${card.any.toLocaleString('en-US')} ads`}
            {card.priceType ? (ar ? ` · الأسعار ${forType(typeLabel(card.priceType, 'ar'))}` : ` · prices for ${typeLabel(card.priceType, 'en')}`) : ''}
          </Text>
          {/* 1. the table */}
          <View style={s.table} testID="map-card-table">
            <View style={[s.tr, s.thRow, { flexDirection: 'row' }]}>
              <Text style={[s.th, s.rowLabel]} />
              {COLUMNS[loc].map((c) => <Text key={c} style={s.th}>{c}</Text>)}
            </View>
            {(['new', 'gone', 'ppm', 'cuts'] as const).map((k) => {
              const r = cardRow(card, k, loc);
              return (
                <View key={k} style={[s.tr, { flexDirection: 'row' }]}>
                  <Text style={[s.td, s.rowLabel]}>{r.label}</Text>
                  {r.cells.map((c, i) => <Text key={i} style={[s.td, i === 4 && s.nbCell, toneStyle(c.tone)]}>{c.text}</Text>)}
                </View>
              );
            })}
          </View>
          {/* 2. each nearby district's asking price per metre */}
          {nearbyPrices(card, loc).length ? (
            <View style={s.block}>
              <Text style={[s.h, { writingDirection: dir }]}>{ar ? 'سعر المتر المعروض في الأحياء القريبة' : 'Asking price / m² nearby'}</Text>
              <View style={[s.chips, { flexDirection: 'row' }]}>
                {nearbyPrices(card, loc).map((d) => <Text key={d.name} style={s.chip}>{`${d.name} ${d.text}`}</Text>)}
              </View>
            </View>
          ) : null}
          {/* 3. نظرة سريعة */}
          <Text style={[s.h, { writingDirection: dir }]}>{ar ? 'نظرة سريعة' : 'Quick look'}</Text>
          <View style={[s.grid, { flexDirection: 'row' }]} testID="map-card-quick">
            {quickLook(card, loc).map((q) => (
              <View key={q.label} style={s.cell}>
                <Text style={[s.cellLabel, { writingDirection: dir }]}>{q.label}</Text>
                <Text style={[s.cellValue, { writingDirection: dir }]}>{q.value}</Text>
                {q.nearby ? <Text style={[s.cellNb, { writingDirection: dir }]}>{q.nearby}</Text> : null}
              </View>
            ))}
          </View>
          {/* 4. the note */}
          <Text style={[s.note, { writingDirection: dir }]}>{CARD_NOTE[loc]}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, bottom: 8, maxHeight: '92%', backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)' },
  head: { paddingHorizontal: 34, marginBottom: 2, minHeight: 28, justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: '#1f1e24', textAlign: 'center' },
  close: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1efe8', zIndex: 2 },
  closeT: { fontSize: 14, color: '#444' },
  sub: { fontSize: 12, color: '#6b6a70', marginBottom: 8 },
  muted: { fontSize: 13, color: '#6b6a70', paddingVertical: 18 },
  center: { textAlign: 'center' },
  ask: { fontSize: 13, color: '#9a6a12', fontWeight: '700', paddingVertical: 18 },
  table: { borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.1)', borderRadius: 10, overflow: 'hidden', marginBottom: 10 },
  tr: { alignItems: 'center', borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)' },
  thRow: { backgroundColor: '#f6f5f1', borderTopWidth: 0 },
  th: { flex: 1, fontSize: 11, color: '#6b6a70', fontWeight: '600', textAlign: 'center', paddingVertical: 6 },
  td: { flex: 1, fontSize: 12, color: '#1f1e24', fontWeight: '600', textAlign: 'center', paddingVertical: 7 },
  rowLabel: { flex: 1.7, paddingHorizontal: 6, fontWeight: '600', color: '#3d3c42', fontSize: 11.5, textAlign: 'auto' },
  nbCell: { color: '#6b6a70' },
  up: { color: '#B42318' },
  down: { color: '#067647' },
  block: { marginBottom: 10 },
  h: { fontSize: 12.5, fontWeight: '700', color: '#1f1e24', marginBottom: 6 },
  chips: { flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 11.5, color: '#3d3c42', backgroundColor: '#f6f5f1', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  grid: { flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  cell: { width: '48.5%', backgroundColor: '#f6f5f1', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  cellLabel: { fontSize: 11, color: '#6b6a70' },
  cellValue: { fontSize: 13.5, fontWeight: '700', color: '#1f1e24', marginTop: 1 },
  cellNb: { fontSize: 11, color: '#8a8990', marginTop: 1 },
  note: { fontSize: 11, color: '#8a8990', textAlign: 'center', marginTop: 2 },
});
