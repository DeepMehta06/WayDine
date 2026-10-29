// Run from project root: node backend/scripts/test-foursquare.mjs
// At most three requests. Never logs credentials or requests Premium fields.
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';

const env = dotenv.parse(await readFile(new URL('../.env', import.meta.url)));
const keyName = ['FOURSQUARE_API_KEY', 'FOURSQAURE_API_KEY', 'FSQ_API_KEY']
  .find(name => (process.env[name] ?? env[name])?.trim());
if (!keyName) {
  console.error('No Foursquare API key configured in backend/.env or process environment.');
  process.exit(1);
}
const key = (process.env[keyName] ?? env[keyName]).trim().replace(/^Bearer\s+/i, '');
const report = {
  test: 'Foursquare default-Pro search and details smoke test',
  startedAt: new Date().toISOString(), credentialVariable: keyName,
  apiHost: 'places-api.foursquare.com', apiVersion: '2025-06-17',
  maxRequests: 3, premiumFieldsRequested: false, attempts: [],
};
const redact = value => String(value).split(key).join('[REDACTED]');
function summarize(place) {
  const available = field => place[field] !== undefined && place[field] !== null
    && (!Array.isArray(place[field]) || place[field].length > 0);
  return {
    id: place.fsq_place_id ?? place.fsq_id ?? null, name: place.name ?? null,
    categories: (place.categories ?? []).map(category => category.name),
    address: place.location?.formatted_address ?? place.location?.address ?? null,
    locality: place.location?.locality ?? null, distanceM: place.distance ?? null,
    coordinatesPresent: Number.isFinite(place.latitude) && Number.isFinite(place.longitude),
    available: Object.fromEntries(['tel', 'website', 'hours', 'rating', 'stats', 'price', 'photos', 'tastes', 'attributes', 'date_refreshed', 'date_closed'].map(field => [field, available(field)])),
    returnedFields: Object.keys(place).sort(),
  };
}
async function request(label, path, params = {}) {
  if (report.attempts.length >= report.maxRequests) throw new Error('Request budget exhausted');
  const url = new URL(path, 'https://places-api.foursquare.com');
  url.search = new URLSearchParams(params).toString();
  const attempt = { label, path: url.pathname, parameters: params };
  report.attempts.push(attempt);
  const start = performance.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'X-Places-Api-Version': report.apiVersion },
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    attempt.durationMs = Math.round(performance.now() - start);
    attempt.httpStatus = response.status;
    attempt.rateLimits = Object.fromEntries([...response.headers.entries()].filter(([name]) => /rate.?limit|retry-after/i.test(name)));
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      attempt.error = redact(JSON.stringify(payload?.message ?? payload?.error ?? payload ?? response.statusText)).slice(0, 600);
      return { ok: false, status: response.status };
    }
    const places = Array.isArray(payload?.results) ? payload.results : [payload];
    attempt.count = places.length;
    attempt.places = places.filter(Boolean).map(summarize);
    attempt.fieldCoverage = Object.fromEntries(['tel', 'website', 'hours', 'rating', 'stats', 'price', 'photos', 'attributes'].map(field => [field, attempt.places.filter(place => place.available[field]).length]));
    return { ok: true, places };
  } catch (error) {
    attempt.durationMs = Math.round(performance.now() - start);
    attempt.error = redact(error.message);
    attempt.networkCode = error.cause?.code ?? null;
    return { ok: false, networkError: true };
  }
}
// Approximate public suburb centres; no personal/user GPS location is used.
const first = await request('Kandivali restaurant search', '/places/search', {
  ll: '19.2040,72.8520', radius: '2500', query: 'restaurant', limit: '10', sort: 'DISTANCE',
});
if (first.ok) {
  const second = await request('Borivali restaurant search', '/places/search', {
    ll: '19.2307,72.8567', radius: '2500', query: 'restaurant', limit: '10', sort: 'DISTANCE',
  });
  const place = first.places?.find(place => place.fsq_place_id) ?? second.places?.find(place => place.fsq_place_id);
  if (place) await request('Default-Pro place details', `/places/${encodeURIComponent(place.fsq_place_id)}`);
}
report.successfulRequests = report.attempts.filter(attempt => attempt.httpStatus === 200).length;
report.status = report.successfulRequests === 3 ? 'passed' : first.ok ? 'partial' : 'failed';
const output = process.argv.includes('--verbose') ? report : {
  ...report,
  attempts: report.attempts.map(({ places, ...attempt }) => ({
    ...attempt,
    examples: places?.slice(0, 4).map(({ name, categories, address, distanceM }) => ({ name, categories, address, distanceM })),
  })),
};
console.log(JSON.stringify(output, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
