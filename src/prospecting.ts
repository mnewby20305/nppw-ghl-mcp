#!/usr/bin/env node
/**
 * Commercial Prospect Pipeline Filler — No Pressure Power Washing
 *
 * Runs on a schedule (Mon/Thu 8 AM by default), scrapes Google search
 * results for commercial property-management style businesses in the
 * Triangle NC area, dedupes against existing GHL contacts, creates new
 * contacts (capped at 25/run), and writes a run log to disk.
 *
 * NOTE on search method: no Google Places / Apollo API key was provided,
 * so this uses lightweight scraping of Google search result pages via
 * axios + cheerio. Google may rate-limit or change markup at any time —
 * if results come back empty, check the logs; this is the documented
 * limitation of the no-API-key approach.
 */

import axios from "axios";
import cron from "node-cron";
import fs from "fs";
import path from "path";

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const BASE_URL = "https://services.leadconnectorhq.com";
const MAX_NEW_CONTACTS_PER_RUN = 25;
const LOG_DIR = path.join(process.cwd(), "logs");

const SEARCH_QUERIES = [
  "Property management companies Raleigh NC",
  "HOA management companies Raleigh NC",
  "Apartment complexes Raleigh NC",
  "Office parks Raleigh NC",
  "Commercial property management Triangle NC",
  "Facilities management companies Raleigh NC",
  "Multi-family housing management Wake County NC",
  "HOA communities Wake County NC",
  "Property management companies Cary NC",
  "Commercial real estate management Durham NC",
];

function ghlHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

interface Prospect {
  name: string;
  address: string;
  phone: string;
  website: string;
  category: string;
}

// ─── Step 1: Search ─────────────────────────────────────────────────────────

// Rotate through queries based on day-of-year so each run hits a different
// slice of the list, cycling through all 10 over time.
function pickQueryForRun(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return SEARCH_QUERIES[dayOfYear % SEARCH_QUERIES.length];
}

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

async function searchGoogleMaps(query: string): Promise<Prospect[]> {
  const results: Prospect[] = [];

  if (!GOOGLE_PLACES_API_KEY) {
    console.error("GOOGLE_PLACES_API_KEY not set — skipping search.");
    return results;
  }

  try {
    // Text Search (New) API
    const resp = await axios.post(
      "https://places.googleapis.com/v1/places:searchText",
      { textQuery: query },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.types",
        },
        timeout: 20000,
      }
    );

    const places = (resp.data as any)?.places ?? [];
    for (const place of places) {
      const name = place.displayName?.text;
      if (!name) continue;
      results.push({
        name,
        address: place.formattedAddress || "",
        phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
        website: place.websiteUri || "",
        category: query,
      });
    }
  } catch (err: any) {
    console.error(`Search failed for "${query}":`, err.response?.data ?? err.message);
  }

  // Dedup within this single search's results by name
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Step 2: Dedup against GHL ──────────────────────────────────────────────

async function findContactByName(companyName: string): Promise<any | null> {
  try {
    const resp = await axios.post(
      `${BASE_URL}/contacts/search`,
      { locationId: GHL_LOCATION_ID, query: companyName, pageLimit: 5 },
      { headers: ghlHeaders(), timeout: 30000 }
    );
    const contacts = (resp.data as any)?.contacts ?? [];
    return contacts[0] ?? null;
  } catch (err: any) {
    console.error(`GHL search failed for "${companyName}":`, err.response?.data ?? err.message);
    return undefined; // signal error (vs. null = no match)
  }
}

async function existsInGHL(companyName: string): Promise<boolean> {
  const contact = await findContactByName(companyName);
  if (contact === undefined) return true; // search errored — err on side of NOT creating a duplicate
  return contact !== null;
}

// ─── Step 3: Create contact ─────────────────────────────────────────────────

async function createGHLContact(p: Prospect): Promise<boolean> {
  try {
    await axios.post(
      `${BASE_URL}/contacts/`,
      {
        locationId: GHL_LOCATION_ID,
        firstName: p.name,
        companyName: p.name,
        phone: p.phone || undefined,
        source: "Auto Prospecting",
        tags: ["Commercial", "Property Manager", "Pipeline Filler"],
      },
      { headers: ghlHeaders(), timeout: 30000 }
    );

    // Add a note with the extra discovered details (separate call, since
    // notes aren't part of contact creation payload)
    // We need the contact ID — re-search for it.
    const contact = await findContactByName(p.name);
    if (contact?.id) {
      await axios.post(
        `${BASE_URL}/contacts/${contact.id}/notes`,
        {
          body: `Auto-discovered via pipeline filler script.\nCategory: ${p.category}\nAddress: ${p.address || "unknown"}\nWebsite: ${p.website || "unknown"}`,
        },
        { headers: ghlHeaders(), timeout: 30000 }
      );
    }

    return true;
  } catch (err) {
    console.error(`Failed to create contact for "${p.name}":`, (err as Error).message);
    return false;
  }
}

// ─── Step 4: Logging (summary) ──────────────────────────────────────────────

function writeLog(entry: {
  timestamp: string;
  query: string;
  found: number;
  created: string[];
  skippedDuplicates: number;
  skippedCap: number;
}) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, "prospecting.log");
  const lines = [
    `=== Run: ${entry.timestamp} ===`,
    `Search query: ${entry.query}`,
    `Companies found: ${entry.found}`,
    `Companies created (${entry.created.length}): ${entry.created.join(", ") || "none"}`,
    `Skipped as duplicates: ${entry.skippedDuplicates}`,
    `Skipped due to 25/run cap: ${entry.skippedCap}`,
    "",
  ];
  fs.appendFileSync(logFile, lines.join("\n"));
  console.log(lines.join("\n"));
}

// ─── Main run ────────────────────────────────────────────────────────────────

export async function runProspectingJob(): Promise<void> {
  const timestamp = new Date().toISOString();
  const query = pickQueryForRun();
  console.log(`[${timestamp}] Starting prospecting run with query: "${query}"`);

  const prospects = await searchGoogleMaps(query);
  console.log(`Found ${prospects.length} raw results.`);

  const created: string[] = [];
  let skippedDuplicates = 0;
  let skippedCap = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const p of prospects) {
    if (created.length >= MAX_NEW_CONTACTS_PER_RUN) {
      skippedCap++;
      continue;
    }
    await sleep(600); // throttle to avoid GHL 429 rate limits
    const exists = await existsInGHL(p.name);
    if (exists) {
      skippedDuplicates++;
      continue;
    }
    await sleep(600);
    const ok = await createGHLContact(p);
    if (ok) created.push(`${p.name} (${p.phone || "no phone"})`);
  }

  writeLog({
    timestamp,
    query,
    found: prospects.length,
    created,
    skippedDuplicates,
    skippedCap,
  });

  console.log(
    `[${timestamp}] Done. Created ${created.length}, skipped ${skippedDuplicates} duplicates, ${skippedCap} over cap.`
  );
  console.log(
    "REMINDER: New contacts are tagged 'Pipeline Filler' for manual review. Automation 12 was NOT triggered automatically."
  );
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

if (process.env.RUN_PROSPECTING_NOW === "true") {
  runProspectingJob().catch((err) => console.error("Prospecting job failed:", err));
}

// Mon and Thu at 8:00 AM server time
cron.schedule("0 8 * * 1,4", () => {
  runProspectingJob().catch((err) => console.error("Prospecting job failed:", err));
});

console.log("Prospecting scheduler started. Next runs: Mondays and Thursdays at 8:00 AM.");
