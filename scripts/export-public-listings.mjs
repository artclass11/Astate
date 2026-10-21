import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = "https://www.wixapis.com";
const CLIENT_ID = process.env.ASTATE_WIX_CLIENT_ID || "96489451-651f-4da0-b2fc-2f6047202f23";
const COLLECTION = "propertyListings";
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
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
        throw new Error("Wix API returned " + response.status + ": " + (data.message || "request failed"));
      }
      lastError = new Error("Temporary Wix API status " + response.status);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (error?.name !== "AbortError" && !String(error).includes("fetch failed"))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 300 * attempt));
  }
  throw lastError || new Error("Public listing export failed.");
}

async function main() {
  if (!CLIENT_ID) throw new Error("ASTATE_WIX_CLIENT_ID is missing.");
  const tokenData = await fetchJson(API_BASE + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, grantType: "anonymous" })
  });
  if (!tokenData.access_token) throw new Error("Wix returned no anonymous visitor token.");
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const result = await fetchJson(API_BASE + "/wix-data/v2/items/query", {
      method: "POST",
      headers: { "Authorization": tokenData.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({
        dataCollectionId: COLLECTION,
        query: { filter: {}, paging: { limit: 100, offset } },
        returnTotalCount: false
      })
    });
    const items = Array.isArray(result.dataItems) ? result.dataItems.map(row => row.data || row) : [];
    for (const item of items) {
      const status = norm(item.listingStatus || "published");
      if (!["published", "live", "active"].includes(status) || !isAllowedRecord(item)) continue;
      rows.push({
        reference: String(item.publicId || item.slug || item._id || ""),
        title: String(item.title || ""),
        listingType: String(item.listingType || ""),
        propertyType: String(item.propertyType || ""),
        city: String(item.city || ""),
        locality: String(item.locality || ""),
        district: String(item.district || ""),
        state: String(item.state || ""),
        areaValue: item.areaValue ?? null,
        areaUnit: String(item.areaUnit || ""),
        priceINR: item.priceINR ?? null,
        budgetMinINR: item.budgetMinINR ?? null,
        budgetMaxINR: item.budgetMaxINR ?? null,
        landUse: String(item.landUse || ""),
        roadAccess: String(item.roadAccess || ""),
        description: redact(item.description || ""),
        listingStatus: String(item.listingStatus || "published"),
        source: String(item.source || "Astate public listing"),
        lastReviewed: item.lastReviewed || null
      });
    }
    const hasNext = typeof result.pagingMetadata?.hasNext === "boolean"
      ? result.pagingMetadata.hasNext
      : items.length === 100;
    if (!hasNext || items.length === 0) break;
  }
  const exportedAt = new Date().toISOString();
  const safe = { schema: "urn:astate:public-listings-backup:v1", exportedAt, count: rows.length, privacy: "Public fields only. Private intake records and contact details are not included.", listings: rows };
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
  console.log(JSON.stringify({ exportedAt, count: rows.length, files: ["backups/public-listings.json", "backups/public-listings.csv"], privateIntakesIncluded: false }));
}

main().catch(error => {
  console.error("Astate public backup export failed:", error?.message || error);
  process.exitCode = 1;
});
