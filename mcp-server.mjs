import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SITE_URL = process.env.ASTATE_SITE_URL || "https://headless-jcrzxssmnuf-myastate-1408.wix-site-host.com";
const API_BASE = "https://www.wixapis.com";
const CLIENT_ID = process.env.ASTATE_WIX_CLIENT_ID || "96489451-651f-4da0-b2fc-2f6047202f23";
let tokenCache = { value: "", expiresAt: 0 };
let listingCache = { value: null, expiresAt: 0 };

const server = new McpServer({
  name: "astate-property-match",
  version: "1.0.0",
});

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function redactPublicContacts(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[email hidden]")
    .replace(/https?:\\/\\/\\S+/gi, "[link hidden]")
    .replace(/(?:\\+?91[\\s-]*)?[6-9]\\d{4}[\\s-]?\\d{5}/g, "[phone hidden]")
    .replace(/\\bwhatsapp\\s*(?:me|at|on|number)?\\s*[:=-]?\\s*\\d[\\d\\s-]{7,}/gi, "WhatsApp [contact hidden]")
    .replace(/\\b(?:call|phone|mobile|contact)\\s*(?:me|at|on)?\\s*[:=-]?\\s*\\d[\\d\\s-]{7,}/gi, "[contact hidden]")
    .replace(/[ \\t]{2,}/g, " ").trim();
}

function isRealEstateRecord(item) {
  const type = norm(item?.listingType).toUpperCase();
  if (type !== "BUY" && type !== "SELL") return false;
  const allText = [item?.title, item?.propertyType, item?.landUse, item?.description].filter(Boolean).join(" ");
  const propertyAnchor = /\\b(real estate|property|properties|land|plot|plots|acre|acres|hectare|guntha|guntas|house|home|bungalow|villa|flat|apartment|building|complex|tower|farmhouse|farm house|farm land|farmland|agricultural land|warehouse|godown|industrial shed|industrial property|commercial property|office space|office building|shop|showroom|retail space|hotel|resort|motel|lodge|guest house|guesthouse|cafe|café|restaurant|food court|school building|college building|hospital building|clinic building|mall|business park|factory building|residential|commercial|industrial|institutional|premises|realty|housing society|row house|townhouse|penthouse|hostel|pg accommodation|parking space|rental property|lease property|property for rent|shop for rent|office for rent|to let)\\b/i.test(allText);
  const explicitAsset = Boolean(propertyFamily([item?.propertyType, item?.landUse].filter(Boolean).join(" "))) ||
    /\\b(house|home|bungalow|villa|flat|apartment|building|land|plot|farmhouse|warehouse|godown|office space|shop space|hotel building|resort property|cafe premises|restaurant premises|industrial shed|commercial unit|residential unit|real estate)\\b/i.test(allText);
  const unrelatedProduct = /\\b(pharma|pharmaceuticals?|medicines?|cosmetics?|beauty products?|chemical products?|chemicals?|software products?|gadgets?|laptops?|phones for sale|electronics|technology products?|tech products?|crypto|stocks for sale|fertilizers?|pesticides?|supplements?)\\b/i.test(allText);
  return propertyAnchor && (!unrelatedProduct || explicitAsset);
}

function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function parseAmount(text) {
  const t = norm(text).replace(/,/g, "");
  let m = t.match(/(?:₹|rs\.?\s*)\s*([0-9]+(?:\.[0-9]+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|thousand|k)?\b/i);
  if (m) {
    const factor = /^(crore|crores|cr)$/i.test(m[2] || "") ? 1e7 :
      /^(lakh|lakhs|lac|lacs|l)$/i.test(m[2] || "") ? 1e5 :
      /^(thousand|k)$/i.test(m[2] || "") ? 1e3 : 1;
    const value = Number(m[1]) * factor;
    if (Number.isFinite(value) && (m[2] || value >= 10000)) return value;
  }
  m = t.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|thousand|k)\b/i);
  if (!m) return null;
  const unit = norm(m[2]);
  const factor = /^(crore|crores|cr)$/.test(unit) ? 1e7 :
    /^(lakh|lakhs|lac|lacs|l)$/.test(unit) ? 1e5 : 1e3;
  return Number(m[1]) * factor;
}

