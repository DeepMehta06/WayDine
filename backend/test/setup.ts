/** Fail loudly if any automated test accidentally attempts a real Google Places call. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "places.googleapis.com" || (url.hostname === "maps.googleapis.com" && url.pathname.startsWith("/maps/api/place"))) {
    throw new Error("Live Google Places requests are forbidden in automated tests. Inject a mocked fetchImpl.");
  }
  return realFetch(input, init);
}) as typeof fetch;
