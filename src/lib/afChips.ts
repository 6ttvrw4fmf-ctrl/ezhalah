// Chip definitions for the Advanced Filter's themed cards — ONE voice per amenity token (owner handoff
// 2026-10-31, built 2026-11-01). Token = the p_amenities slug; its count column is cnt_<token> in
// apartment_guided_counts_ar (migration 20261101100930), and the 41 column-backed ones are packed into
// af_canon under the same name. labelKey is the EN i18n key (src/i18n.tsx carries the Arabic). This module
// is pure and imports nothing from src/data: lib modules (afEvidence, afSummary) read it too.
export const CHIP_DEFS: Record<string, { labelKey: string; emoji: string }> = {
  kitchen: { labelKey: 'Kitchen', emoji: '🍳' }, ac: { labelKey: 'Air conditioning', emoji: '❄️' },
  parking: { labelKey: 'Parking', emoji: '🅿️' }, elevator: { labelKey: 'Elevator', emoji: '🛗' },
  furnished: { labelKey: 'Furnished', emoji: '🛋️' }, private_entrance: { labelKey: 'Private entrance', emoji: '🚪' },
  maid_room: { labelKey: 'Maid room', emoji: '🧹' }, driver_room: { labelKey: 'Driver room', emoji: '🚗' },
  majlis: { labelKey: 'Majlis room', emoji: '🛋️' }, balcony: { labelKey: 'Balcony', emoji: '🌅' },
  garden: { labelKey: 'Garden', emoji: '🌳' }, gym: { labelKey: 'Gym', emoji: '🏋️' }, pool: { labelKey: 'Pool', emoji: '🏊' },
  optical_fibers: { labelKey: 'Optical fibers', emoji: '🌐' }, car_entrance: { labelKey: 'Car entrance', emoji: '🚗' },
  sanitation: { labelKey: 'Sewage connection', emoji: '🚰' },
  // «washing machine» rides the laundry_room fact (owner 2026-11-01); Floor keeps the room's own name (CHIP_LABEL_FLOOR)
  laundry_room: { labelKey: 'Washing machine', emoji: '🧺' },
  roof: { labelKey: 'Private roof', emoji: '🏠' }, two_entrances: { labelKey: 'Two entrances', emoji: '🚪' },
  annex: { labelKey: 'Annex', emoji: '🏠' }, yard: { labelKey: 'Yard', emoji: '🌳' }, garage: { labelKey: 'Garage', emoji: '🚙' },
  grill: { labelKey: 'Grill', emoji: '🔥' }, storage: { labelKey: 'Storage room', emoji: '📦' },
  water_tank: { labelKey: 'Private water tank', emoji: '💧' }, warranty: { labelKey: 'Warranty', emoji: '🛡️' },
  electronic_deed: { labelKey: 'Electronic deed', emoji: '📄' }, basement: { labelKey: 'Basement', emoji: '🔽' },
  self_checkin: { labelKey: 'Self check-in', emoji: '🔑' }, wifi: { labelKey: 'Wi-Fi', emoji: '📶' },
  bills_included: { labelKey: 'Bills included', emoji: '💡' }, jacuzzi: { labelKey: 'Jacuzzi', emoji: '🛁' },
  smart_tv: { labelKey: 'Smart TV / cinema room', emoji: '📺' }, billiards: { labelKey: 'Billiards table', emoji: '🎱' },
  cleaning_service: { labelKey: 'Cleaning service', emoji: '🧹' }, soundproof: { labelKey: 'Soundproof', emoji: '🔇' },
  cameras: { labelKey: 'Cameras', emoji: '📹' }, guard: { labelKey: 'Guard', emoji: '💂' },
  smart_entry: { labelKey: 'Smart entry', emoji: '🔑' }, smart_home: { labelKey: 'Smart home', emoji: '🏠' },
  central_gas: { labelKey: 'Central gas', emoji: '🔥' }, sauna: { labelKey: 'Sauna', emoji: '🧖' },
  kids_play_area: { labelKey: "Kids' play area", emoji: '🧒' }, nursery: { labelKey: 'Nursery', emoji: '🧸' },
  free_maintenance: { labelKey: 'Free maintenance', emoji: '🔧' }, intercom: { labelKey: 'Intercom', emoji: '📞' },
  fire_system: { labelKey: 'Fire system', emoji: '🧯' }, ev_charger: { labelKey: 'EV charger', emoji: '🚗' },
  central_vacuum: { labelKey: 'Central vacuum', emoji: '🌀' }, insulation: { labelKey: 'Heat & water insulation', emoji: '🧊' },
  dining_majlis: { labelKey: 'Dining majlis', emoji: '🍽️' }, own_bathroom: { labelKey: 'Own bathroom', emoji: '🚿' },
  fridge: { labelKey: 'Fridge', emoji: '🧊' }, whole_floor: { labelKey: 'Whole floor', emoji: '🏢' },
  singles: { labelKey: 'Singles', emoji: '👤' }, families: { labelKey: 'Families', emoji: '👨‍👩‍👧' },
  separate_meters: { labelKey: 'Separate meters', emoji: '⚡' },
};