function parseArea(text) {
  const m = norm(text).replace(/,/g, "").match(/\b([0-9]+(?:\.[0-9]+)?)\s*(acres?|ac|hectares?|ha|gunthas?|guntas?|sq\.?\s*ft|sqft|square feet|sq\.?\s*m|sqm|square metres?|square meters?)\b/i);
  if (!m) return null;
  const unitText = norm(m[2]);
  const unit = /^(acre|acres|ac)$/.test(unitText) ? "acre" :
    /hectare|^ha$/.test(unitText) ? "hectare" :
    /guntha|gunta/.test(unitText) ? "guntha" :
    /sq\.?\s*ft|sqft|square feet/.test(unitText) ? "sq ft" : "sq m";
  const factor = unit === "acre" ? 4046.8564224 : unit === "hectare" ? 10000 :
    unit === "guntha" ? 101.17141056 : unit === "sq ft" ? 0.09290304 : 1;
  return { value: Number(m[1]), unit, sqM: Number(m[1]) * factor };
}

function propertyFamily(text) {
  const t = norm(text);
  if (/agricultur|farm land|farmland|orchard|vineyard/.test(t)) return "agricultural";
  if (/farmhouse|farm house/.test(t)) return "farmhouse";
  if (/hotel|resort|motel|lodge|guest house|guesthouse|cafe|café|restaurant|food court/.test(t)) return "hospitality";
  if (/school|college|hospital|clinic|care home/.test(t)) return "institutional";
  if (/warehouse|godown|logistics shed/.test(t)) return "warehouse";
  if (/industrial|factory|manufacturing|industrial shed/.test(t)) return "industrial";
  if (/commercial|shop|office|retail|showroom|mall|business park/.test(t)) return "commercial";
  if (/residential|flat|apartment|house|bungalow|villa|row house|townhouse|penthouse/.test(t)) return "residential";
  if (/building|complex|tower|society|premises/.test(t)) return "building";
  if (/plot|land parcel|\bland\b|estate|\bacres?\b/.test(t)) return "land";
  return "";
}

function detectIntent(text) {
  const t = norm(text);
  if (/\b(sell|selling|seller|for sale|available for sale|want to sell|looking to sell|rent out|renting out|for rent|available for rent|to let|lease out)\b/.test(t)) return "SELL";
  if (/\b(buy|buying|buyer|looking for|looking to buy|want to buy|want to purchase|need|seeking|searching|purchase|budget|required|looking to rent|want to rent|lease a)\b/.test(t)) return "BUY";
  return "BUY";
}

function cityFrom(text) {
  const cities = [
    "Chhatrapati Sambhajinagar", "Navi Mumbai", "Ahmednagar", "Ahilyanagar", "Aurangabad",
    "Bengaluru", "Hyderabad", "Kolhapur", "Nashik", "Nagpur", "Mumbai", "Pune", "Thane",
    "Sangli", "Satara", "Dhule", "Jalgaon", "Solapur", "Raigad", "Palghar", "Ratnagiri",
    "Amravati", "Nanded", "Latur", "Indore", "Surat", "Delhi", "Chennai", "Kolkata",
    "Jaipur", "Lucknow", "Goa", "Vadodara", "Rajkot", "Noida", "Gurugram", "Mysuru"
  ];
  const t = norm(text);
  return cities.find(city => t.includes(norm(city))) || "";
}

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const response = await fetchWithTimeout(API_BASE + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, grantType: "anonymous" }),
  }, 12000);
  if (!response.ok) throw new Error("Astate public data token request failed (" + response.status + ").");
  const body = await response.json();
  if (!body.access_token) throw new Error("Astate returned no public data token.");
  tokenCache = { value: body.access_token, expiresAt: Date.now() + Math.max(60000, ((body.expires_in || 300) - 45) * 1000) };
  return tokenCache.value;
}

async function getListings(force = false) {
  if (!force && listingCache.value && Date.now() < listingCache.expiresAt) return listingCache.value;
  const stale = listingCache.value;
  try {
  const token = await getToken();
  const all = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const response = await fetchWithTimeout(API_BASE + "/wix-data/v2/items/query", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        dataCollectionId: "propertyListings",
        query: { filter: {}, paging: { limit: 100, offset } },
        returnTotalCount: false,
      }),
    }, 15000);
    if (!response.ok) throw new Error("Astate public listing query failed (" + response.status + ").");
    const result = await response.json();
    const rows = Array.isArray(result.dataItems) ? result.dataItems : [];
    for (const row of rows) {
      const item = row.data || row;
      const status = norm(item.listingStatus || "published");
      if (["published", "live", "active"].includes(status) && isRealEstateRecord(item)) all.push(item);
    }
    const hasNext = typeof result.pagingMetadata?.hasNext === "boolean" ? result.pagingMetadata.hasNext : rows.length === 100;
    if (!hasNext || rows.length === 0) break;
  }
  listingCache = { value: all, expiresAt: Date.now() + 60000 };
  return all;
  } catch (error) {
    // Search can continue during a temporary Wix outage using the most recent successful snapshot.
    if (Array.isArray(stale) && stale.length > 0) return stale;
    throw error;
  }
}

