import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Map as MapIcon, RotateCw, X } from "lucide-react";
import type { AuthUser, LngLat, RecommendRequest } from "@contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ResultsPanel } from "@/components/ResultsPanel";
import { SearchForm, type EndpointInput } from "@/components/SearchForm";
import { StopDetails } from "@/components/StopDetails";
import { TripSummary } from "@/components/TripSummary";
import { useLenis } from "@/hooks/useLenis";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRecommend } from "@/hooks/useRecommend";
import { ApiError, fetchGraphPreview, getAccount, getPreferences, googleSignInUrl, reversePlace, signOut, type GraphPreview } from "@/lib/api";
import { istLocalInputToIso } from "@/lib/format";
import { decodeTrip, DEFAULT_PREFERENCES, encodeTrip, type SelectedPlace, type TripPreferences } from "@/lib/search-state";
import { cn } from "@/lib/utils";

const MapView = lazy(() => import("@/components/MapView"));

const EMPTY_INPUT: EndpointInput = { text: "", place: null };

function buildRequest(source: SelectedPlace, destination: SelectedPlace, prefs: TripPreferences, routeIndex?: number): RecommendRequest | null {
  const departure =
    prefs.departure.mode === "now" ? ({ mode: "now" } as const) : (() => {
      const time = istLocalInputToIso(prefs.departure.local);
      return time ? ({ mode: "at", time } as const) : null;
    })();
  if (!departure) return null;
  return {
    source: source.coordinates,
    destination: destination.coordinates,
    departure,
    preferences: {
      diet: prefs.diet,
      includeUnconfirmedDiet: prefs.includeUnconfirmedDiet,
      maxDetourMinutes: prefs.maxDetourMinutes,
      cuisines: prefs.cuisines,
    },
    ...(routeIndex !== undefined ? { routeIndex } : {}),
  };
}

const samePoint = (a: LngLat | undefined, b: LngLat | undefined) => Boolean(a && b && a[0] === b[0] && a[1] === b[1]);

