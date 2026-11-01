// The pure half of the weekly missed-pin robot (owner 2026-10-20 night: «we keep getting mistakes» →
// «yeah do that»). Given the HTML / iframe URLs / network URLs of ONE ad page the app shows WITHOUT a pin,
// list every Saudi lat/lng pair the page publishes, in every shape measured on a real site that night:
//   maps link/frame pairs (?q=, /place/, /search/?query=, /@, daddr=, ll=)      — therc, alsaedan, nawafeth…
//   a Google Maps embed's own centre «!2dLNG!3dLAT»                              — wadod
//   degrees-minutes-seconds in /place/ or ?q=  «25°24'43.2"N+49°36'48.8"E»       — shomou, aljassim
//   JSON key pairs  "latitude":X,"longitude":Y  /  "lat":X,"lng":Y  (incl. "map":{…}) — sokok, raghdan
//   JS objects / calls  {lat: X, lng: Y} · LatLng(X,Y) · parseFloat('X')          — ialqarawi, nawafeth
//   hidden fields  id="ad_lat" value="X" … id="ad_lon" value="Y"                  — ksaaqar
// The page is decoded first (&quot;, &#39;, &amp;, \" and \/ escapes, %-encoding), which is what hid sokok's
// 400 pins from the first two sweeps. Coarse pairs (< 4 decimals, e.g. sirdab's «24.91, 46.6») and pairs
// outside Saudi Arabia are dropped: neither is a pin.
//
// judgeSite() then decides, over the sampled ads of ONE site, which pairs are the ad's OWN unsaved pin:
//   · a pair repeated on ≥ 3 sampled ads is the site's office / default centre        (bossbih, ksaaqar)
//   · a point (~1 km) drawn on ads of DIFFERENT cities is the site's default            (nawafeth 156 دخنة
//     and 160 الدمام both at 27.022,49.573 in Jubail — robot run 39853742689, 2026-10-22)
//   · a pair equal to a pin we already store for ANOTHER ad is a «similar ads» card   (alshawaf, abwbna)
//   · a pair on a point / row we strip on purpose (default register, far-from-city)  is skipped
// A site is flagged when ≥ 2 sampled ads carry such a pair — one stray number never raises the alarm.

export type Pair = { lat: number; lng: number; shape: string; ctx: string };
export type AdSample = { url: string; listingId?: number; city?: string | null; html: string; frames?: string[]; network?: string[] };
export type SiteVerdict = { flagged: boolean; missed: Array<{ url: string; pair: Pair }>; repeated: string[] };

const NUM = String.raw`(-?\d{1,2}\.\d{4,})`;
const inKsa = (a: number, b: number) => a >= 16 && a <= 32.5 && b >= 34 && b <= 56;
export const key = (a: number, b: number) => `${a.toFixed(4)},${b.toFixed(4)}`;

export function decode(text: string): string {
  let t = text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  try { t = t + '\n' + decodeURIComponent(t.slice(0, 3_000_000).replace(/%(?![0-9A-Fa-f]{2})/g, '%25')); } catch { /* keep raw */ }
  return t;
}