function textOverlap(query, item) {
  const hay = norm([
    item.title, item.description, item.propertyType, item.city, item.locality,
    item.district, item.state, item.landUse, item.roadAccess, item.publicId
  ].join(" "));
  const words = norm(query).split(/[^\p{L}\p{N}]+/u).filter(word =>
    word.length > 2 && !["buy", "sell", "want", "need", "looking", "property", "please", "find", "match", "with", "for", "the", "and", "under", "below"].includes(word));
  if (!words.length) return 0;
  return words.reduce((sum, word) => sum + (hay.includes(word) ? 1 : 0), 0) / words.length;
}

function matchScore(query, item) {
  const q = norm(query);
  const intent = detectIntent(query);
  const candidateType = norm(item.listingType);
  const oppositeSide = intent === "BUY" ? "sell" : "buy";
  if (candidateType && candidateType !== (intent === "BUY" ? "sell" : "buy")) return null;
  const qCity = cityFrom(query);
  const itemCity = String(item.city || item.district || "");
  const qType = propertyFamily(query);
  const itemType = propertyFamily([item.propertyType, item.landUse].filter(Boolean).join(" "));
  const amount = parseAmount(query);
  const area = parseArea(query);
  const reasons = [];
  const caveats = [];
  let score = 0;
  let total = 0;
  let hardConflict = false;
  const add = (weight, ratio, reason, isCaveat = false) => {
    score += weight * ratio;
    total += weight;
    if (isCaveat) caveats.push(reason); else reasons.push(reason);
  };

  if (qCity) {
    if (norm(itemCity).includes(norm(qCity)) || norm([item.locality, item.city, item.district, item.state].join(" ")).includes(norm(qCity))) add(32, 1, "Location matches");
    else if (itemCity) { add(32, 0, "Different city/region", true); hardConflict = true; }
    else add(32, 0.3, "Location not fully stated", true);
  }
  if (qType) {
    if (qType === itemType) add(22, 1, "Property class matches");
    else if (!itemType) add(22, 0.35, "Property class not stated", true);
    else if (qType === "land" && ["agricultural", "commercial", "residential", "industrial"].includes(itemType)) add(22, 0.75, "Land category broadly aligns");
    else if (qType === "commercial" && ["building", "hospitality", "warehouse"].includes(itemType)) add(22, 0.7, "Commercial building/property may fit");
    else { add(22, 0, "Property class differs", true); hardConflict = true; }
  }
  if (amount) {
    const stated = Number(item.priceINR || item.budgetMaxINR || 0);
    if (stated > 0) {
      const itemIsOffer = candidateType === "sell";
      const compatible = itemIsOffer ? stated <= amount : stated >= amount;
      if (compatible) add(23, 1, "Price/budget fits");
      else {
        const close = itemIsOffer ? stated <= amount * 1.08 : stated >= amount * 0.92;
        add(23, close ? 0.45 : 0, close ? "Price is close; confirm negotiability" : "Budget/asking price conflicts", true);
        if (!close) hardConflict = true;
      }
    } else add(23, 0.3, "Price/budget not stated", true);
  }
  if (area) {
    const itemValue = Number(item.areaValue || 0);
    const unit = norm(item.areaUnit || "sq m");
    const factor = /acre/.test(unit) ? 4046.8564224 : /hectare|^ha$/.test(unit) ? 10000 : /guntha|gunta/.test(unit) ? 101.17141056 : /sq\s*ft|sqft|square feet/.test(unit) ? 0.09290304 : 1;
    if (itemValue > 0 && area.sqM > 0) {
      const itemSqM = itemValue * factor;
      const itemIsOffer = candidateType === "sell";
      // Buyer query -> candidate is an offer: it must meet or exceed the requested area.
      // Seller query -> candidate is a buyer requirement: it must fit within available area.
      const ratio = itemIsOffer ? itemSqM / area.sqM : area.sqM / itemSqM;
      let fit;
      let reason;
      if (itemIsOffer) {
        fit = ratio >= 0.9 ? 1 : ratio >= 0.75 ? 0.7 : ratio >= 0.5 ? 0.4 : 0.15;
        reason = ratio >= 0.9 ? "Offer area meets the requested area" : "Offer area is smaller than requested";
      } else {
        fit = ratio >= 0.95 ? 1 : ratio >= 0.8 ? 0.65 : ratio >= 0.67 ? 0.35 : 0.1;
        reason = ratio >= 0.95 ? "Buyer need fits within available area" : "Buyer may need more area than offered";
      }
      add(15, fit, reason, fit < 0.7);
    } else add(15, 0.3, "Area not stated", true);
  }
  const overlap = textOverlap(query, item);
  add(8, overlap, overlap >= 0.5 ? "Description aligns with request" : "Description overlap is limited", overlap < 0.5);
  if (!total) return null;
  const finalScore = Math.round((score / total) * 100);
  if (hardConflict || finalScore < 35) return null;
  return {
    reference: item.publicId || item.slug || item._id || "",
    score: finalScore,
    title: item.title || item.propertyType || "Property listing",
    listingType: item.listingType,
    propertyType: item.propertyType || "",
    location: [item.locality, item.city, item.district, item.state].filter(Boolean).join(", "),
    area: item.areaValue ? String(item.areaValue) + " " + (item.areaUnit || "") : "Not stated",
    priceINR: item.priceINR ?? null,
    budgetMaxINR: item.budgetMaxINR ?? null,
    reasons: reasons.slice(0, 4),
    caveats: caveats.slice(0, 3),
    description: redactPublicContacts(item.description || ""),
  };
}

