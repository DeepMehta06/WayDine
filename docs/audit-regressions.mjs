// Audit diagnostics only. Uses built backend modules and mocked HTTP responses.
// Run after backend build: node docs/audit-regressions.mjs
import assert from 'node:assert/strict';
process.env.MAPBOX_SECRET_TOKEN = 'audit-mock-token';
process.env.TZ = 'Asia/Kolkata';
const { getCandidates } = await import('../backend/dist/services/candidates.js');
const { classifyDirection } = await import('../backend/dist/services/direction.js');
const { rankByDetour } = await import('../backend/dist/services/graph.js');
const { applyMealRules, mealForArrival } = await import('../backend/dist/services/mealRules.js');
const { excludeAndRank } = await import('../backend/dist/services/ranking.js');
const findings = [];
const candidate = {
  id: 'audit', name: 'Audit restaurant', longitude: 72, latitude: 19,
  cuisine: null, vegAvailable: null, openingHours: [], distanceFromRoadM: 0,
  nearestRouteIndex: 0, travelSide: 'left', matchesRouteDirection: true,
};
const json = body => new Response(JSON.stringify(body), { status: 200 });
const poi = (lng, lat) => ({ geometry: { coordinates: [lng, lat] }, properties: { mapbox_id: 'audit', name: 'Audit restaurant' } });

// A roughly 10km city route is searched only at its two ends.
let sampled = [];
globalThis.fetch = async input => {
  sampled.push(new URL(input).searchParams.get('proximity'));
  return json({ features: [] });
};
await getCandidates(Array.from({ length: 101 }, (_, i) => [72 + i * 0.001, 19]));
assert.equal(sampled.length, 2);
findings.push({ issue: 'Short route samples only endpoints', sampled });

sampled = [];
await getCandidates(Array.from({ length: 2501 }, (_, i) => [72 + i * 0.001, 19]));
assert.equal(sampled.length, 8);
assert.notEqual(sampled.at(-1), '74.5,19');
findings.push({ issue: 'Long route stops sampling early and omits destination', sampled, destination: '74.5,19' });

// Restaurant is exactly on a route segment, but over 400m from both vertices.
globalThis.fetch = async () => json({ features: [poi(72.005, 19)] });
const onSegment = await getCandidates([[72, 19], [72.01, 19]]);
assert.equal(onSegment.length, 0);
findings.push({ issue: 'Point on route rejected by vertex-only distance', resultCount: onSegment.length });

const onLine = classifyDirection([{ ...candidate, longitude: 72.005 }], [[72, 19], [72.01, 19]])[0];
assert.equal(onLine.matchesRouteDirection, false);
findings.push({ issue: 'Zero cross product classified wrong side', side: onLine.travelSide });

const mealCandidate = { ...candidate, detourMinutes: 0, etaArrival: '12:00', mealRecommended: 'lunch', openAtArrival: null };
const veg = excludeAndRank([mealCandidate], { vegetarian: true });
assert.equal(veg.ranked.length, 1);
assert.equal(veg.ranked[0].score, 0.93);
findings.push({ issue: 'Unknown diet passes vegetarian-only and gets 93% match', score: veg.ranked[0].score, reason: veg.ranked[0].reason });

process.env.TZ = 'UTC';
const utcMeal = mealForArrival(new Date('2026-10-29T12:00:00+05:30'));
process.env.TZ = 'Asia/Kolkata';
const indiaMeal = mealForArrival(new Date('2026-10-29T12:00:00+05:30'));
assert.equal(utcMeal, 'breakfast');
assert.equal(indiaMeal, 'lunch');
findings.push({ issue: 'Same instant produces different meal by server timezone', utcMeal, indiaMeal });

// A 10-second trip within the same minute loses seconds, rolls to tomorrow,
// then tests Friday hours rather than Thursday hours.
globalThis.fetch = async () => json({ durations: [[0, 10, 100], [10, 0, 90], [100, 90, 0]] });
const shortArrival = await rankByDetour([{ ...candidate, openingHours: [{ weekday: 4, opens_at: '11:00:00', closes_at: '13:00:00' }] }], [72, 19], [72.01, 19], 100, new Date('2026-10-29T12:00:30+05:30'));
const shortMeal = applyMealRules(shortArrival, new Date('2026-10-29T12:00:30+05:30'))[0];
assert.equal(shortMeal.openAtArrival, false);
findings.push({ issue: 'ETA minute truncation checks next-day hours', actualArrival: '2026-10-29T12:00:40+05:30', returnedEta: shortMeal.etaArrival, openAtArrival: shortMeal.openAtArrival });

// An unreachable candidate's Infinity ETA reaches the result rather than being
// classified explicitly. Ranking later treats this as an infinite detour.
globalThis.fetch = async () => json({ durations: [[0, null, 100], [null, 0, null], [100, null, 0]] });
const unreachable = (await rankByDetour([candidate], [72, 19], [72.01, 19], 100, new Date()))[0];
assert.equal(unreachable.detourMinutes, Infinity);
assert.equal(unreachable.etaArrival, 'Invalid Date');
findings.push({ issue: 'Unreachable matrix candidate yields invalid ETA and infinite detour', eta: unreachable.etaArrival, detour: String(unreachable.detourMinutes) });

// Existing parser ignores close.day, reducing a weekly continuous opening
// period to a same-day/overnight period.
const { searchRestaurantsNear } = await import('../backend/dist/services/mapbox.js');
globalThis.fetch = async () => json({ features: [{ ...poi(72, 19), properties: { mapbox_id: 'audit', name: 'Audit restaurant', metadata: { open_hours: { periods: [{ open: { day: 1, time: '0900' }, close: { day: 3, time: '1700' } }] } } } }] });
const parsed = await searchRestaurantsNear([72, 19]);
const multiDay = applyMealRules([{ ...candidate, openingHours: parsed[0].openingHours, detourMinutes: 0, etaArrival: '12:00' }], new Date('2026-10-27T10:00:00+05:30'))[0];
assert.equal(multiDay.openAtArrival, false);
findings.push({ issue: 'Multi-day opening period incorrectly marked closed', openAtArrival: multiDay.openAtArrival });
console.log(JSON.stringify({ mockedHttpOnly: true, reproducedFindings: findings.length, findings }, null, 2));
