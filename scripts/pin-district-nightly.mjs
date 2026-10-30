// Nightly pin districts (owner main rule 2026-10-25, automated 2026-10-30).
//
// For every served ad that has a map pin and no district: ask Apple Maps at the pin and at 4 spots 150 m around it
// (N, S, E, W). The same district at all 5 = a MIDDLE home → switched on. Anything else = an EDGE home → loaded held
// (waits for Google). The database function pin_district_load() applies every other guard (list name, same city, blank
// served ad, not a shared default pin, never overwrite) — this script only asks the map and posts the answers.
//
// Env: APPLE_MAPS_P8 (the .p8 contents), APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// PIN_MAX_ADS (default 600 → ≤ 3,000 Apple calls of the 25,000/day quota). DRY_RUN=1 asks Apple but posts nothing.
// PIN_LOAD_FROM=<jsonl> replays a batch of Apple answers already saved (one JSON per line: st, lid, cid, name, locality,
// verdict, lat, lng) with PIN_RUN_ID (apple-ring-YYYY-MM-DD): no Apple call, the same loader, the same guards.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import "./lib/gateFetch.mjs"; // secret handshake for our own database calls (docs/ops/SCRAPE_GUARD.md)

const env = (k, optional = false) => {
  const v = process.env[k];
  if (!v && !optional) { console.error(`missing env ${k}`); process.exit(78); }
  return v;
};
const SB = env("SUPABASE_URL").replace(/\/$/, ""), SR = env("SUPABASE_SERVICE_ROLE_KEY");
const sbHeaders = { apikey: SR, Authorization: `Bearer ${SR}` };
async function load(rows, runId) {
  const r = await fetch(`${SB}/rest/v1/rpc/pin_district_load`, {
    method: "POST", headers: { ...sbHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ p_rows: rows, p_run_id: runId }),
  });
  const text = await r.text();
  if (!r.ok) { console.error(`pin_district_load ${r.status}: ${text.slice(0, 500)}`); process.exit(1); }
  console.log(`loaded: ${text}`);
}
if (process.env.PIN_LOAD_FROM) {
  const runId = env("PIN_RUN_ID");
  const rows = readFileSync(process.env.PIN_LOAD_FROM, "utf8").trim().split("\n").filter(Boolean).map((l) => {
    const j = JSON.parse(l);
    return { st: j.st, lid: j.lid, cid: j.cid, name: j.name ?? null, locality: j.locality ?? null, verdict: j.verdict, lat: j.lat, lng: j.lng };
  });
  console.log(`replaying ${rows.length} saved Apple answers as ${runId}`);
  await load(rows, runId);
  process.exit(0);
}