export default function App() {
  const [source, setSource] = useState<EndpointInput>(EMPTY_INPUT);
  const [destination, setDestination] = useState<EndpointInput>(EMPTY_INPUT);
  const [prefs, setPrefs] = useState<TripPreferences>(DEFAULT_PREFERENCES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(true);
  const [mapHidden, setMapHidden] = useState(false);
  const [mapCenter, setMapCenter] = useState<LngLat | null>(null);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [graphPreview, setGraphPreview] = useState<GraphPreview | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const graphRequest = useRef<AbortController | null>(null);
  const preferencesEdited = useRef(false);
  const search = useRecommend();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const scrollRef = useLenis(isDesktop);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { user } = await getAccount();
        if (!active) return;
        setAccount(user);
        try {
          const { preferences } = await getPreferences();
          if (active && !preferencesEdited.current && !decodeTrip(window.location.hash)) {
            setPrefs((current) => ({ ...current, diet: preferences.diet, cuisines: preferences.cuisines, includeUnconfirmedDiet: preferences.includeUnconfirmedDiet, maxDetourMinutes: preferences.maxDetourMinutes }));
          }
        } catch { if (active) setAccountError("Couldn't load your saved preferences. You can still choose them for this trip."); }
      } catch (err) {
        if (active && (!(err instanceof ApiError) || err.code !== "UNAUTHENTICATED")) setAccountError(err instanceof Error ? err.message : "Couldn't check sign-in status.");
      } finally { if (active) setAccountLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const run = useCallback(
    (s: SelectedPlace, d: SelectedPlace, p: TripPreferences, routeIndex?: number) => {
      const request = buildRequest(s, d, p, routeIndex);
      if (!request) return;
      setSelectedId(null);
      void search.run(request, s, d);
    },
    [search.run] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Restore an explicitly shared trip from the URL hash (opt-in persistence only).
  useEffect(() => {
    const shared = decodeTrip(window.location.hash);
    if (!shared) return;
    setSource({ text: shared.source.name, place: shared.source });
    setDestination({ text: shared.destination.name, place: shared.destination });
    setPrefs(shared.prefs);
    // Restoring a shared link must not automatically consume Places quota.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse the form once results arrive so they get the space, especially on phones.
  useEffect(() => {
    if (search.status === "success") {
      setFormOpen(false);
      asideRef.current?.scrollTo?.({ top: 0 });
    }
  }, [search.status, search.data?.requestId]);

  function submit() {
    if (!account) { setAccountError("Sign in with Google before searching for restaurants."); return; }
    if (source.place && destination.place) run(source.place, destination.place, prefs);
  }

  function adjust(patch: Partial<TripPreferences>) {
    preferencesEdited.current = true;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (source.place && destination.place) run(source.place, destination.place, next);
  }

  async function moveEndpoint(which: "source" | "destination", point: LngLat) {
    const set = which === "source" ? setSource : setDestination;
    const current = which === "source" ? source : destination;
    const base = current.place;
    if (!base) return;
    const moved: SelectedPlace = { ...base, coordinates: point, adjusted: true, secondary: "Pin moved on the map" };
    set({ text: moved.name, place: moved });
    try {
      const { place } = await reversePlace(point);
      if (place) {
        set((prev) => (prev.place && samePoint(prev.place.coordinates, point) ? { ...prev, place: { ...prev.place, secondary: `Pin near ${place.name}` } } : prev));
      }
    } catch {
      // Keep the pin; the label simply stays generic.
    }
  }

  function swap() {
    setSource(destination);
    setDestination(source);
  }

  function resetAll() {
    setSource(EMPTY_INPUT);
    setDestination(EMPTY_INPUT);
    setPrefs(DEFAULT_PREFERENCES);
    setSelectedId(null);
    setFormOpen(true);
    search.reset();
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  const data = search.data;
  const snapshot = search.snapshot;
  const selected = data?.recommendations.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    graphRequest.current?.abort(); graphRequest.current = null;
    setGraphPreview(null); setGraphError(null); setGraphLoading(false);
  }, [data?.requestId, selectedId, source.place?.coordinates, destination.place?.coordinates]);
  useEffect(() => () => graphRequest.current?.abort(), []);

  async function showGraphRoute() {
    if (!source.place || !destination.place) return;
    graphRequest.current?.abort();
    const controller = new AbortController(); graphRequest.current = controller;
    setGraphLoading(true); setGraphError(null); setGraphPreview(null);
    try {
      const selectedForTrip = snapshot && samePoint(source.place.coordinates, snapshot.request.source) && samePoint(destination.place.coordinates, snapshot.request.destination) ? selected : null;
      const result = await fetchGraphPreview({ source: source.place.coordinates, destination: destination.place.coordinates, ...(selectedForTrip ? { stop: selectedForTrip.routedTo } : {}) }, controller.signal);
      if (!controller.signal.aborted) setGraphPreview(result);
    } catch (err) {
      if (!controller.signal.aborted) setGraphError(err instanceof Error ? err.message : "The WayDine route couldn't be calculated.");
    } finally { if (!controller.signal.aborted) setGraphLoading(false); }
  }
  const tripChanged = Boolean(
    snapshot &&
      (!samePoint(source.place?.coordinates, snapshot.request.source) || !samePoint(destination.place?.coordinates, snapshot.request.destination))
  );
  const shareUrl = useMemo(() => {
    if (!snapshot || !source.place || !destination.place) return "";
    return `${window.location.origin}${window.location.pathname}${encodeTrip(source.place, destination.place, prefs)}`;
  }, [snapshot, source.place, destination.place, prefs]);

  const biasFor = (field: "source" | "destination"): LngLat | null =>
    (field === "source" ? destination.place?.coordinates : source.place?.coordinates) ?? mapCenter;

  const loading = search.status === "loading";
  const error = search.error;

  async function logout() {
    try { await signOut(); setAccount(null); setAccountError(null); resetAll(); }
    catch (err) { setAccountError(err instanceof Error ? err.message : "Couldn't sign out."); }
  }

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
      <main
        className={cn(
          "sticky top-0 z-20 shrink-0 border-b border-border transition-[height] duration-200 md:static md:order-2 md:h-full md:flex-1 md:border-b-0",
          mapHidden ? "h-0 overflow-hidden border-b-0" : "h-[38svh]"
        )}
      >
        <ErrorBoundary fallback={<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The map couldn't load. Stops are still listed.</div>}>
          <Suspense fallback={<div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">Loading map…</div>}>
            <MapView
              source={source.place}
              destination={destination.place}
              route={tripChanged ? null : (data?.route.geometry ?? null)}
              graphRoute={graphPreview?.geometry ?? null}
              routeStale={search.stale}
              recommendations={tripChanged ? [] : (data?.recommendations ?? [])}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onEndpointMove={moveEndpoint}
              onCenterChange={setMapCenter}
            />
          </Suspense>
        </ErrorBoundary>
      </main>

      <aside
        ref={(el) => {
          asideRef.current = el;
          scrollRef(el);
        }}
        className="flex-1 bg-background md:order-1 md:w-[420px] md:flex-none md:overflow-y-auto md:border-r md:border-border"
      >
        <div className="flex flex-col gap-4 px-4 pt-3 pb-8">
          <header className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl leading-none text-primary">WayDine</h1>
              <p className="mt-1 text-xs text-muted-foreground">Food stops on your route, with the extra driving each one adds</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="md:hidden"
              aria-pressed={!mapHidden}
              onClick={() => setMapHidden((h) => !h)}
            >
              <MapIcon aria-hidden />
              {mapHidden ? "Show map" : "Hide map"}
            </Button>
          </header>

          <div className="flex items-center justify-between gap-2 text-sm">
            {accountLoading ? <span>Checking sign-in…</span> : account ? <><span>Signed in as {account.displayName || account.email}</span><Button type="button" variant="outline" size="sm" onClick={() => void logout()}>Sign out</Button></> : <><span>Sign in to search Google restaurants</span><Button asChild variant="outline" size="sm"><a href={googleSignInUrl}>Sign in with Google</a></Button></>}
          </div>
          {accountError && <p role="status" className="text-sm text-muted-foreground">{accountError}</p>}

          {(formOpen || !data) && (
            <SearchForm
              source={source}
              destination={destination}
              onSourceChange={setSource}
              onDestinationChange={setDestination}
              prefs={prefs}
              onPrefsChange={(next) => { preferencesEdited.current = true; setPrefs(next); }}
              biasFor={biasFor}
              onSubmit={submit}
              onCancel={search.cancel}
              onSwap={swap}
              onReset={resetAll}
              loading={loading}
              serverFieldErrors={error?.fieldErrors ?? {}}
            />
          )}

          {source.place && destination.place && !loading && <div className="rounded-lg border border-border p-3 text-xs">
            <Button type="button" variant="outline" size="sm" onClick={() => void showGraphRoute()} disabled={graphLoading}>{graphLoading ? "Calculating WayDine route…" : selected && !tripChanged ? "Show WayDine route via this stop" : "Show WayDine graph route"}</Button>
            <p className="mt-2 text-muted-foreground">Blue line: WayDine graph preview. Recommendations and times still use Google routing.</p>
            {graphError && <p role="status" className="mt-2">{graphError}</p>}
            {graphPreview && <><p className="mt-2">WayDine estimate: {(graphPreview.distanceM / 1000).toFixed(1)} km · {Math.round(graphPreview.durationSec / 60)} min. {graphPreview.attribution}</p>{graphPreview.warnings.map((warning) => <p key={warning} className="mt-1 text-muted-foreground">{warning}</p>)}</>}
          </div>}

          {loading && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
                {search.elapsedSec < 3 ? "Finding your route…" : "Checking restaurants along the way…"}
                <span className="text-xs text-muted-foreground tabular-nums">{search.elapsedSec}s</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={search.cancel}>
                <X aria-hidden />
                Cancel
              </Button>
            </div>
          )}

          {error && !loading && (
            <Alert variant="destructive">
              <AlertTitle>Search didn't finish</AlertTitle>
              <AlertDescription>
                <p>
                  {error.message}
                  {error.retryAfterSec && error.code !== "QUOTA_EXCEEDED" ? ` Try again in about ${error.retryAfterSec} s.` : ""}
                </p>
                {error.retryable && source.place && destination.place && (
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={submit}>
                    <RotateCw aria-hidden />
                    Try again
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {!data && !loading && !error && (
            <p className="text-sm text-muted-foreground">
              Choose where you're starting and where you're driving to. WayDine routes to each restaurant's entrance and back, then lists the
              stops that add the least driving.
            </p>
          )}

          {data && snapshot && (
            <div className={cn("flex flex-col gap-4 transition-opacity", search.stale && "pointer-events-none opacity-50")} aria-busy={search.stale}>
              {tripChanged && !loading && (
                <Alert>
                  <AlertDescription>
                    These stops are for {snapshot.sourceName} → {snapshot.destinationName}. Your trip details changed. Search again to update them.
                  </AlertDescription>
                </Alert>
              )}
              {!formOpen && (
                <TripSummary
                  data={data}
                  sourceName={snapshot.sourceName}
                  destinationName={snapshot.destinationName}
                  onEdit={() => setFormOpen(true)}
                  onChooseRoute={(i) => source.place && destination.place && run(source.place, destination.place, prefs, i)}
                  shareUrl={shareUrl}
                  busy={loading}
                />
              )}
              {selected && source.place && destination.place ? (
                <StopDetails
                  rec={selected}
                  data={data}
                  source={snapshot.request.source}
                  destination={snapshot.request.destination}
                  destinationName={snapshot.destinationName}
                  onBack={() => setSelectedId(null)}
                />
              ) : (
                <ResultsPanel
                  data={data}
                  prefs={prefs}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAdjust={adjust}
                  onEdit={() => setFormOpen(true)}
                />
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
