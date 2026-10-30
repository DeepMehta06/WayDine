// Exercise the current HTTP app with configured live keys, without changing a
// running development server. Keeps credentials and full route geometry private.
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const env = dotenv.parse(await readFile(new URL('../.env', import.meta.url)));
process.env.LOG_LEVEL = 'silent';
const { loadConfig } = await import('../dist/config.js');
const { createProviderContext } = await import('../dist/providers/context.js');
const { createApp } = await import('../dist/app.js');
const { geoapifyPlaces } = await import('../dist/providers/geoapify.js');
const config = loadConfig({
  ...process.env, ...env, SEARCH_LOGGING: 'off',
  QUOTA_STATE_FILE: fileURLToPath(new URL('../.data/quota-state.json', import.meta.url)),
});
const ctx = createProviderContext(config);
const originalFetch = ctx.fetchImpl;
const upstream = [];
const secrets = [env.GEOAPIFY_API_KEY, env.MAPBOX_SECRET_TOKEN, env.FOURSQUARE_API_KEY, env.FOURSQAURE_API_KEY].filter(Boolean);
const clean = value => secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value));
ctx.fetchImpl = async (input, init) => {
  if (upstream.length >= 120) throw new Error('Live smoke-test request ceiling reached');
  const url = new URL(String(input));
  const entry = { provider: url.hostname, status: null };
  upstream.push(entry);
  const started = performance.now();
  try {
    const response = await originalFetch(input, init);
    entry.status = response.status;
    return response;
  } catch (error) {
    entry.error = clean(error.message);
    throw error;
  } finally {
    entry.durationMs = Math.round(performance.now() - started);
  }
};
const report = { testedAt: new Date().toISOString(), capabilities: config.capabilities, cases: [], upstream };
const app = createApp(config, ctx, { enabled: false, record() {} });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

async function local(label, path, body) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  return { label, httpStatus: response.status, durationMs: Math.round(performance.now() - started), data };
}
const near = [72.8520, 19.2040];
try {
  const ready = await local('Readiness', '/api/ready');
  report.cases.push({ ...ready, data: { status: ready.data.status, capabilities: ready.data.capabilities, problems: ready.data.problems } });
  const queries = ['Kandivali West', 'Borivali East', 'Borivli', 'Andheri East', 'बोरीवली'];
  const suggestions = new Map();
  for (const query of queries) {
    const result = await local(`Location: ${query}`, `/api/places/suggest?q=${encodeURIComponent(query)}&near=${near.join(',')}`);
    suggestions.set(query, result.data.suggestions ?? []);
    report.cases.push({
      label: result.label, httpStatus: result.httpStatus, durationMs: result.durationMs,
      providers: result.data.providers, partial: result.data.partial,
      suggestions: (result.data.suggestions ?? []).slice(0, 4).map(({ name, secondary, kind, source }) => ({ name, secondary, kind, source })),
      error: result.data.error,
    });
  }
  for (const [label, point] of [['Kandivali', near], ['Borivali', [72.8567, 19.2307]]]) {
    const started = performance.now();
    try {
      const page = await geoapifyPlaces(ctx, point, 1000);
      report.cases.push({
        label: `Geoapify food venues: ${label}`, status: 'passed', durationMs: Math.round(performance.now() - started),
        count: page.venues.length, malformed: page.malformed, saturated: page.saturated,
        withHours: page.venues.filter(place => place.hours).length,
        withPhone: page.venues.filter(place => place.phone).length,
        withDietEvidence: page.venues.filter(place => place.vegetarian !== 'unknown').length,
        examples: page.venues.slice(0, 6).map(place => ({ name: place.name, type: place.venueType, cuisines: place.cuisineTags, vegetarian: place.vegetarian })),
      });
    } catch (error) {
      report.cases.push({ label: `Geoapify food venues: ${label}`, status: 'failed', error: clean(error.message) });
    }
  }
  const area = places => places.find(place => ['locality', 'suburb', 'neighbourhood'].includes(place.kind) && /mumbai/i.test(place.secondary ?? ''));
  const source = area(suggestions.get('Kandivali West'));
  const destination = area(suggestions.get('Borivali East'));
  if (source && destination) {
    const preferences = { diet: 'any', includeUnconfirmedDiet: false, maxDetourMinutes: 15, cuisines: [] };
    const testNoon = new Date();
    // Next 12:00 IST, using the instant rather than the host's timezone.
    const istDate = new Date(testNoon.getTime() + 330 * 60000).toISOString().slice(0, 10);
    let lunch = new Date(`${istDate}T12:00:00+05:30`);
    if (lunch.getTime() <= Date.now()) lunch = new Date(lunch.getTime() + 86400000);
    for (const [label, departure] of [['Leave now', { mode: 'now' }], ['Next lunch at 12:00 IST', { mode: 'at', time: lunch.toISOString() }]]) {
      const response = await local(`Route: ${label}`, '/api/recommend', { source: source.coordinates, destination: destination.coordinates, departure, preferences });
      const data = response.data;
      report.cases.push({
        label: response.label, httpStatus: response.httpStatus, durationMs: response.durationMs,
        source: source.name, destination: destination.name, departure,
        route: data.route ? { distanceKm: +(data.route.distanceM / 1000).toFixed(2), durationMinutes: +(data.route.durationSec / 60).toFixed(1), alternativeCount: data.route.alternatives.length } : null,
        count: data.recommendations?.length, diagnostics: data.diagnostics,
        recommendations: data.recommendations?.map(place => ({
          name: place.name, extraMinutes: +(place.extraTimeSec / 60).toFixed(2), arrivalTime: place.arrivalTime,
          opening: place.openingHours.atArrival, vegetarian: place.diet.vegetarian,
          cuisines: place.cuisines, access: place.access, providers: place.sources.map(source => source.provider),
          facts: place.facts, uncertainties: place.uncertainties,
        })),
        excludedExamples: data.excluded?.slice(0, 4).map(({ name, stage, reason }) => ({ name, stage, reason })),
        error: data.error,
      });
    }
    const invalid = await local('Reject identical endpoints without upstream calls', '/api/recommend', { source: source.coordinates, destination: source.coordinates, departure: { mode: 'now' }, preferences });
    report.cases.push({ label: invalid.label, httpStatus: invalid.httpStatus, error: invalid.data.error });
  } else {
    report.cases.push({ label: 'Route tests', status: 'skipped', reason: 'No sufficiently clear Mumbai locality suggestion for one endpoint.' });
  }
} catch (error) {
  report.error = clean(error.message);
  process.exitCode = 1;
} finally {
  ctx.quota.persistNow();
  await new Promise(resolve => server.close(resolve));
}
report.upstreamSummary = Object.entries(Object.groupBy(upstream, call => call.provider)).map(([provider, calls]) => ({ provider, calls: calls.length, statuses: Object.fromEntries(Object.entries(Object.groupBy(calls, call => String(call.status))).map(([status, group]) => [status, group.length])) }));
// Save metrics only; do not persist Mapbox place records or route coordinates.
const metrics = {
  testedAt: report.testedAt, capabilities: report.capabilities, upstreamSummary: report.upstreamSummary,
  cases: report.cases.map(({ suggestions, recommendations, excludedExamples, examples, ...entry }) => ({ ...entry, suggestionCountShown: suggestions?.length })),
  error: report.error,
};
await writeFile(new URL('../../docs/LIVE_API_TEST_METRICS_2026-10-30.json', import.meta.url), JSON.stringify(metrics, null, 2));
const { upstream: omitted, ...output } = report;
console.log(clean(JSON.stringify(output, null, 2)));
