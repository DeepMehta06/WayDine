import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Map as MapIcon, RotateCw, X } from "lucide-react";
import type { LngLat, RecommendRequest } from "@contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ResultsPanel } from "@/components/ResultsPanel";
import { SearchForm, validateTrip, type EndpointInput } from "@/components/SearchForm";
import { StopDetails } from "@/components/StopDetails";
import { TripSummary } from "@/components/TripSummary";
import { useLenis } from "@/hooks/useLenis";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRecommend } from "@/hooks/useRecommend";
import { reversePlace } from "@/lib/api";
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
  const search = useRecommend();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const scrollRef = useLenis(isDesktop);
  const asideRef = useRef<HTMLElement | null>(null);

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
    if (Object.keys(validateTrip({ text: "x", place: shared.source }, { text: "x", place: shared.destination }, shared.prefs)).length === 0) {
      run(shared.source, shared.destination, shared.prefs);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse the form once results arrive so they get the space, especially on phones.
  useEffect(() => {
    if (search.status === "success") {
      setFormOpen(false);
      asideRef.current?.scrollTo?.({ top: 0 });
    }
  }, [search.status, search.data?.requestId]);

  function submit() {
    if (source.place && destination.place) run(source.place, destination.place, prefs);
  }

  function adjust(patch: Partial<TripPreferences>) {
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

          {(formOpen || !data) && (
            <SearchForm
              source={source}
              destination={destination}
              onSourceChange={setSource}
              onDestinationChange={setDestination}
              prefs={prefs}
              onPrefsChange={setPrefs}
              biasFor={biasFor}
              onSubmit={submit}
              onCancel={search.cancel}
              onSwap={swap}
              onReset={resetAll}
              loading={loading}
              serverFieldErrors={error?.fieldErrors ?? {}}
            />
          )}

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
