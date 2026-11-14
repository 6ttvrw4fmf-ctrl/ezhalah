// District names a card shows but the Filter list refuses — what does Apple Maps say? READ-ONLY (🦅 2026-11-13, backlog 1743).
//
// Owner decision 2026-11-10 (falcon:end 3545, LINE 1 d): «add the real district names of the served alshawaf + rawasidark
// ads to the picker, BUT only through the permanent district-from-map rule: the site's name → Apple Maps pin (same city, on
// the official list) → Google Maps → city only. A name joins the picker only when the pins confirm it is a real district of
// that city; a near-twin (centers < 1.5 km, same Apple name) becomes an alias, never a second entry. No guessing.»
//
// This script gathers that evidence and decides nothing: for every (platform, city, district) that
// served_district_not_offered() lists under list_rule = 'rewritten_recovery', it asks Apple
//   1. reverseGeocode at every distinct pin of those ads  → the district Apple names where the homes are;
//   2. geocode «<name>، <city>»                            → where Apple puts the site's own name, and how far that is
//                                                           from the homes (km to the pins' centre).
// It prints one JSON line per name and posts nothing anywhere.
//
// Env: APPLE_MAPS_P8, APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createSign } from "node:crypto";
import "./lib/gateFetch.mjs";

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`missing env ${k}`); process.exit(78); } return v; };
const SB = env("SUPABASE_URL").replace(/\/$/, ""), SR = env("SUPABASE_SERVICE_ROLE_KEY");
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const P8 = env("APPLE_MAPS_P8"), KEY_ID = env("APPLE_MAPS_KEY_ID"), TEAM_ID = env("APPLE_MAPS_TEAM_ID");
const RULE = process.env.NAME_CHECK_RULE || "rewritten_recovery";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" }), body = b64({ iss: TEAM_ID, iat: now, exp: now + 1800 });
  const sig = createSign("SHA256").update(`${head}.${body}`).sign({ key: P8, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const r = await fetch("https://maps-api.apple.com/v1/token", { headers: { Authorization: `Bearer ${head}.${body}.${sig}` } });
  if (!r.ok) throw new Error(`apple token ${r.status}`);
  return (await r.json()).accessToken;
}
const tok = await accessToken();
let calls = 0;
async function apple(path) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(`https://maps-api.apple.com/v1/${path}`, { headers: { Authorization: `Bearer ${tok}` } });
    calls++;
    if (r.ok) { await new Promise((s) => setTimeout(s, 120)); return r.json(); }
    if (r.status === 429) await new Promise((s) => setTimeout(s, 30e3));
    else await new Promise((s) => setTimeout(s, 800));
  }
  return null; // a failed ask is UNKNOWN, never «Apple has no such place»
}
const km = (a, b, c, d) => {
  const R = 6371, x = ((c - a) * Math.PI) / 180, y = ((d - b) * Math.PI) / 180;
  const h = Math.sin(x / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const rr = await fetch(`${SB}/rest/v1/rpc/served_district_not_offered`, { method: "POST", headers: H, body: "{}" });
if (!rr.ok) { console.error(`served_district_not_offered ${rr.status}`); process.exit(1); }
const pairs = (await rr.json()).filter((p) => p.list_rule === RULE);
console.log(`${pairs.length} name(s) under list_rule=${RULE}`);

for (const p of pairs) {
  const q = new URLSearchParams({ select: "listing_id,latitude,longitude", platform: `eq.${p.platform}`, city_id: `eq.${p.city_id}`, district_ar: `eq.${p.district_ar}` });
  const lr = await fetch(`${SB}/rest/v1/search_listings_ar?${q}`, { headers: H });
  const ads = lr.ok ? await lr.json() : [];
  const pins = [...new Map(ads.filter((a) => a.latitude != null && a.longitude != null)
    .map((a) => [`${Number(a.latitude).toFixed(4)},${Number(a.longitude).toFixed(4)}`, a])).values()];
  const reverse = {};
  for (const a of pins.slice(0, 12)) {
    const j = await apple(`reverseGeocode?loc=${Number(a.latitude).toFixed(5)},${Number(a.longitude).toFixed(5)}&lang=ar`);
    const s = j?.results?.[0]?.structuredAddress;
    const key = j == null ? "(ask failed)" : `${s?.subLocality ?? s?.dependentLocalities?.[0] ?? "(no district)"} | ${s?.locality ?? "?"}`;
    reverse[key] = (reverse[key] || 0) + 1;
  }
  const cLat = pins.length ? pins.reduce((n, a) => n + Number(a.latitude), 0) / pins.length : null;
  const cLng = pins.length ? pins.reduce((n, a) => n + Number(a.longitude), 0) / pins.length : null;
  const name = p.district_ar.replace(/[،,]+/g, " ").replace(/\s+/g, " ").trim();
  const fq = `${name}، ${p.city_ar}`;
  const g = await apple(`geocode?q=${encodeURIComponent(fq)}&lang=ar&limitToCountries=SA${cLat != null ? `&searchLocation=${cLat},${cLng}` : ""}`);
  const forward = (g?.results ?? []).slice(0, 3).map((x) => ({
    name: x.name, sub: x.structuredAddress?.subLocality ?? null, locality: x.structuredAddress?.locality ?? null,
    km_from_pins: cLat != null && x.coordinate ? Number(km(cLat, cLng, x.coordinate.latitude, x.coordinate.longitude).toFixed(2)) : null,
  }));
  console.log(JSON.stringify({ platform: p.platform, city_id: p.city_id, city: p.city_ar, district: p.district_ar, ads: Number(p.ads),
    pins: pins.length, pin_centre: cLat != null ? [Number(cLat.toFixed(5)), Number(cLng.toFixed(5))] : null,
    apple_at_pins: reverse, apple_for_name: g == null ? "(ask failed)" : forward }));
}
console.log(`apple calls ${calls} · posted nothing`);