server.tool(
  "search_properties",
  {
    query: z.string().min(2).max(500).describe("Search for public real-estate offers or buyer requirements by location, property class, area, budget or phrase."),
    limit: z.number().int().min(1).max(25).optional().describe("Maximum results (1–25). Default 10."),
  },
  async ({ query, limit = 10 }) => {
    try {
      const items = await getListings();
      const q = norm(query);
      const ranked = items
        .map(item => ({ item, overlap: textOverlap(q, item) }))
        .filter(row => row.overlap > 0 || norm([row.item.city, row.item.propertyType, row.item.title].join(" ")).includes(q))
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, limit)
        .map(row => ({
          reference: row.item.publicId || row.item.slug || row.item._id || "",
          title: row.item.title || row.item.propertyType || "Property listing",
          listingType: row.item.listingType || "",
          propertyType: row.item.propertyType || "",
          location: [row.item.locality, row.item.city, row.item.district, row.item.state].filter(Boolean).join(", "),
          area: row.item.areaValue ? String(row.item.areaValue) + " " + (row.item.areaUnit || "") : "Not stated",
          priceINR: row.item.priceINR ?? null,
          budgetMaxINR: row.item.budgetMaxINR ?? null,
          description: redactPublicContacts(row.item.description || ""),
          textOverlap: Math.round(row.overlap * 100),
        }));
      return { content: [{ type: "text", text: JSON.stringify({ count: ranked.length, source: SITE_URL + "/listings.html", results: ranked }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error.message || error) }] };
    }
  }
);

server.tool(
  "match_buyer_seller",
  {
    message: z.string().min(10).max(1800).describe("Natural-language buyer or seller real-estate requirement, including any stated budget, location and area."),
    limit: z.number().int().min(1).max(10).optional().describe("Maximum matches (1–10). Default 3."),
  },
  async ({ message, limit = 3 }) => {
    try {
      const intent = detectIntent(message);
      const items = await getListings();
      const ranked = items
        .map(item => matchScore(message, item))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { content: [{ type: "text", text: JSON.stringify({
        queryIntent: intent,
        count: ranked.length,
        source: SITE_URL + "/listings.html",
        warning: "Approximate lead matching only; not ownership, title, value, availability or legal verification.",
        matches: ranked
      }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error.message || error) }] };
    }
  }
);

server.tool(
  "get_property_listing",
  {
    reference: z.string().min(2).max(100).describe("Astate public reference such as AS-... or the listing slug."),
  },
  async ({ reference }) => {
    try {
      const items = await getListings();
      const item = items.find(row => [row.publicId, row.slug, row._id].some(value => norm(value) === norm(reference)));
      if (!item) return { content: [{ type: "text", text: JSON.stringify({ found: false, reference, message: "No published public listing was found for that reference." }) }] };
      const safe = {
        found: true,
        reference: item.publicId || item.slug || item._id,
        title: item.title || "",
        listingType: item.listingType || "",
        propertyType: item.propertyType || "",
        location: [item.locality, item.city, item.district, item.state].filter(Boolean).join(", "),
        areaValue: item.areaValue ?? null,
        areaUnit: item.areaUnit || "",
        priceINR: item.priceINR ?? null,
        budgetMinINR: item.budgetMinINR ?? null,
        budgetMaxINR: item.budgetMaxINR ?? null,
        landUse: item.landUse || "",
        roadAccess: item.roadAccess || "",
        description: redactPublicContacts(item.description || ""),
        source: item.source || "Astate public listing",
      };
      return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error.message || error) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
