/**
 * Automated tests must never reach a live provider (Google Places/Routes/Maps,
 * Mapbox, Geoapify, Overpass, Supabase). Only local test servers are allowed;
 * anything else fails loudly so a missing mock can't silently spend quota.
 */
const realFetch = globalThis.fetch;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Live network request to ${url.hostname} is forbidden in automated tests. Inject a mocked fetchImpl.`);
  }
  return realFetch(input, init);
}) as typeof fetch;
