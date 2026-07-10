// Custom line-art property icons (user-supplied, sliced from the master "type of logo" sheet and
// cleaned into monochrome alpha PNGs). OptionBox / ResultCard tint them (ink when idle, white when
// selected). Keyed by the app's GROUP names and clean TYPE names; any key missing here falls back to
// the Ionicons set (iconForGroup / iconForType). UI-only module (require() of assets) — never import
// it from the engine/test code.
export const GROUP_IMG: Record<string, any> = {
  'Apartments & Co-living':            require('../../assets/icons/apartments-coliving.png'),
  'Villas & Houses':                   require('../../assets/icons/villas-houses.png'),
  'Vacation & Rural':                  require('../../assets/icons/vacation-rural.png'),
  'Residential Plots':                 require('../../assets/icons/residential-plots.png'),
  'Retail & Workspace':                require('../../assets/icons/retail-workspace.png'),
  'Industrial & Logistics':            require('../../assets/icons/industrial-logistics.png'),
  'Commercial Buildings & Facilities': require('../../assets/icons/commercial-buildings-facilities.png'),
  'Commercial & Industrial Plots':     require('../../assets/icons/commercial-industrial-plots.png'),
};

export const TYPE_IMG: Record<string, any> = {
  'Apartment':            require('../../assets/icons/apartment.png'),
  'Villa':                require('../../assets/icons/villa.png'),
  'House':                require('../../assets/icons/house.png'),
  'Duplex':               require('../../assets/icons/duplex.png'),
  'Palace':               require('../../assets/icons/palace.png'),
  'Floor':                require('../../assets/icons/floor.png'),
  'Studio':               require('../../assets/icons/studio.png'),
  'Room':                 require('../../assets/icons/room.png'),
  'Residential Building': require('../../assets/icons/residential-building.png'),
  'Rest House':           require('../../assets/icons/rest-house.png'),
  'Chalet':               require('../../assets/icons/chalet.png'),
  'Camp':                 require('../../assets/icons/camp.png'),
  'Residential Land':     require('../../assets/icons/residential-land.png'),
  'Farm':                 require('../../assets/icons/farm.png'),
  'Office':               require('../../assets/icons/office.png'),
  'Shop':                 require('../../assets/icons/shop.png'),
  'Showroom':             require('../../assets/icons/showroom.png'),
  'Warehouse':            require('../../assets/icons/warehouse.png'),
  'Factory':              require('../../assets/icons/factory.png'),
  'Workshop':             require('../../assets/icons/workshop.png'),
  'Commercial Building':  require('../../assets/icons/commercial-building.png'),
  'Hotel':                require('../../assets/icons/hotel.png'),
  'Gas Station':          require('../../assets/icons/gas-station.png'),
  'Specialized Facilities': require('../../assets/icons/specialized-facilities.png'),
  'Service Facilities':   require('../../assets/icons/service-facilities.png'), // مرافق خدمية — owner-provided icon (sliced from assets/images/المرافق الخدمية.jpg → 256² monochrome alpha, 2026-07-07)
  'Commercial Land':      require('../../assets/icons/commercial-land.png'),
  'Industrial Land':      require('../../assets/icons/industrial-land.png'),
  // sliced from the user's «staff housing bank telecom» sheet → monochrome alpha (2026-07-01)
  'Bank':                 require('../../assets/icons/bank.png'),
  'Telecom Tower':        require('../../assets/icons/telecom-tower.png'),
  'Staff Housing':        require('../../assets/icons/staff-housing.png'),
};

// Category (macro) icons — Residential / Commercial — and Deal (Buy/Rent) icons, sliced from the
// user-supplied logo sheets into monochrome alpha PNGs, tinted like every other chip/segment icon.
export const CATEGORY_IMG: Record<string, any> = {
  'Residential': require('../../assets/icons/cat-residential.png'),
  'Commercial':  require('../../assets/icons/cat-commercial.png'),
};
export const DEAL_IMG: Record<string, any> = {
  'Rent': require('../../assets/images/deal/rent.png'),
  'Buy':  require('../../assets/images/deal/buy.png'),
};
// Rent-period (Monthly / Yearly) icons — calendar art sliced from the user-supplied سعر شهري/سنوي sheet.
export const PERIOD_IMG: Record<string, any> = {
  'Monthly': require('../../assets/icons/period-monthly.png'),
  'Yearly':  require('../../assets/icons/period-yearly.png'),
};
// Bedroom-count icons (Any / 1 / 2 / 3 / 4 / 5+) — bed art sliced from the user-supplied غرف النوم sheet.
export const BED_IMG: Record<string, any> = {
  'any': require('../../assets/icons/bed-any.png'),
  '1':   require('../../assets/icons/bed-1.png'),
  '2':   require('../../assets/icons/bed-2.png'),
  '3':   require('../../assets/icons/bed-3.png'),
  '4':   require('../../assets/icons/bed-4.png'),
  '5+':  require('../../assets/icons/bed-5plus.png'),
};

export const groupImg = (group: string): any => GROUP_IMG[group];
export const typeImg = (cleanType: string): any => TYPE_IMG[cleanType];
export const categoryImg = (cat: string): any => CATEGORY_IMG[cat];
export const dealImg = (deal: string): any => DEAL_IMG[deal];

// Price / Area (السعر / المساحة) filter icons — sliced from the user's «logos for price and size»
// sheet into brand-green transparent PNGs. Header badges + per-box من/إلى marks. UI-only.
export const RANGE_ICON = {
  priceHead: require('../../assets/icons/filter-price.png'),
  priceFrom: require('../../assets/icons/filter-price-from.png'),
  priceTo:   require('../../assets/icons/filter-price-to.png'),
  areaHead:  require('../../assets/icons/filter-area.png'),
  areaFrom:  require('../../assets/icons/filter-area-from.png'),
  areaTo:    require('../../assets/icons/filter-area-to.png'),
};

// Location-step icons (Saudi Arabia / Region / City / District) — the designed art in assets/images/loc,
// keyed by Place.kind. Restored 2026-07-06: the suggestion rows were rendering Ionicons vectors, not these.
export const LOC_IMG: Record<string, any> = {
  country:  require('../../assets/images/loc/country.png'),
  region:   require('../../assets/images/loc/region.png'),
  city:     require('../../assets/images/loc/city.png'),
  district: require('../../assets/images/loc/district.png'),
};
