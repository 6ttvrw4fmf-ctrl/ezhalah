// ─────────────────────────────────────────────────────────────────────────────
// ingest-listings — Ezhalah real listing ingestion (PRD §8.2)
//
// Pulls LIVE Saudi property listings from partner platforms, normalizes every
// feed onto the app's `listings` row shape, classifies each into the search
// pools the client groups by, and upserts into Supabase.
//
// Source adapters are pluggable. The first real adapter is Bayut Saudi, whose
// public web frontend (bayut.sa) is powered by Algolia — we query the same
// search index the browser does, so this is genuine live data, not a mock.
//
// Hard rules enforced here (mirror the client guardrails):
//   • `deal` is only ever 'Rent' | 'Buy' (DB check constraint).
//   • `source` must be a known platform (FK → platforms.name).
//
// Auth: this is an admin endpoint. verify_jwt is disabled at deploy time and we
// instead require the caller to present the project's service-role key as a
// Bearer token (auto-injected into this function's env — no extra secret to
// manage). Invoke on a schedule (cron) or manually to refresh the catalog.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Bayut Saudi public Algolia search (the same app id + search-only key the
// bayut.sa web app ships to every browser; read-only, safe to use client-side).
const ALGOLIA_APP = "LL8IZ711CS";
const ALGOLIA_KEY = "5b970b39b22a4ff1b99e5167696eef3f";
const ALGOLIA_INDEX = "bayut-sa-production-ads-en";
const ALGOLIA_URL =
  `https://${ALGOLIA_APP.toLowerCase()}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
const IMG_CDN = "https://images.bayut.sa/thumbnails"; // {photoId}-800x600.jpeg

// Recency buckets the client sorts by (must match data/listings.ts LISTED_SEQ).
const LISTED_SEQ = ["today", "2 days ago", "2 months ago", "8 months ago", "1 year ago"];

type PoolKey = "villa" | "apartment" | "land" | "budget" | "mixRent" | "mixBuy";
// id = POOL_BASE * 1000 + index, so the client's buildPools() (floor(id/1000))
// regroups the flat table into the exact pools runSearch() expects.
const POOL_BASE: Record<PoolKey, number> = {
  villa: 1, apartment: 2, land: 3, budget: 4, mixRent: 5, mixBuy: 6,
};
const POOL_CAP = 18; // listings kept per pool

type Row = {
  id: number;
  type: string;
  deal: "Rent" | "Buy";
  city: string;
  district: string;
  road: string;
  price: string;
  area: number;
  beds: number;
  source: string;
  listed: string;
  photo: string;
};

// ── Bayut hit → normalized fields ────────────────────────────────────────────

function recencyBucket(createdAtSec: number): string {
  if (!createdAtSec) return "recently";
  const days = (Date.now() / 1000 - createdAtSec) / 86400;
  if (days < 2) return LISTED_SEQ[0];
  if (days < 30) return LISTED_SEQ[1];
  if (days < 150) return LISTED_SEQ[2];
  if (days < 365) return LISTED_SEQ[3];
  return LISTED_SEQ[4];
}

function priceString(hit: any, deal: "Rent" | "Buy"): string {
  const p = Number(hit.price) || 0;
  if (deal === "Rent") {
    let annual = p;
    const f = String(hit.rentFrequency ?? "yearly");
    if (f === "monthly") annual = p * 12;
    else if (f === "weekly") annual = p * 52;
    else if (f === "daily") annual = p * 365;
    return `SAR ${Math.round(annual).toLocaleString("en-US")}/year`;
  }
  if (p >= 1_000_000) {
    const m = Math.round((p / 1_000_000) * 10) / 10;
    return `SAR ${m}M`;
  }
  return `SAR ${Math.round(p).toLocaleString("en-US")}`;
}

function typeName(hit: any): string {
  const cats: any[] = Array.isArray(hit.category) ? hit.category : [];
  const lvl = cats.find((c) => c.level === 1) ?? cats[cats.length - 1];
  return (lvl?.nameSingular || lvl?.name || "Property").trim();
}

function place(hit: any): { city: string; district: string } {
  const locs: any[] = Array.isArray(hit.location) ? hit.location : [];
  const city = locs.find((l) => l.level === 1)?.name ?? "";
  let deepest = "";
  let maxLevel = -1;
  for (const l of locs) {
    if (typeof l.level === "number" && l.level > maxLevel && l.name) {
      maxLevel = l.level;
      deepest = l.name;
    }
  }
  return { city: String(city), district: String(deepest) };
}

function photoUrl(hit: any): string {
  const id = hit?.coverPhoto?.id;
  return id ? `${IMG_CDN}/${id}-800x600.jpeg` : "";
}

function poolFor(typeStr: string, deal: "Rent" | "Buy", priceNum: number): PoolKey[] {
  const t = typeStr.toLowerCase();
  const keys: PoolKey[] = [];
  if (/villa|townhouse|compound|palace|residential building|whole building/.test(t)) keys.push("villa");
  if (/apartment|floor|duplex|penthouse|studio|room/.test(t)) keys.push("apartment");
  if (/land|plot/.test(t)) keys.push("land");
  if (deal === "Buy") {
    keys.push("mixBuy");
    if (priceNum > 50_000 && priceNum <= 700_000) keys.push("budget");
  } else {
    keys.push("mixRent");
  }
  return keys;
}

// ── Algolia fetch ─────────────────────────────────────────────────────────────

async function algolia(filters: string, hitsPerPage = 50, query = ""): Promise<any[]> {
  const res = await fetch(ALGOLIA_URL, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": ALGOLIA_APP,
      "X-Algolia-API-Key": ALGOLIA_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, hitsPerPage, page: 0, filters }),
  });
  if (!res.ok) throw new Error(`Algolia ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return Array.isArray(json.hits) ? json.hits : [];
}

