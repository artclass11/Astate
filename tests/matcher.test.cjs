const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const appPath = require('node:path').join(__dirname, '..', 'assets', 'app.js');
let source = fs.readFileSync(appPath, 'utf8');
const marker = "  document.addEventListener('DOMContentLoaded', () => {";
assert(source.includes(marker), 'test hook marker not found');
source = source.replace(marker, "  window.__ASTATE_TEST_API = { validateRealEstateMessage, validateRealEstateRecord, redactPublicContacts, inferType, detectIntent, queryProfile, scoreMatch };\n" + marker);
const window = { ASTATE_CONFIG: {} };
const document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, body: { dataset: { page: '' } } };
vm.runInNewContext(source, { window, document, console, URL, Blob, setTimeout, clearTimeout });
const api = window.__ASTATE_TEST_API;
const valid = text => assert.equal(api.validateRealEstateMessage(text).ok, true, `expected valid property post: ${text}`);
const invalid = text => assert.equal(api.validateRealEstateMessage(text).ok, false, `expected non-property post to be rejected: ${text}`);

[
  'Selling 2 acres near Sinnar, Nashik for ₹65 lakh.',
  'Looking to buy a flat in Pune under ₹80 lakh.',
  'Selling a hotel building in Mumbai.',
  'Cafe premises available for rent in Sangli.',
  'Looking for a commercial office building in Bengaluru under ₹2 crore.',
  'Selling an industrial warehouse in Nagpur.',
  'Need a resort property in Goa with highway access.',
  'Looking to lease a retail shop in Pune.'
].forEach(valid);

[
  'Selling cosmetics and beauty products in Pune.',
  'Pharma products available at wholesale rates.',
  'Selling laptops and technology gadgets.',
  'Chemical drums available for sale.',
  'Looking to buy supplements in Nashik.',
  'Selling 100 mobile phones for ₹5 lakh.'
].forEach(invalid);

assert.equal(api.inferType('Selling 2 acres near Sinnar'), 'Plot / land', 'acreage alone should infer land without assuming agricultural use');
assert.equal(api.detectIntent('Cafe premises available for rent in Sangli'), 'SELL');

const redacted = api.redactPublicContacts('Selling a flat in Pune. Call 9876543210, email owner@example.com, more details https://example.com/property');
assert(!redacted.includes('9876543210'), 'phone numbers must be redacted from public text');
assert(!redacted.includes('owner@example.com'), 'email addresses must be redacted from public text');
assert(!redacted.includes('https://example.com/property'), 'URLs must be redacted from public text');
assert(redacted.includes('[phone hidden]') && redacted.includes('[email hidden]'), 'redaction should be visible rather than silently deleting context');

assert.equal(api.validateRealEstateRecord({
  listingType: 'SELL',
  title: 'PROPERTY OFFER: Hotel / resort in Nashik',
  propertyType: 'Hotel / resort',
  description: 'Selling a hotel building with 18 rooms near Nashik'
}), true, 'real-estate asset types beyond land/houses must be accepted');
assert.equal(api.validateRealEstateRecord({
  listingType: 'SELL',
  title: 'Pharma products',
  propertyType: 'Medicine',
  description: 'Selling pharmaceutical products in Nashik'
}), false, 'read-side filters must reject unrelated product records');

const offers = [
  { publicId: 'GOOD', listingType: 'SELL', propertyType: 'Agricultural land', landUse: 'Agricultural', city: 'Nashik', locality: 'Sinnar', state: 'Maharashtra', areaValue: 2, areaUnit: 'acre', priceINR: 6500000, description: 'Agricultural land near Sinnar with road access and well water' },
  { publicId: 'WRONG_CITY', listingType: 'SELL', propertyType: 'Agricultural land', city: 'Pune', locality: 'Wagholi', state: 'Maharashtra', areaValue: 2, areaUnit: 'acre', priceINR: 4500000, description: 'Agricultural land near Wagholi' },
  { publicId: 'WRONG_TYPE', listingType: 'SELL', propertyType: 'Hotel / resort', city: 'Nashik', locality: 'Sinnar', state: 'Maharashtra', areaValue: 2, areaUnit: 'acre', priceINR: 6000000, description: 'Resort property' },
  { publicId: 'TOO_EXPENSIVE', listingType: 'SELL', propertyType: 'Agricultural land', city: 'Nashik', locality: 'Sinnar', state: 'Maharashtra', areaValue: 2, areaUnit: 'acre', priceINR: 9000000, description: 'Agricultural land near Sinnar' }
];
const buyerQuery = 'Looking to buy agricultural land in Nashik, 2 acres under ₹70 lakh';
const ranked = api.scoreMatch(buyerQuery, offers, 'SELL');
assert(ranked.length >= 1, 'expected at least one plausible buyer-seller match');
assert.equal(ranked[0].item.publicId, 'GOOD', 'best fit should rank first');
assert(!ranked.some(x => x.item.publicId === 'WRONG_CITY'), 'hard location mismatch should be excluded');
assert(!ranked.some(x => x.item.publicId === 'WRONG_TYPE'), 'hard property-type mismatch should be excluded');
assert(!ranked.some(x => x.item.publicId === 'TOO_EXPENSIVE'), 'hard budget mismatch should be excluded');
assert(ranked[0].score >= 64, 'matching location, type, area and price should produce a useful fit score');

const buyerRequirements = [
  { publicId: 'BUY_NEEDS_2', listingType: 'BUY', propertyType: 'Agricultural land', city: 'Nashik', locality: 'Sinnar', state: 'Maharashtra', areaValue: 2, areaUnit: 'acre', budgetMaxINR: 7000000, description: 'Looking for 2 acres agricultural land near Sinnar' },
  { publicId: 'BUY_NEEDS_5', listingType: 'BUY', propertyType: 'Agricultural land', city: 'Nashik', locality: 'Sinnar', state: 'Maharashtra', areaValue: 5, areaUnit: 'acre', budgetMaxINR: 7000000, description: 'Looking for 5 acres agricultural land near Sinnar' }
];
const sellerQuery = 'Selling 2 acres agricultural land in Sinnar Nashik for ₹65 lakh';
const reverseRanked = api.scoreMatch(sellerQuery, buyerRequirements, 'BUY');
assert.equal(reverseRanked[0]?.item.publicId, 'BUY_NEEDS_2', 'seller should match buyers whose area need can fit their land');
assert(!reverseRanked.some(x => x.item.publicId === 'BUY_NEEDS_5' && x.score > reverseRanked[0].score), 'a larger buyer area need must not outrank a fit');

console.log('Astate tests passed: real-estate guard, category coverage, two-way budget/area match, ranking, and conflict filtering.');
