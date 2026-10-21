import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SUPABASE_URL = process.env.ASTATE_SUPABASE_URL || "https://qebuxmnvgkksueikhxya.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.ASTATE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Gmm2akNrvAWGR_LNXLFwsQ_Rn3EMKEk";
const GATEWAY_URL = SUPABASE_URL + "/functions/v1/property-gateway";
const OUT_DIR = join(process.cwd(), "backups");

function norm(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function redact(text) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email hidden]")
    .replace(/https?:\/\/\S+/gi, "[link hidden]")
    .replace(/(?:\+?91[\s-]*)?[6-9]\d{4}[\s-]?\d{5}/g, "[phone hidden]")
    .replace(/\bwhatsapp\s*(?:me|at|on|number)?\s*[:=-]?\s*\d[\d\s-]{7,}/gi, "WhatsApp [contact hidden]")
    .replace(/\b(?:call|phone|mobile|contact)\s*(?:me|at|on)?\s*[:=-]?\s*\d[\d\s-]{7,}/gi, "[contact hidden]")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function propertyFamily(value) {
  const t = norm(value);
  if (/hotel|resort|motel|lodge|guest house|guesthouse|cafe|café|restaurant|food court/.test(t)) return "hospitality";
  if (/school|college|hospital|clinic|care home/.test(t)) return "institutional";
  if (/farmhouse|farm house/.test(t)) return "farmhouse";
  if (/agricultur|farm land|farmland|orchard|vineyard/.test(t)) return "agricultural";
  if (/warehouse|godown|logistics shed/.test(t)) return "warehouse";
  if (/industrial|factory|manufacturing|industrial shed/.test(t)) return "industrial";
  if (/commercial|shop|office|retail|showroom|mall|business park|coworking/.test(t)) return "commercial";
  if (/residential|flat|apartment|house|bungalow|villa|row house|townhouse|penthouse/.test(t)) return "residential";
  if (/building|complex|tower|society|premises/.test(t)) return "building";
  if (/plot|land parcel|\bland\b|estate|\bacres?\b/.test(t)) return "land";
  return "";
}

function isAllowedRecord(item) {
  const side = norm(item.listingType).toUpperCase();
  if (!["BUY", "SELL"].includes(side)) return false;
  const text = [item.title, item.propertyType, item.landUse, item.description].filter(Boolean).join(" ");
  const family = propertyFamily([item.propertyType, item.landUse].filter(Boolean).join(" "));
  const anchor = /\b(real estate|property|properties|land|plot|plots|acre|acres|hectare|guntha|guntas|house|home|bungalow|villa|flat|apartment|building|complex|tower|farmhouse|farm house|farm land|farmland|agricultural land|warehouse|godown|industrial shed|industrial property|commercial property|office space|office building|shop|showroom|retail space|hotel|resort|motel|lodge|guest house|guesthouse|cafe|café|restaurant|food court|school building|college building|hospital building|clinic building|mall|business park|factory building|residential|commercial|industrial|institutional|premises|realty|housing society|row house|townhouse|penthouse|hostel|pg accommodation|parking space|rental property|lease property|to let)\b/i.test(text);
  const unrelated = /\b(pharma|pharmaceuticals?|medicines?|cosmetics?|beauty products?|chemical products?|chemicals?|software products?|gadgets?|laptops?|phones for sale|electronics|technology products?|tech products?|crypto|stocks for sale|fertilizers?|pesticides?|supplements?)\b/i.test(text);
  const explicitProperty = Boolean(family) || /\b(house|home|bungalow|villa|flat|apartment|building|land|plot|farmhouse|warehouse|godown|office space|shop space|hotel building|resort property|cafe premises|restaurant premises|industrial shed|commercial unit|residential unit|real estate)\b/i.test(text);
  return anchor && (!unrelated || explicitProperty);
}

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      const error = new Error("Astate gateway returned " + response.status + ": " + (data.error || "request failed"));
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (error?.name !== "AbortError" && !String(error).includes("fetch failed"))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 300 * attempt));
  }
  throw lastError || new Error("Public listing export failed.");
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("Astate public gateway configuration is missing.");
  const result = await fetchJson(GATEWAY_URL, {
    method: "GET",
    headers: { "apikey": SUPABASE_PUBLISHABLE_KEY, "Accept": "application/json" }
  });
  if (result.ok !== true || !Array.isArray(result.listings)) {
    throw new Error("Astate gateway returned an invalid public-feed payload.");
  }
  const rows = [];
  for (const item of result.listings) {
    const status = norm(item.listingStatus || "published");
    if (!["published", "live", "active"].includes(status) || !isAllowedRecord(item)) continue;
    rows.push({
      reference: redact(item.publicId || item.slug || ""),
      title: redact(item.title || ""),
      listingType: redact(item.listingType || ""),
      propertyType: redact(item.propertyType || ""),
      city: redact(item.city || ""),
      locality: redact(item.locality || ""),
      district: redact(item.district || ""),
      state: redact(item.state || ""),
      areaValue: item.areaValue ?? null,
      areaUnit: redact(item.areaUnit || ""),
      priceINR: item.priceINR ?? null,
      budgetMinINR: item.budgetMinINR ?? null,
      budgetMaxINR: item.budgetMaxINR ?? null,
      landUse: redact(item.landUse || ""),
      roadAccess: redact(item.roadAccess || ""),
      description: redact(item.description || ""),
      listingStatus: redact(item.listingStatus || "published"),
      source: redact(item.source || "Astate public listing"),
      lastReviewed: item.lastReviewed || null
    });
  }
  const exportedAt = new Date().toISOString();
  const safe = {
    schema: "urn:astate:public-listings-backup:v1",
    exportedAt,
    count: rows.length,
    privacy: "Published public fields only. Private raw submissions, IP fingerprints, and contact details are not included.",
    listings: rows
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "public-listings.json"), JSON.stringify(safe, null, 2) + "\n", "utf8");
  const fields = Object.keys(rows[0] || {
    reference: "", title: "", listingType: "", propertyType: "", city: "", locality: "", district: "", state: "",
    areaValue: null, areaUnit: "", priceINR: null, budgetMinINR: null, budgetMaxINR: null, landUse: "",
    roadAccess: "", description: "", listingStatus: "", source: "", lastReviewed: null
  });
  const csvCell = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
  const csv = "\ufeff" + [fields.map(csvCell).join(","), ...rows.map(row => fields.map(field => csvCell(row[field])).join(","))].join("\r\n");
  await writeFile(join(OUT_DIR, "public-listings.csv"), csv, "utf8");
  console.log(JSON.stringify({ exportedAt, count: rows.length, json: "backups/public-listings.json", csv: "backups/public-listings.csv" }));
}

main().catch(error => {
  console.error("Public listing export failed:", error?.message || error);
  process.exitCode = 1;
});