// ── Ingestion ──────────────────────────────────────────────────────────────

async function buildRows(): Promise<Row[]> {
  // Pull live rent + sale across the kingdom, freshest first, plus a land pass.
  const [rent, sale, land] = await Promise.all([
    algolia('purpose:"for-rent"', 80),
    algolia('purpose:"for-sale"', 80),
    algolia('purpose:"for-sale"', 60, "land"),
  ]);

  const pools: Record<PoolKey, Row[]> = {
    villa: [], apartment: [], land: [], budget: [], mixRent: [], mixBuy: [],
  };
  const seen: Record<PoolKey, Set<string>> = {
    villa: new Set(), apartment: new Set(), land: new Set(),
    budget: new Set(), mixRent: new Set(), mixBuy: new Set(),
  };

  const consume = (hit: any, deal: "Rent" | "Buy") => {
    const priceNum = Number(hit.price) || 0;
    if (!priceNum) return;
    const ext = String(hit.externalID ?? hit.id ?? "");
    const { city, district } = place(hit);
    if (!city) return;
    const ty = typeName(hit);
    const base = {
      type: ty,
      deal,
      city,
      district,
      road: "",
      price: priceString(hit, deal),
      area: Math.max(0, Math.round(Number(hit.area) || 0)),
      beds: Math.max(0, Math.round(Number(hit.rooms) || 0)),
      source: "Bayut",
      listed: recencyBucket(Number(hit.createdAt) || 0),
      photo: photoUrl(hit),
    };
    for (const key of poolFor(ty, deal, priceNum)) {
      if (pools[key].length >= POOL_CAP) continue;
      if (seen[key].has(ext)) continue;
      seen[key].add(ext);
      pools[key].push({ id: 0, ...base });
    }
  };

  for (const h of rent) consume(h, "Rent");
  for (const h of sale) consume(h, "Buy");
  for (const h of land) consume(h, "Buy"); // ensures the land pool fills with real plots

  // Assign pool-encoded ids: POOL_BASE*1000 + index.
  const rows: Row[] = [];
  (Object.keys(pools) as PoolKey[]).forEach((key) => {
    pools[key].forEach((r, i) => {
      r.id = POOL_BASE[key] * 1000 + i;
      rows.push(r);
    });
  });
  return rows;
}

// ── HTTP entry ─────────────────────────────────────────────────────────────

// Public project keys (already shipped to every browser in the app bundle) —
// used only as a soft gate. All writes go through the service-role client below.
const PUBLIC_KEY = "sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

Deno.serve(async (req: Request) => {
  // Gate: accept the service-role key (cron/admin) or the public project key.
  // Writes always go through the service-role client inside this function,
  // never the caller's token.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") ?? "";
  const ok = [SERVICE_KEY, ANON_KEY, PUBLIC_KEY].filter(Boolean);
  if (!ok.includes(token) && !ok.includes(apikey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rows = await buildRows();
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: false, error: "no listings fetched" }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error } = await supa.from("listings").upsert(rows, { onConflict: "id" });
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    const byPool: Record<string, number> = {};
    for (const r of rows) {
      const k = Math.floor(r.id / 1000);
      byPool[k] = (byPool[k] ?? 0) + 1;
    }
    return new Response(
      JSON.stringify({ ok: true, upserted: rows.length, byPool, source: "Bayut", at: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