const SHAPES: Array<[string, RegExp, boolean]> = [   // [name, regex (lat,lng groups), swapped]
  ['maps-link', new RegExp(String.raw`(?:maps/place/|maps/search/|maps\?q=|[?&]q=|[?&]query=|[?&]ll=|maps/@|/@|daddr=|destination=)` + NUM + String.raw`\s*(?:,|%2C)\s*` + NUM, 'g'), false],
  ['embed-pb', new RegExp(String.raw`!2d(-?\d{1,3}\.\d{4,})!3d(-?\d{1,2}\.\d{4,})`, 'g'), true],
  ['json-pair', new RegExp(String.raw`"(?:lat|latitude)"\s*:\s*"?` + NUM + String.raw`"?\s*,\s*"(?:lng|lon|long|longitude)"\s*:\s*"?` + NUM, 'gi'), false],
  ['js-object', new RegExp(String.raw`\b(?:lat|latitude)\s*:\s*['"]?` + NUM + String.raw`['"]?\s*,\s*(?:lng|lon|long|longitude)\s*:\s*['"]?` + NUM, 'gi'), false],
  ['latlng-call', new RegExp(String.raw`LatLng\(\s*` + NUM + String.raw`\s*,\s*` + NUM, 'g'), false],
  ['hidden-field', new RegExp(String.raw`id="ad_lat"\s+value="` + NUM + String.raw`"[\s\S]{0,200}?id="ad_lo?ng?"\s+value="` + NUM, 'g'), false],
  ['parse-float', new RegExp(String.raw`[Ll]at\w*\s*=\s*parseFloat\('` + NUM + String.raw`'\)[\s\S]{0,200}?[Ll](?:ng|on)\w*\s*=\s*parseFloat\('` + NUM, 'g'), false],
];
const DMS = /(?:maps\/place\/|[?&]q=)(\d{1,2})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"N[+\s]*(\d{1,3})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"E/g;

export function pairsIn(sample: AdSample): Pair[] {
  const text = decode([sample.html, ...(sample.frames || []), ...(sample.network || [])].join('\n'));
  const out = new Map<string, Pair>();
  // sakan prints a google.maps.LatLng marker on every ad, but only `show_exact_location = true` makes it the
  // ad's pin; without it the marker is the site's approximation (97227, audit 2026-10-21).
  const approxMarker = /show_exact_location/.test(text) && !/show_exact_location\s*=\s*true/.test(text);
  for (const [shape, re, swapped] of SHAPES) {
    if (shape === 'latlng-call' && approxMarker) continue;
    for (const m of text.matchAll(re)) {
      let a = Number(m[1]), b = Number(m[2]);
      if (swapped) [a, b] = [b, a];
      if (!inKsa(a, b)) continue;
      const k = key(a, b);
      if (!out.has(k)) out.set(k, { lat: a, lng: b, shape, ctx: text.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0).replace(/\s+/g, ' ') });
    }
  }
  for (const m of text.matchAll(DMS)) {
    const a = +m[1] + +m[2] / 60 + +m[3] / 3600, b = +m[4] + +m[5] / 60 + +m[6] / 3600;
    if (inKsa(a, b) && !out.has(key(a, b))) out.set(key(a, b), { lat: a, lng: b, shape: 'dms', ctx: '' });
  }
  return [...out.values()];
}

export function judgeSite(samples: AdSample[], knownPins: Set<string>, skip: { points: Set<string>; listingIds: Set<number> }): SiteVerdict {
  const per = samples.map((s) => ({ s, pairs: skip.listingIds.has(s.listingId ?? -1) ? [] : pairsIn(s) }));
  const freq = new Map<string, number>();
  for (const { pairs } of per) for (const p of pairs) freq.set(key(p.lat, p.lng), (freq.get(key(p.lat, p.lng)) ?? 0) + 1);
  const repeated = [...freq].filter(([, n]) => n >= 3).map(([k]) => k);
  // ~1 km cells holding ads of more than one city: one point standing for different towns is a default
  const cell = (p: Pair) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
  const citiesAt = new Map<string, Set<string>>();
  for (const { s, pairs } of per) for (const p of pairs) if (s.city) citiesAt.set(cell(p), (citiesAt.get(cell(p)) ?? new Set()).add(s.city));
  const shared = (p: Pair) => (citiesAt.get(cell(p))?.size ?? 0) >= 2;
  const missed: SiteVerdict['missed'] = [];
  for (const { s, pairs } of per) {
    const own = pairs.find((p) => {
      const k = key(p.lat, p.lng);
      return (freq.get(k) ?? 0) < 3 && !shared(p) && !knownPins.has(k) && !skip.points.has(k);
    });
    if (own) missed.push({ url: s.url, pair: own });
  }
  return { flagged: missed.length >= 2, missed, repeated };
}