const P8 = env("APPLE_MAPS_P8"), KEY_ID = env("APPLE_MAPS_KEY_ID"), TEAM_ID = env("APPLE_MAPS_TEAM_ID");
const MAX = Number(process.env.PIN_MAX_ADS || 600);
const DRY = process.env.DRY_RUN === "1";
const RUN_ID = `apple-nightly-${new Date().toISOString().slice(0, 10)}`;

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" }), body = b64({ iss: TEAM_ID, iat: now, exp: now + 1800 });
  const sig = createSign("SHA256").update(`${head}.${body}`).sign({ key: P8, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const r = await fetch("https://maps-api.apple.com/v1/token", { headers: { Authorization: `Bearer ${head}.${body}.${sig}` } });
  if (!r.ok) throw new Error(`apple token ${r.status}`);
  return (await r.json()).accessToken;
}

// 1. candidates: served, blank district, has a pin (the service key reads the same public index)
const cands = [];
for (let from = 0; cands.length < MAX; from += 1000) {
  const r = await fetch(`${SB}/rest/v1/search_listings_ar?select=source_table,listing_id,city_id,latitude,longitude&production_ready=eq.true&district_ar=is.null&latitude=not.is.null&longitude=not.is.null&city_id=not.is.null&order=last_updated.desc,source_table,listing_id`,
    { headers: { ...sbHeaders, Range: `${from}-${from + 999}` } });
  if (!r.ok && r.status !== 206) throw new Error(`candidates ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  cands.push(...rows);
  if (rows.length < 1000) break;
}
// skip ads that already have a pin row (held edge homes would otherwise be re-asked every night)
const have = new Set();
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${SB}/rest/v1/listing_pin_district?select=source_table,listing_id`, { headers: { ...sbHeaders, Range: `${from}-${from + 999}` } });
  if (!r.ok && r.status !== 206) throw new Error(`pin rows ${r.status}`);
  const rows = await r.json();
  for (const x of rows) have.add(`${x.source_table}:${x.listing_id}`);
  if (rows.length < 1000) break;
}
const todo = cands.filter((c) => !have.has(`${c.source_table}:${c.listing_id}`)).slice(0, MAX);
console.log(`blank ads with a pin ${cands.length} · already have a pin row ${have.size} · asking Apple for ${todo.length} (cap ${MAX}) · ${RUN_ID}${DRY ? " · DRY RUN" : ""}`);

// 2. Apple, one answer per 5-dp spot
let tok = await accessToken(), tokAt = Date.now(), calls = 0, got429 = 0;
const cache = new Map();
const k5 = (la, lo) => `${Number(la).toFixed(5)},${Number(lo).toFixed(5)}`;
async function geo(lat, lng) {
  const key = k5(lat, lng);
  if (cache.has(key)) return cache.get(key);
  if (Date.now() - tokAt > 20 * 60e3) { tok = await accessToken(); tokAt = Date.now(); }
  let out = { name: null, locality: null };
  for (let tries = 0; tries < 3; tries++) {
    try {
      const res = await fetch(`https://maps-api.apple.com/v1/reverseGeocode?loc=${key}&lang=ar`, { headers: { Authorization: `Bearer ${tok}` } });
      calls++;
      if (res.status === 429) { if (++got429 >= 3) { console.log("Apple 429 three times: stopping here, posting what we have"); return null; } await new Promise((s) => setTimeout(s, 60e3)); continue; }
      got429 = 0;
      if (res.status === 401) { tok = await accessToken(); tokAt = Date.now(); continue; }
      if (res.ok) {
        const a = (await res.json()).results?.[0]?.structuredAddress ?? null;
        out = { name: a?.subLocality ?? a?.dependentLocalities?.[0] ?? null, locality: a?.locality ?? null };
        break;
      }
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 500));
  }
  cache.set(key, out);
  await new Promise((s) => setTimeout(s, 90));
  return out;
}
const R = 150;
const ring = (lat, lng) => {
  const dlat = R / 111320, dlng = R / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[lat + dlat, lng], [lat - dlat, lng], [lat, lng + dlng], [lat, lng - dlng]];
};

const rows = [];
let stopped = false;
for (const c of todo) {
  const lat = Number(c.latitude), lng = Number(c.longitude);
  const center = await geo(lat, lng);
  if (center === null) { stopped = true; break; }
  let verdict = "silent";
  if (center.name) {
    verdict = "middle";
    for (const [a, b] of ring(lat, lng)) {
      const s = await geo(a, b);
      if (s === null) { stopped = true; break; }
      if (s.name !== center.name) { verdict = "edge"; break; } // one different spot is enough: stop asking
    }
    if (stopped) break;
  }
  rows.push({ st: c.source_table, lid: c.listing_id, cid: c.city_id, name: center.name, locality: center.locality, verdict, lat, lng });
}
const by = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`asked ${rows.length} · middle ${by("middle")} · edge ${by("edge")} · silent ${by("silent")} · apple calls ${calls}${stopped ? " · stopped early (429)" : ""}`);

// 3. load (every guard lives in the database)
if (DRY) { console.log("DRY_RUN: nothing posted"); process.exit(0); }
if (rows.length === 0) { console.log("nothing to load"); process.exit(0); }
await load(rows, RUN_ID);
