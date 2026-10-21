(() => {
  'use strict';
  const cfg = window.ASTATE_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  let cachedToken = null;
  let listingsCache = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function normalize(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('The data service took too long to respond. Please retry.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 'Price not stated';
    if (n >= 10000000) return '₹' + (n / 10000000).toLocaleString('en-IN', {maximumFractionDigits:2}) + ' crore';
    if (n >= 100000) return '₹' + (n / 100000).toLocaleString('en-IN', {maximumFractionDigits:2}) + ' lakh';
    return '₹' + n.toLocaleString('en-IN', {maximumFractionDigits:0});
  }
  function areaLabel(item) {
    const n = Number(item.areaValue);
    return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-IN')} ${item.areaUnit || ''}`.trim() : 'Area not stated';
  }
  function prettyType(item) {
    const type = String(item.listingType || '').toUpperCase();
    if (type === 'SELL') return 'PROPERTY OFFER';
    if (type === 'BUY') return 'BUYER REQUIREMENT';
    return 'PROPERTY LISTING';
  }
  function listingCard(item) {
    const ref = item.publicId || item.slug || item._id || 'ASTATE';
    const price = item.listingType === 'BUY' && item.budgetMaxINR ? `Budget up to ${money(item.budgetMaxINR)}` : money(item.priceINR);
    const place = [item.locality, item.city, item.district, item.state].filter(Boolean).join(', ');
    const summary = redactPublicContacts(item.description || item.landUse || 'Details available in the listing record.');
    return `<article class="listing-card"><div class="listing-card-top"><span class="pill ${item.listingType === 'BUY' ? 'pill-buy' : ''}">${escapeHtml(prettyType(item))}</span><span class="listing-ref">${escapeHtml(ref)}</span></div><h3>${escapeHtml(item.title || `${item.propertyType || 'Property'} in ${item.city || 'Maharashtra'}`)}</h3><div class="listing-place">⌖ ${escapeHtml(place || 'Location not specified')}</div><div class="listing-facts"><span><small>TYPE</small>${escapeHtml(item.propertyType || 'Not stated')}</span><span><small>AREA</small>${escapeHtml(areaLabel(item))}</span></div><div class="listing-price">${escapeHtml(price)}</div><p class="listing-description">${escapeHtml(summary)}</p>${item.roadAccess ? `<div class="listing-extra">Access: ${escapeHtml(item.roadAccess)}</div>` : ''}<div class="listing-card-bottom"><span>Public community listing</span><span class="contact-links"><a href="https://www.instagram.com/amormagics/" target="_blank" rel="noopener" aria-label="Ask about reference ${escapeHtml(ref)} via amormagics">@amormagics ↗</a><a href="https://www.instagram.com/arcstudio91/" target="_blank" rel="noopener" aria-label="Ask about reference ${escapeHtml(ref)} via arcstudio91">@arcstudio91 ↗</a></span></div></article>`;
  }
  async function getToken() {
    if (cachedToken) return cachedToken;
    const res = await fetchWithTimeout(`${cfg.apiBase}/oauth2/token`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({clientId:cfg.wixClientId, grantType:'anonymous'})}, 12000);
    if (!res.ok) throw new Error(`Secure data connection could not start (${res.status}).`);
    const json = await res.json();
    if (!json.access_token) throw new Error('No visitor access token was returned.');
    cachedToken = json.access_token;
    return cachedToken;
  }
  async function apiPost(path, body) {
    const token = await getToken();
    const res = await fetchWithTimeout(`${cfg.apiBase}${path}`, {method:'POST', headers:{'Authorization':token,'Content-Type':'application/json'}, body:JSON.stringify(body)}, 15000);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.message || json?.details?.applicationError?.description || `Wix request failed (${res.status}).`;
      throw new Error(msg);
    }
    return json;
  }
  async function fetchListings(force = false) {
    if (listingsCache && !force) return listingsCache;
    const all = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const response = await apiPost('/wix-data/v2/items/query', {dataCollectionId:cfg.publicCollection, query:{filter:{}, paging:{limit:100, offset}}, returnTotalCount:false});
      const rows = Array.isArray(response.dataItems) ? response.dataItems : [];
      for (const row of rows) {
        const item = row.data || row;
        const status = normalize(item.listingStatus || 'published');
        if ((status === 'published' || status === 'live' || status === 'active') && validateRealEstateRecord(item)) all.push(item);
      }
      const meta = response.pagingMetadata || {};
      const next = typeof meta.hasNext === 'boolean' ? meta.hasNext : rows.length === 100;
      if (!next || rows.length === 0) break;
    }
    listingsCache = all;
    return all;
  }
  function setListingError(target, message) {
    if (target) target.innerHTML = `<div class="empty-card"><span class="empty-mark">!</span><h3>Data isn't available right now.</h3><p>${escapeHtml(message)}</p><p class="micro-copy">Please retry, or contact <a href="https://www.instagram.com/amormagics/" target="_blank" rel="noopener">@amormagics</a> or <a href="https://www.instagram.com/arcstudio91/" target="_blank" rel="noopener">@arcstudio91</a>.</p></div>`;
  }
  function emptyListings(label = 'No published listings yet.') {
    return `<div class="empty-card"><span class="empty-mark">—</span><h3>${escapeHtml(label)}</h3><p>New property posts appear here automatically. Personal phone numbers and email addresses are stripped from public listing text. This directory doesn't use fake/sample property data.</p><a class="text-link" href="submit.html">Submit a requirement or offer ↗</a></div>`;
  }
  function renderHomeListings(items) {
    const target = $('#homeListings'); if (!target) return;
    const chosen = items.slice(0, 3);
    target.innerHTML = chosen.length ? chosen.map(listingCard).join('') : emptyListings();
  }
  function renderListings(items) {
    const target = $('#listingGrid'); if (!target) return;
    const search = normalize($('#listingSearch')?.value || '');
    const kind = $('#listingType')?.value || 'ALL';
    const prop = normalize($('#propertyType')?.value || 'ALL');
    const filtered = items.filter(item => {
      const hay = normalize([item.title,item.description,item.propertyType,item.city,item.locality,item.district,item.state,item.landUse,item.publicId].join(' '));
      return (!search || hay.includes(search)) && (kind === 'ALL' || item.listingType === kind) && (prop === 'all' || normalize(item.propertyType) === prop || (prop === 'plot / land' && /plot|land/.test(normalize(item.propertyType))));
    });
    const count = $('#listingCount'); if (count) count.textContent = `${filtered.length} published record${filtered.length === 1 ? '' : 's'}`;
    target.innerHTML = filtered.length ? filtered.map(listingCard).join('') : emptyListings(search || kind !== 'ALL' || prop !== 'all' ? 'No listing matches these filters yet.' : 'No published listings yet.');
  }
  function parseAmount(text) {
    const t = normalize(text).replace(/,/g, '');
    const factorFor = unit => {
      const u = normalize(unit || '');
      if (/^(crore|crores|cr)$/.test(u)) return 10000000;
      if (/^(lakh|lakhs|lac|lacs|l)$/.test(u)) return 100000;
      if (/^(thousand|k)$/.test(u)) return 1000;
      return 1;
    };
    let m = t.match(/(?:₹|rs\.?\s*)\s*([0-9]+(?:\.[0-9]+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|thousand|k)?\b/);
    if (m) {
      const n = Number(m[1]) * factorFor(m[2]);
      if (Number.isFinite(n) && (m[2] || n >= 10000)) return n;
    }
    m = t.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|thousand|k)\b/);
    if (m) return Number(m[1]) * factorFor(m[2]);
    m = t.match(/\b(?:under|below|upto|up to|budget(?: of)?|maximum|max|at most|not more than|less than|for|asking|price(?: of)?|worth)\s*(?:₹|rs\.?\s*)?([0-9]{5,})\b/);
    if (m) return Number(m[1]);
    return null;
  }
  function parseArea(text) {
    const t = normalize(text).replace(/,/g, '');
    const m = t.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(acres?|ac|hectares?|ha|gunthas?|guntas?|sq\.?\s*ft|sqft|square feet|sq\.?\s*m|sqm|square metres?|square meters?)\b/);
    if (!m) return null;
    const rawUnit = normalize(m[2]);
    let unit = 'sq m';
    if (/^acre|^ac$/.test(rawUnit)) unit = 'acre';
    else if (/hectare|^ha$/.test(rawUnit)) unit = 'hectare';
    else if (/guntha|gunta/.test(rawUnit)) unit = 'guntha';
    else if (/sq\.?\s*ft|sqft|square feet/.test(rawUnit)) unit = 'sq ft';
    const value = Number(m[1]);
    const factors = { 'sq m': 1, 'sq ft': 0.09290304, acre: 4046.8564224, hectare: 10000, guntha: 101.17141056 };
    return { value, unit, sqM: value * factors[unit], original: m[0] };
  }
  function itemArea(item) {
    const value = Number(item && item.areaValue);
    if (!Number.isFinite(value) || value <= 0) return null;
    const u = normalize(item.areaUnit || 'sq m');
    let unit = 'sq m';
    if (/acre/.test(u)) unit = 'acre';
    else if (/hectare|^ha$/.test(u)) unit = 'hectare';
    else if (/guntha|gunta/.test(u)) unit = 'guntha';
    else if (/sq\s*ft|sqft|square feet/.test(u)) unit = 'sq ft';
    const factors = { 'sq m': 1, 'sq ft': 0.09290304, acre: 4046.8564224, hectare: 10000, guntha: 101.17141056 };
    return { value, unit, sqM: value * factors[unit] };
  }
  function inferType(text) {
    const t = normalize(text);
    if (/hotel|resort|motel|lodge|guest house|guesthouse/.test(t)) return 'Hotel / resort';
    if (/cafe|café|restaurant|eatery|food court/.test(t)) return 'Cafe / restaurant property';
    if (/school|college|hospital|clinic|care home/.test(t)) return 'Institutional building';
    if (/farmhouse|farm house/.test(t)) return 'Farmhouse';
    if (/agricultur|farm land|farmland|agri land|agri-land|vineyard|orchard/.test(t)) return 'Agricultural land';
    if (/warehouse|godown|logistics shed/.test(t)) return 'Warehouse';
    if (/industrial|factory|manufacturing|industrial shed/.test(t)) return 'Industrial';
    if (/commercial|shop|office|retail|showroom|mall|business park|coworking|co-working/.test(t)) return 'Commercial';
    if (/residential|flat|apartment|house|bungalow|villa|row house|townhouse|penthouse/.test(t)) return 'Residential';
    if (/building|complex|tower|society|premises/.test(t)) return 'Building';
    // A bare acreage statement signals land, but does not prove agricultural classification.
    if (/\b[0-9]+(?:[.][0-9]+)?\s*(?:acres?|hectares?|ha|gunthas?|guntas?)\b/.test(t)) return 'Plot / land';
    if (/plot|land parcel|land|estate/.test(t)) return 'Plot / land';
    return '';
  }
  function inferUse(text) {
    const t = normalize(text);
    if (/agricultur|farm land|farmland|orchard|vineyard|irrigat/.test(t)) return 'Agricultural';
    if (/commercial|shop|retail|office/.test(t)) return 'Commercial';
    if (/industrial|factory|warehouse|godown/.test(t)) return 'Industrial';
    if (/residential|housing|home|bungalow|apartment/.test(t)) return 'Residential';
    if (/farmhouse|farm house|weekend home|second home/.test(t)) return 'Farmhouse';
    return '';
  }
  function inferCity(text) {
    const cities = ['Chhatrapati Sambhajinagar','Navi Mumbai','Ahmednagar','Ahilyanagar','Aurangabad','Bengaluru','Hyderabad','Kolhapur','Nashik','Nagpur','Mumbai','Pune','Thane','Sangli','Satara','Dhule','Jalgaon','Solapur','Raigad','Palghar','Ratnagiri','Amravati','Nanded','Latur','Indore','Surat'];
    const t = normalize(text);
    return cities.find(city => t.includes(normalize(city))) || '';
  }
  function inferLocality(text) {
    const places = ['Chakan','Talegaon Dabhade','Lonavala','Pimpri Chinchwad','Nashik Road','Trimbakeshwar','Trimbak','Sinnar','Igatpuri','Dindori','Niphad','Yeola','Malegaon','Ozar','Panchavati','Gangapur Road','Ambad MIDC','Satpur MIDC','Hinjawadi','Wagholi','Hadapsar','Baner','Wakad','Kharadi','Baramati','Shirur','Panhala','Miraj','Tasgaon','Islampur','Karad','Phaltan','Pandharpur'];
    const t = normalize(text);
    return places.find(place => t.includes(normalize(place))) || '';
  }
  function canonicalPlace(value) {
    const t = normalize(value);
    if (/aurangabad|chhatrapati sambhajinagar/.test(t)) return 'chhatrapati sambhajinagar';
    if (/ahmednagar|ahilyanagar/.test(t)) return 'ahilyanagar';
    if (/bombay/.test(t)) return 'mumbai';
    if (/bangalore/.test(t)) return 'bengaluru';
    return t;
  }
  function inferState(text) {
    const t = normalize(text);
    if (/maharashtra|\bmh\b/.test(t)) return 'Maharashtra';
    if (/gujarat/.test(t)) return 'Gujarat';
    if (/madhya pradesh|\bmp\b/.test(t)) return 'Madhya Pradesh';
    if (/karnataka/.test(t)) return 'Karnataka';
    if (/telangana/.test(t)) return 'Telangana';
    return '';
  }
  function detectIntent(text) {
    const t = normalize(text);
    if (/\b(rent out|renting out|available for rent|for rent|to let|let out|lease out|leasing out|my rental property)\b/.test(t)) return 'SELL';
    if (/\b(sell|selling|seller|sell my|sell a|sell an|want to sell|wants to sell|looking to sell|put up for sale|for sale|available for sale|selling price|i own|owner of|my property|my land|my plot|i have a|i have an|offer property|listing my|lease out|rent out)\b/.test(t)) return 'SELL';
    if (/\b(buy|buying|buyer|looking for|looking to buy|want to purchase|want to buy|need to buy|need|seeking|searching|purchase|budget|required|requirement|looking to rent|want to rent|need a rental|looking to lease|rent a|lease a)\b/.test(t)) return 'BUY';
    return 'BUY';
  }

  function validateRealEstateMessage(text) {
    const t = normalize(text);
    if (t.length < 12) return { ok: false, reason: 'Add a little more detail about the property or requirement.' };
    const propertyAnchor = /\b(real estate|property|properties|land|plot|plots|acre|acres|hectare|guntha|guntas|house|home|bungalow|villa|flat|apartment|building|complex|tower|farmhouse|farm house|farm land|farmland|agricultural land|warehouse|godown|industrial shed|industrial property|commercial property|office space|office building|shop|showroom|retail space|hotel|resort|motel|lodge|guest house|guesthouse|cafe|café|restaurant|food court|school building|college building|hospital building|clinic building|mall|business park|factory building|residential|commercial|industrial|institutional|premises|realty|housing society|row house|townhouse|penthouse|hostel|pg accommodation|parking space|rental property|lease property|property for rent|shop for rent|office for rent|to let)\b/.test(t);
    if (!propertyAnchor) return { ok: false, reason: 'Astate accepts real-estate property only. Mention land, a plot, house, flat, villa, farm, building, hotel, resort, cafe/restaurant premises, office, shop, warehouse or another property asset.' };
    const nonPropertyProduct = /\b(pharma|pharmaceuticals?|medicines?|cosmetics?|beauty products?|chemical products?|chemicals?|software products?|gadgets?|laptops?|phones for sale|electronics|technology products?|tech products?|crypto|stocks for sale|fertilizers?|pesticides?|supplements?)\b/.test(t);
    const explicitPropertyAsset = /\b(property|land|plot|house|building|flat|apartment|villa|farmhouse|farm house|warehouse|godown|office space|shop space|hotel building|resort property|cafe premises|restaurant premises|industrial shed|commercial unit|residential unit|premises|real estate)\b/.test(t);
    if (nonPropertyProduct && !explicitPropertyAsset) return { ok: false, reason: 'This looks like a product/business listing rather than a property asset. Astate only accepts real estate.' };
    if (/\b(buy|sell|selling|buying|rent|lease|for sale|looking for|want to|need|available|offer|requirement|property)\b/.test(t) === false) return { ok: false, reason: 'Please state whether the property is for sale/rent or what property you need.' };
    return { ok: true, reason: '' };
  }

  function validateRealEstateRecord(item) {
    const listingType = normalize(item && item.listingType).toUpperCase();
    if (listingType !== 'BUY' && listingType !== 'SELL') return false;
    const text = [item && item.title, item && item.propertyType, item && item.landUse, item && item.description]
      .filter(Boolean).join(' ');
    return validateRealEstateMessage(text).ok;
  }

  function redactPublicContacts(text) {
    return String(text || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden]')
      .replace(/https?:\/\/\S+/gi, '[link hidden]')
      .replace(/(?:\+?91[\s-]*)?[6-9]\d{4}[\s-]?\d{5}/g, '[phone hidden]')
      .replace(/\bwhatsapp\s*(?:me|at|on|number)?\s*[:=-]?\s*\d[\d\s-]{7,}/gi, 'WhatsApp [contact hidden]')
      .replace(/\b(?:call|phone|mobile|contact)\s*(?:me|at|on)?\s*[:=-]?\s*\d[\d\s-]{7,}/gi, '[contact hidden]')
      .replace(/[ \t]{2,}/g, ' ').trim();
  }

  function cleanListingTitle(intent, propertyType, city, locality) {
    const kind = intent === 'SELL' ? 'PROPERTY OFFER' : 'BUYER REQUIREMENT';
    const what = propertyType || 'Property';
    const where = locality || city;
    return (kind + ': ' + what + (where ? ' in ' + where : '')).slice(0, 140);
  }
  function cityForLocality(locality) {
    const key = normalize(locality);
    const map = {
      'sinnar':'Nashik','nashik road':'Nashik','trimbakeshwar':'Nashik','trimbak':'Nashik','igatpuri':'Nashik','dindori':'Nashik','niphad':'Nashik','yeola':'Nashik','malegaon':'Nashik','ozar':'Nashik','panchavati':'Nashik','gangapur road':'Nashik','ambad midc':'Nashik','satpur midc':'Nashik',
      'chakan':'Pune','talegaon dab h ade':'Pune','talegaon dabhade':'Pune','pimpri chinchwad':'Pune','hinjawadi':'Pune','wagholi':'Pune','hadapsar':'Pune','baner':'Pune','wakad':'Pune','kharadi':'Pune','baramati':'Pune','shirur':'Pune','lonavala':'Pune',
      'miraj':'Sangli','tasgaon':'Sangli','islampur':'Sangli','panhala':'Kolhapur','karad':'Satara','phaltan':'Satara','pandharpur':'Solapur'
    };
    return map[key] || '';
  }
  function containsPlace(text, place) {
    if (!place) return false;
    const blob = canonicalPlace(text);
    const needle = canonicalPlace(place);
    if (blob.includes(needle)) return true;
    if (needle === 'chhatrapati sambhajinagar') return blob.includes('aurangabad');
    if (needle === 'ahilyanagar') return blob.includes('ahmednagar');
    return false;
  }
  function getQueryFeatures(text) {
    const t = normalize(text);
    const rules = [
      { label: 'Road access', re: /road touch|road access|roadside|motorable road|road front|frontage road/ },
      { label: 'Water / irrigation', re: /irrigation|borewell|bore well|well water|water supply|water source/ },
      { label: 'Highway access', re: /highway|expressway/ },
      { label: 'Clear title', re: /clear title|title clear|7\/12|seven twelve|litigation free/ },
      { label: 'NA permission', re: /non agricultural|non-agricultural|\bna plot\b|na permission/ }
    ];
    return rules.filter(rule => rule.re.test(t)).map(rule => rule.label);
  }
  function queryProfile(text) {
    return {
      intent: detectIntent(text),
      city: inferCity(text) || cityForLocality(inferLocality(text)),
      locality: inferLocality(text),
      state: inferState(text),
      propertyType: inferType(text),
      use: inferUse(text),
      amount: parseAmount(text),
      area: parseArea(text),
      features: getQueryFeatures(text),
      hardBudget: /\b(under|below|upto|up to|maximum|max|at most|not more than|less than|within budget)\b/.test(normalize(text))
    };
  }
  function typeFamily(text) {
    const t = normalize(text);
    if (!t) return '';
    if (/hotel|resort|motel|lodge|guest house|guesthouse|cafe|café|restaurant|eatery|food court/.test(t)) return 'hospitality';
    if (/school|college|hospital|clinic|care home/.test(t)) return 'institutional';
    if (/farmhouse|farm house/.test(t)) return 'farmhouse';
    if (/agricultur|farm land|farmland|orchard|vineyard/.test(t)) return 'agricultural';
    if (/warehouse|godown|logistics shed/.test(t)) return 'warehouse';
    if (/industrial|factory|manufacturing|industrial shed/.test(t)) return 'industrial';
    if (/commercial|shop|office|retail|showroom|mall|business park|coworking|co-working/.test(t)) return 'commercial';
    if (/residential|flat|apartment|house|bungalow|villa|row house|townhouse|penthouse/.test(t)) return 'residential';
    if (/building|complex|tower|society|premises/.test(t)) return 'building';
    if (/plot|land parcel|\bland\b|estate/.test(t)) return 'land';
    return 'other';
  }
  function compareType(queryType, item) {
    const itemTypeText = [item.propertyType, item.landUse].filter(Boolean).join(' ');
    const itemType = typeFamily(itemTypeText);
    const queryFamily = typeFamily(queryType);
    if (!queryFamily) return null;
    if (!itemType) return { ratio: 0.3, known: false, reason: 'Property type not stated', hardConflict: false };
    if (queryFamily === itemType) return { ratio: 1, known: true, reason: 'Property type aligns', hardConflict: false };
    if (queryFamily === 'land' && ['agricultural', 'commercial', 'residential', 'industrial'].includes(itemType)) return { ratio: 0.78, known: true, reason: 'Land type is broadly compatible', hardConflict: false };
    if (queryFamily === 'agricultural' && itemType === 'land') {
      const use = normalize(item.landUse || '');
      return { ratio: /agricultur|farm/.test(use) ? 0.9 : 0.5, known: true, reason: /agricultur|farm/.test(use) ? 'Agricultural use aligns' : 'Land classification needs confirmation', hardConflict: false };
    }
    if ((queryFamily === 'commercial' && ['warehouse','building','hospitality'].includes(itemType)) || (queryFamily === 'building' && ['commercial','hospitality','institutional','residential','warehouse'].includes(itemType))) return { ratio: 0.72, known: true, reason: 'Related building/property use may fit', hardConflict: false };
    if (queryFamily === 'hospitality' && ['commercial','building'].includes(itemType)) return { ratio: 0.66, known: true, reason: 'Commercial premises may suit hospitality use', hardConflict: false };
    if (queryFamily === 'institutional' && ['commercial','building'].includes(itemType)) return { ratio: 0.6, known: true, reason: 'Building use needs confirmation', hardConflict: false };
    if (queryFamily === 'industrial' && itemType === 'warehouse') return { ratio: 0.72, known: true, reason: 'Industrial/warehouse use may fit', hardConflict: false };
    return { ratio: 0.03, known: true, reason: 'Property type differs', hardConflict: true };
  }
  function compareLocation(q, item) {
    const loc = [item.locality, item.city, item.district, item.state].filter(Boolean).join(' ');
    const hasData = Boolean(String(item.locality || item.city || item.district || item.state || '').trim());
    if (!q.city && !q.locality && !q.state) return null;
    if (!hasData) return { ratio: 0.3, known: false, reason: 'Location not fully stated', hardConflict: false };
    let ratio = 0.35;
    let reason = 'Location needs confirmation';
    let hardConflict = false;
    if (q.locality) {
      if (containsPlace(item.locality || '', q.locality)) { ratio = 1; reason = 'Locality matches'; }
      else if (containsPlace(loc, q.locality)) { ratio = 0.82; reason = 'Area is close to the requested locality'; }
      else if (q.city && containsPlace(loc, q.city)) { ratio = 0.65; reason = 'Same city/region; exact locality not stated'; }
      else if (q.city && item.city && !containsPlace(loc, q.city)) { ratio = 0.03; reason = 'Different location'; hardConflict = true; }
      else { ratio = 0.08; reason = 'Locality differs'; hardConflict = true; }
    } else if (q.city) {
      if (containsPlace(loc, q.city)) { ratio = 1; reason = 'City/region matches'; }
      else if (item.city || item.district || item.locality) { ratio = 0.03; reason = 'Different city/region'; hardConflict = true; }
    }
    if (q.state && item.state) {
      if (canonicalPlace(item.state).includes(canonicalPlace(q.state))) ratio = Math.min(1, ratio + 0.05);
      else { ratio = Math.min(ratio, 0.1); reason = 'State differs'; hardConflict = true; }
    }
    return { ratio, known: true, reason, hardConflict };
  }
  function comparePrice(q, item, target) {
    if (!q.amount) return null;
    if (target === 'SELL') {
      const asking = Number(item.priceINR);
      if (!Number.isFinite(asking) || asking <= 0) return { ratio: 0.28, known: false, reason: 'Asking price not stated', hardConflict: false };
      if (asking <= q.amount) return { ratio: asking <= q.amount * 0.8 ? 1 : 0.95, known: true, reason: 'Asking price is within budget', hardConflict: false };
      const over = asking / q.amount;
      if (over <= 1.05) return { ratio: 0.45, known: true, reason: 'Slightly above budget; negotiate', hardConflict: q.hardBudget };
      return { ratio: 0.02, known: true, reason: 'Asking price exceeds budget', hardConflict: true };
    }
    const budget = Number(item.budgetMaxINR);
    if (!Number.isFinite(budget) || budget <= 0) return { ratio: 0.28, known: false, reason: 'Buyer budget not stated', hardConflict: false };
    if (budget >= q.amount) return { ratio: budget >= q.amount * 1.25 ? 1 : 0.95, known: true, reason: 'Buyer budget covers asking price', hardConflict: false };
    if (q.amount <= budget * 1.05) return { ratio: 0.45, known: true, reason: 'Price is slightly above buyer budget', hardConflict: false };
    return { ratio: 0.02, known: true, reason: 'Buyer budget is below asking price', hardConflict: true };
  }
  function compareArea(q, item, target) {
    if (!q.area) return null;
    const listed = itemArea(item);
    if (!listed) return { ratio: 0.28, known: false, reason: 'Area not stated', hardConflict: false };
    if (target === 'SELL') {
      const ratio = listed.sqM / q.area.sqM;
      if (ratio >= 0.9) return { ratio: 1, known: true, reason: 'Available area meets the requirement', hardConflict: false };
      if (ratio >= 0.75) return { ratio: 0.72, known: true, reason: 'Area is somewhat smaller than requested', hardConflict: false };
      if (ratio >= 0.5) return { ratio: 0.38, known: true, reason: 'Area is smaller than requested', hardConflict: false };
      return { ratio: 0.12, known: true, reason: 'Area is substantially smaller', hardConflict: false };
    }
    const buyerNeed = listed.sqM;
    const available = q.area.sqM;
    const ratio = buyerNeed / available;
    if (ratio <= 1.05) return { ratio: 1, known: true, reason: 'Property area can satisfy the buyer', hardConflict: false };
    if (ratio <= 1.2) return { ratio: 0.65, known: true, reason: 'Buyer needs slightly more area', hardConflict: false };
    if (ratio <= 1.5) return { ratio: 0.35, known: true, reason: 'Buyer area requirement is larger', hardConflict: false };
    return { ratio: 0.1, known: true, reason: 'Buyer needs substantially more area', hardConflict: false };
  }
  function compareUse(q, item) {
    if (!q.use) return null;
    const itemUse = inferUse([item.landUse, item.propertyType].filter(Boolean).join(' '));
    if (!itemUse) return { ratio: 0.35, known: false, reason: 'Intended use not stated', hardConflict: false };
    if (normalize(itemUse) === normalize(q.use)) return { ratio: 1, known: true, reason: 'Intended use aligns', hardConflict: false };
    if (q.use === 'Agricultural' && typeFamily(item.propertyType) === 'land') return { ratio: 0.45, known: true, reason: 'Agricultural use needs confirmation', hardConflict: false };
    return { ratio: 0.08, known: true, reason: 'Intended use differs', hardConflict: false };
  }
  function compareFeatures(q, item) {
    if (!q.features.length) return null;
    const source = normalize([item.title, item.description, item.roadAccess, item.landUse].filter(Boolean).join(' '));
    const checks = q.features.map(label => {
      const rule = {
        'Road access': /road touch|road access|roadside|motorable road|road front|frontage road/,
        'Water / irrigation': /irrigation|borewell|bore well|well water|water supply|water source/,
        'Highway access': /highway|expressway/,
        'Clear title': /clear title|title clear|7\/12|seven twelve|litigation free/,
        'NA permission': /non agricultural|non-agricultural|\bna plot\b|na permission/
      }[label];
      if (rule && rule.test(source)) return { ratio: 1, known: true, reason: label + ' mentioned' };
      if (!source) return { ratio: 0.25, known: false, reason: label + ' not stated' };
      return { ratio: 0.08, known: true, reason: label + ' not confirmed' };
    });
    return { ratio: checks.reduce((sum, item) => sum + item.ratio, 0) / checks.length, known: checks.some(item => item.known), reason: checks.filter(item => item.ratio >= 0.8).map(item => item.reason).join(', ') || 'Requested site features need confirmation', hardConflict: false };
  }
  function scoreMatch(query, items, intendedType) {
    const q = queryProfile(query);
    const target = String(intendedType || (q.intent === 'BUY' ? 'SELL' : 'BUY')).toUpperCase();
    const scored = items.map(item => {
      if (String(item.listingType || '').toUpperCase() !== target) return null;
      const dimensions = [
        { name: 'location', weight: 28, result: compareLocation(q, item) },
        { name: 'type', weight: 22, result: compareType(q.propertyType, item) },
        { name: 'price', weight: 22, result: comparePrice(q, item, target) },
        { name: 'area', weight: 15, result: compareArea(q, item, target) },
        { name: 'use', weight: 7, result: compareUse(q, item) },
        { name: 'features', weight: 6, result: compareFeatures(q, item) }
      ].filter(dimension => dimension.result);
      if (!dimensions.length) return null;
      const weightTotal = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
      const score = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.weight * dimension.result.ratio, 0) / weightTotal * 100);
      const hardConflict = dimensions.some(dimension => dimension.result.hardConflict);
      const reasons = dimensions.filter(dimension => dimension.result.ratio >= 0.72 && dimension.result.known).map(dimension => dimension.result.reason);
      const caveats = dimensions.filter(dimension => !dimension.result.known || dimension.result.ratio < 0.45).map(dimension => dimension.result.reason);
      return { item, score, target, criteriaCount: dimensions.length, knownCriteria: dimensions.filter(dimension => dimension.result.known).length, hardConflict, reasons, caveats, dimensions: dimensions.map(dimension => ({ name: dimension.name, score: Math.round(dimension.result.ratio * 100), known: dimension.result.known, reason: dimension.result.reason })) };
    }).filter(Boolean);
    // Hard constraints are applied after scoring so a strong location match cannot hide an incompatible budget or property class.
    return scored.filter(result => !result.hardConflict && result.score >= 35)
      .sort((a, b) => b.score - a.score || b.knownCriteria - a.knownCriteria)
      .slice(0, 3);
  }
  function miniCard(item, match) {
    const ref = item.publicId || item.slug || item._id || 'ASTATE';
    const location = [item.locality, item.city, item.district, item.state].filter(Boolean).join(', ');
    const isBuyer = String(item.listingType || '').toUpperCase() === 'BUY';
    const price = isBuyer && item.budgetMaxINR ? 'Budget up to ' + money(item.budgetMaxINR) : money(item.priceINR);
    const limited = !match || match.criteriaCount < 2 || match.knownCriteria < 2;
    const quality = limited ? 'Limited signal' : match.score >= 80 ? 'Strong fit' : match.score >= 64 ? 'Good fit' : 'Possible fit';
    const scoreLabel = limited ? 'Add budget, area or property type to refine' : 'Fit score ' + match.score + '/100';
    const reasons = (match && match.reasons.length ? match.reasons : ['Some listing details still need confirmation']).slice(0, 3).join(' · ');
    const caveats = match && match.caveats.length ? '<small class="match-caveats">Confirm: ' + escapeHtml(match.caveats.slice(0, 2).join(' · ')) + '</small>' : '';
    return '<div class="match-card"><div class="match-card-top"><span class="pill ' + (isBuyer ? 'pill-buy' : '') + '">' + escapeHtml(prettyType(item)) + '</span><span class="listing-ref">' + escapeHtml(ref) + '</span></div><div class="match-quality">' + escapeHtml(quality) + ' <span>' + escapeHtml(scoreLabel) + '</span></div><strong>' + escapeHtml(item.title || item.propertyType || 'Property') + '</strong><span>' + escapeHtml(location || 'Location not stated') + '</span><span>' + escapeHtml(areaLabel(item)) + ' · ' + escapeHtml(price) + '</span><p>' + escapeHtml(redactPublicContacts(item.description || '')) + '</p><div class="match-reasons">' + escapeHtml(reasons) + '</div>' + caveats + '</div>';
  }
  async function runChat(query) {
    const messages = $('#chatMessages'), results = $('#chatResults');
    if (!messages || !results) return;
    messages.insertAdjacentHTML('beforeend', '<div class="bubble user">' + escapeHtml(query) + '</div><div class="bubble assistant" id="chatThinking">Comparing location, type, budget and area…</div>');
    results.innerHTML = ''; $('#chatText').value = '';
    try {
      const items = await fetchListings(true);
      $('#chatThinking')?.remove();
      const q = queryProfile(query);
      const intent = q.intent;
      const hasSignals = Boolean(q.city || q.locality || q.state || q.propertyType || q.amount || q.area || q.use || q.features.length);
      const eligible = items.filter(item => ['BUY','SELL'].includes(String(item.listingType || '').toUpperCase()));
      const matches = hasSignals ? scoreMatch(query, eligible, intent === 'BUY' ? 'SELL' : 'BUY') : [];
      if (matches.length) {
        messages.insertAdjacentHTML('beforeend', '<div class="bubble assistant">Ranked by the details you gave: location, property type, budget, area and stated site needs. Unknown details reduce confidence; this is a lead match, not title or ownership verification.</div>');
        results.innerHTML = matches.map(match => miniCard(match.item, match)).join('');
      } else {
        const message = !hasSignals
          ? 'Tell me at least a place or district and what kind of property you need. Adding budget and area makes the match much stronger.'
          : 'No compatible published listing passed the location, property-type and price checks. I have not invented any results. You can save this as a private ' + (intent === 'SELL' ? 'seller offer' : 'buyer requirement') + '.';
        messages.insertAdjacentHTML('beforeend', '<div class="bubble assistant">' + escapeHtml(message) + '</div>');
        const href = 'submit.html?intent=' + encodeURIComponent(intent) + '&query=' + encodeURIComponent(query);
        results.innerHTML = '<a class="button button-primary" href="' + href + '">Submit this ' + (intent === 'SELL' ? 'offer' : 'requirement') + ' ↗</a><a class="button button-outline" href="listings.html">Browse all listings</a>';
      }
      $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
    } catch (e) {
      $('#chatThinking')?.remove();
      messages.insertAdjacentHTML('beforeend', '<div class="bubble assistant">I couldn’t connect to the current listing feed just now. Please try again or open the <a href="listings.html">directory</a>.</div>');
      results.innerHTML = '';
    }
  }

  async function postNaturalText(query, button, container) {
    if (!query || !container) return;
    const text = String(query).trim().slice(0, 1800);
    const input = $('#chatText') || $('#postText');
    const validation = validateRealEstateMessage(text);
    if (!validation.ok) {
      container.insertAdjacentHTML('beforeend', '<div class="bubble user">' + escapeHtml(text) + '</div><div class="bubble assistant">' + escapeHtml(validation.reason) + '</div>');
      container.scrollTop = container.scrollHeight;
      return;
    }
    if (input) input.value = '';
    if (button) button.disabled = true;
    container.insertAdjacentHTML('beforeend', '<div class="bubble user">' + escapeHtml(text) + '</div>');
    const thinking = document.createElement('div');
    thinking.className = 'bubble assistant';
    thinking.textContent = 'Publishing your property post…';
    container.appendChild(thinking);
    container.scrollTop = container.scrollHeight;
    try {
      const intent = detectIntent(text);
      const city = inferCity(text) || cityForLocality(inferLocality(text));
      const locality = inferLocality(text);
      const state = inferState(text) || (city || locality ? 'Maharashtra' : '');
      const propertyType = inferType(text) || 'Other real estate';
      const amount = parseAmount(text);
      const area = parseArea(text);
      const phoneMatch = text.match(/(?:\+?91[\s-]*)?([6-9]\d{9})/);
      const referenceId = 'AS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const safeDescription = redactPublicContacts(text).slice(0, 1800) || 'Real-estate details supplied by the contributor.';
      // Public collection stores only property facts. Personal phone/email/web links are redacted by default.
      const publicPayload = {
        publicId: referenceId,
        slug: referenceId.toLowerCase(),
        title: cleanListingTitle(intent, propertyType, city, locality),
        listingType: intent,
        propertyType: propertyType,
        city: city || '',
        locality: locality || '',
        district: city || '',
        state: state,
        areaValue: area ? area.value : undefined,
        areaUnit: area ? area.unit : undefined,
        priceINR: intent === 'SELL' ? amount : undefined,
        budgetMaxINR: intent === 'BUY' ? amount : undefined,
        landUse: inferUse(text) || '',
        description: safeDescription,
        contactMethod: 'Instagram',
        contactPublic: '@amormagics · @arcstudio91',
        contactConsent: false,
        listingStatus: 'PUBLISHED',
        source: 'Astate community post'
      };
      Object.keys(publicPayload).forEach(key => { if (publicPayload[key] === undefined || publicPayload[key] === '') delete publicPayload[key]; });

      // Avoid repeat submissions on double-click/retry by checking for an exact recent public text duplicate.
      try {
        const current = await fetchListings(true);
        const normalizedPost = normalize(safeDescription);
        const duplicate = current.find(item => normalize(item.description || '') === normalizedPost && normalize(item.listingType || '') === normalize(intent) && normalize(item.city || '') === normalize(city));
        if (duplicate) {
          thinking.textContent = 'This same property message already appears in the public feed as ' + (duplicate.publicId || duplicate.slug || 'an existing listing') + '. I did not create a duplicate.';
          return;
        }
      } catch (_) { /* Publishing is still attempted; query outages must not block a valid post. */ }

      const result = await apiPost('/wix-data/v2/bulk/items/insert', {
        dataCollectionId: cfg.publicCollection,
        dataItems: [{ data: publicPayload }],
        returnEntity: true
      });
      const failed = Number(result && result.bulkActionMetadata && result.bulkActionMetadata.totalFailures || 0);
      if (failed > 0) throw new Error('The public listing collection rejected this post.');

      // Keep an administrator-only raw intake copy for backup/support where permissions allow it.
      let privateSaved = false;
      try {
        const privatePayload = {
          referenceId: referenceId,
          intent: intent,
          propertyType: propertyType,
          city: city || '',
          district: city || '',
          state: state,
          areaValue: area ? area.value : undefined,
          areaUnit: area ? area.unit : undefined,
          priceINR: intent === 'SELL' ? amount : undefined,
          budgetMaxINR: intent === 'BUY' ? amount : undefined,
          description: text,
          contactWhatsApp: phoneMatch ? '+91 ' + phoneMatch[1] : undefined,
          preferredContact: phoneMatch ? 'WhatsApp' : 'Instagram',
          consentPublic: true,
          consentContact: false,
          reviewStatus: 'AUTO_PUBLISHED',
          submittedAt: { '$date': new Date().toISOString() }
        };
        Object.keys(privatePayload).forEach(key => { if (privatePayload[key] === undefined || privatePayload[key] === '') delete privatePayload[key]; });
        const privateResult = await apiPost('/wix-data/v2/bulk/items/insert', {
          dataCollectionId: cfg.intakeCollection,
          dataItems: [{ data: privatePayload }],
          returnEntity: true
        });
        privateSaved = Number(privateResult && privateResult.bulkActionMetadata && privateResult.bulkActionMetadata.totalFailures || 0) === 0;
      } catch (_) { privateSaved = false; }
      listingsCache = null;
      thinking.textContent = 'Published now. Reference: ' + referenceId + '. Property details are live in Astate. Phone numbers, emails and URLs are hidden from the public description. ' + (privateSaved ? 'A private copy was also saved.' : 'The public post is live; the private backup copy could not be confirmed.') + ' Public posts can be copied by search engines or other visitors. For edits or removal, contact @amormagics or @arcstudio91.';
      const results = $('#chatResults');
      if (results) results.innerHTML = '<a class="button button-primary" href="listings.html">See published listing ↗</a>';
    } catch (error) {
      thinking.textContent = 'The site could not publish this property post just now. Please retry. If the issue continues, contact @amormagics or @arcstudio91 on Instagram.';
    } finally {
      if (button) button.disabled = false;
      container.scrollTop = container.scrollHeight;
    }
  }

  async function initHome() {
    const form = $('#matchChat');
    form?.addEventListener('submit', e => { e.preventDefault(); const text = $('#chatText').value.trim(); if (text) runChat(text); });
    const postButton = $('#postChatButton');
    postButton?.addEventListener('click', () => { const text = $('#chatText').value.trim(); if (text) postNaturalText(text, postButton, $('#chatMessages')); });
    $$('[data-prompt]').forEach(btn => btn.addEventListener('click', () => { $('#chatText').value = btn.dataset.prompt; $('#chatText').focus(); }));
    try { renderHomeListings(await fetchListings()); } catch(e) { setListingError($('#homeListings'), e.message); }
  }
  async function initListings() {
    try {
      const data = await fetchListings(); renderListings(data); bindExportButtons(data);
      ['listingSearch','listingType','propertyType'].forEach(id => $('#'+id)?.addEventListener('input',()=>renderListings(data)));
    } catch(e) { setListingError($('#listingGrid'), e.message); $('#listingCount').textContent = 'Feed unavailable'; }
  }
  function setStatus(kind, message) {
    const status = $('#formStatus'); if (!status) return;
    status.className = `form-status ${kind || ''}`; status.textContent = message;
  }
  function field(form, name) { return form.elements.namedItem(name); }
  function val(form, name) { return String(field(form,name)?.value || '').trim(); }
  function optNumber(form, name) { const raw=val(form,name); if(!raw) return undefined; const n=Number(raw); return Number.isFinite(n)&&n>=0?n:undefined; }
  async function initSubmit() {
    const form = $('#postChat');
    if (!form) return;
    const input = $('#postText');
    const button = $('#postButton');
    const messages = $('#postMessages');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const text = String(input.value || '').trim();
      if (text) postNaturalText(text, button, messages);
    });
    $$('.post-example').forEach(function (example) {
      example.addEventListener('click', function () {
        input.value = example.dataset.message || '';
        input.focus();
      });
    });
    const params = new URLSearchParams(location.search);
    if (params.get('query')) input.value = params.get('query').slice(0, 1800);
    if (params.get('query')) input.focus();
  }
  function csvCell(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    return '"' + raw.replace(/"/g, '""') + '"';
  }
  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportListings(items, format) {
    const fields = ['publicId','title','listingType','propertyType','city','locality','district','state','areaValue','areaUnit','priceINR','budgetMinINR','budgetMaxINR','landUse','roadAccess','description','listingStatus','source','lastReviewed'];
    const stamp = new Date().toISOString().slice(0, 10);
    const safeItems = items.map(item => Object.fromEntries(fields.map(key => [key, key === 'description' ? redactPublicContacts(item[key] ?? '') : item[key] ?? ''])));
    if (format === 'csv') {
      const csv = '\ufeff' + [fields.map(csvCell).join(','), ...safeItems.map(item => fields.map(key => csvCell(item[key])).join(','))].join('\r\n');
      downloadBlob('astate-public-listings-' + stamp + '.csv', csv, 'text/csv');
    } else {
      downloadBlob('astate-public-listings-' + stamp + '.json', JSON.stringify({schema:'urn:astate:public-listings:v1', exportedAt:new Date().toISOString(), count:safeItems.length, listings:safeItems}, null, 2), 'application/json');
    }
  }
  function bindExportButtons(items) {
    $('#exportListingsJson')?.addEventListener('click', () => exportListings(items, 'json'));
    $('#exportListingsCsv')?.addEventListener('click', () => exportListings(items, 'csv'));
    $('#downloadPublicJson')?.addEventListener('click', () => exportListings(items, 'json'));
    $('#downloadPublicCsv')?.addEventListener('click', () => exportListings(items, 'csv'));
  }

  async function initAI() {
    const pre=$('#jsonOutput'), status=$('#feedStatus'), size=$('#jsonSize');
    try {
      const items=await fetchListings(); bindExportButtons(items);
      const feed={schema:'urn:astate:property-listing:v1', publisher:'Astate Property Match', updatedAt:new Date().toISOString(), count:items.length, privacy:'Only published listing fields are included; private intake records are not accessible.', listings:items.map(item=>({reference:item.publicId || item.slug || item._id || '', title:item.title || '', listingType:item.listingType || '', propertyType:item.propertyType || '', city:item.city || '', locality:item.locality || '', district:item.district || '', state:item.state || '', areaValue:item.areaValue ?? null, areaUnit:item.areaUnit || '', priceINR:item.priceINR ?? null, budgetMinINR:item.budgetMinINR ?? null, budgetMaxINR:item.budgetMaxINR ?? null, landUse:item.landUse || '', roadAccess:item.roadAccess || '', description:redactPublicContacts(item.description || ''), lastReviewed:item.lastReviewed || null, source:item.source || 'Astate published listing'}))};
      const text=JSON.stringify(feed,null,2); pre.textContent=text; status.textContent=`Connected · ${items.length} published record${items.length===1?'':'s'}`; status.classList.add('text-good'); size.textContent=`${new Blob([text]).size.toLocaleString()} BYTES`;
      $('#copyJson')?.addEventListener('click', async()=>{try{await navigator.clipboard.writeText(text);$('#copyJson').textContent='Copied ✓';}catch{pre.focus();const range=document.createRange();range.selectNodeContents(pre);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);$('#copyJson').textContent='Select and copy';}});
    } catch(e) { status.textContent='Feed currently unavailable'; pre.textContent=JSON.stringify({error:'The live public listing feed could not be loaded.', details:e.message || 'Unknown connection error', retry:'Refresh this page to try again.'},null,2); }
  }
  function initNav() {
    const btn=$('.menu-toggle'), nav=$('.nav');
    btn?.addEventListener('click',()=>{const open=nav.classList.toggle('nav-open');btn.setAttribute('aria-expanded',String(open));});
    $$('[data-year]').forEach(el=>el.textContent=new Date().getFullYear());
  }
  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    const page=document.body.dataset.page;
    if(page==='home') initHome(); if(page==='listings') initListings(); if(page==='submit') initSubmit(); if(page==='ai') initAI();
  });
})();
