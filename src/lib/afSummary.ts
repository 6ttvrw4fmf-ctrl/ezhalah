// AF emoji summary sentence (owner 2026-08-22). PURE — zero runtime deps.
// Each selected Advanced Filter attribute → emoji + Arabic label.
// Skipped questions never appear (the facets array only holds committed answers).

const AMENITY_EMOJI: Record<string, string> = {
  kitchen: '🍳', parking: '🅿️', elevator: '🛗', ac: '❄️',
  private_entrance: '🚪', maid_room: '🧹', driver_room: '🚘',
  car_entrance: '🚗', sanitation: '🚰', furnished: '🛋️',
  electricity: '⚡', water_supply: '💧',
};

export function buildAfSummary(facets: Array<{ id: string; keys: string[]; labels: string[] }>): string {
  if (!facets.length) return '';
  const items: string[] = [];
  for (const f of facets) {
    switch (f.id) {
      case 'property_age':
        items.push(`عمر ${f.labels[0]} ${f.keys[0] === 'new' ? '✨' : '🏗️'}`);
        break;
      case 'rnpl':
        items.push(`${f.labels[0]} 💳`);
        break;
      case 'amenities':
        for (let i = 0; i < f.keys.length; i++)
          items.push(`${f.labels[i]} ${AMENITY_EMOJI[f.keys[i]] ?? '✅'}`);
        break;
      // SCOPE tiers (owner 2026-08-23) — multi-select like amenities, so each picked group/type is
      // its own item. Without these they would fall through `default:` and print as bare labels.
      case 'property_group':
        for (const l of f.labels) items.push(`${l} 🏘️`);
        break;
      case 'property_type':
        for (const l of f.labels) items.push(`${l} 🏡`);
        break;
      case 'bathrooms':
        items.push(`${f.labels[0]} حمامات 🚿`);
        break;
      case 'furnished':
        items.push(`${f.labels[0]} ${f.keys[0] === 'yes' ? '🛋️' : '🏠'}`);
        break;
      case 'street_width':
        items.push(`شارع ${f.labels[0]} 🛣️`);
        break;
      case 'direction':
        items.push(`${f.labels.join(' و')} 🧭`);
        break;
      case 'rating':
        items.push(`تقييم ${f.labels[0]} ⭐`);
        break;
      case 'unit_subtype':
        items.push(`${f.labels[0]} 🏢`);
        break;
      default:
        for (const l of f.labels) items.push(l);
    }
  }
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join('، ') + '، و' + items[items.length - 1];
}
