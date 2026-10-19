import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';

// A card in a REOPENED history chat whose listing was removed at its source since (owner 2026-10-18:
// «we don't remove it, we just say it's dead»). The card stays where it was; a dark shade and a big
// note sit on top. Kept as its own wrapper so the card design can be restyled without touching it.
export function DeadCardShade({ dead, children }: { dead: boolean; children: ReactNode }) {
  const { t } = useI18n();
  if (!dead) return <>{children}</>;
  return (
    <View style={s.wrap} accessibilityLabel={t('Listing ended')}>
      {children}
      <View style={s.shade} pointerEvents="none">
        <View style={s.note}>
          <Text style={s.title}>{t('Listing ended')}</Text>
          <Text style={s.sub}>{t('No longer available on the source site')}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'relative' },
  shade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, backgroundColor: 'rgba(12,16,14,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  note: {
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', maxWidth: '92%',
  },
  title: { color: 'rgba(255,255,255,0.98)', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.82)', fontSize: 14, fontWeight: '600', marginTop: 6, textAlign: 'center' },
});
