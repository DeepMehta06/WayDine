import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Info, Loader2, Map as MapIcon, Pencil, RotateCw, Waypoints, X } from "lucide-react";
import { useTrip } from "@/app/trip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RestaurantCard } from "@/components/trip/RestaurantCard";
import { STAGE_LABEL, WhyExcluded } from "@/components/WhyExcluded";
import { fetchGraphPreview, isAbort, ApiError, type GraphPreview } from "@/lib/api";
import { formatDistance, formatDuration, formatWhen } from "@/lib/format";
import { useReducedMotion } from "@/lib/motion";
import { describePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { DETOUR_CHOICES } from "@/components/preferences/PreferenceControls";

gsap.registerPlugin(useGSAP);

const MapView = lazy(() => import("@/components/MapView"));

export default function TripPage() {
  const { search, result, status, error, elapsedSec, run, cancel, setDraft } = useTrip();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapHidden, setMapHidden] = useState(false);
  const [graph, setGraph] = useState<GraphPreview | null>(null);
  const [graphState, setGraphState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const graphCtl = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    document.title = search ? `${search.draft.source.name} → ${search.draft.destination.name} · WayDine` : "Your trip · WayDine";
  }, [search]);

  useEffect(() => {
    setSelectedId(null);
    setGraph(null);
    graphCtl.current?.abort();
  }, [result?.requestId]);

  useEffect(() => () => graphCtl.current?.abort(), []);

  useGSAP(
    () => {
      if (reduced || !listRef.current) return;
      gsap.fromTo(listRef.current.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.05, ease: "expo.out", clearProps: "all" });
    },
    { dependencies: [result?.requestId, reduced] }
  );

  if (!search) return <Navigate to="/plan" replace />;

  const { draft } = search;
  const loading = status === "loading";
  const recs = result?.recommendations ?? [];
  const selected = recs.find((r) => r.id === selectedId) ?? null;
  const ctx = result?.preferenceContext;
  const stages = result ? Object.entries(result.diagnostics.excludedByStage).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : [];
  const effectiveDetour = ctx?.preferences.maxDetourMinutes ?? draft.overrides.maxDetourMinutes ?? 10;
  const nextDetour = DETOUR_CHOICES.find((m) => m > effectiveDetour);

  function rerun(patch: { routeIndex?: number; overrides?: typeof draft.overrides }) {
    const nextDraft = patch.overrides ? { ...draft, overrides: { ...draft.overrides, ...patch.overrides } } : draft;
    if (patch.overrides) setDraft(() => nextDraft);
    run({ draft: nextDraft, routeIndex: patch.routeIndex ?? search?.routeIndex });
  }

  async function showGraph() {
    graphCtl.current?.abort();
    const c = new AbortController();
    graphCtl.current = c;
    setGraphState({ loading: true, error: null });
    try {
      const preview = await fetchGraphPreview(
        { source: draft.source.coordinates, destination: draft.destination.coordinates, ...(selected ? { stop: selected.routedTo } : {}) },
        c.signal
      );
      setGraph(preview);
      setGraphState({ loading: false, error: null });
    } catch (err) {
      if (isAbort(err)) return;
      setGraphState({ loading: false, error: err instanceof ApiError ? err.message : "The WayDine graph route couldn't be calculated." });
    }
  }

  return (
    <main className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,480px)_1fr]">
      <div
        className={cn(
          "sticky top-14 z-20 shrink-0 border-b border-border transition-[height] duration-200 lg:order-2 lg:h-[calc(100dvh-3.5rem)] lg:border-b-0",
          mapHidden ? "h-0 overflow-hidden border-b-0 lg:h-[calc(100dvh-3.5rem)]" : "h-[36svh]"
        )}
      >
        <Suspense fallback={<div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">Loading map…</div>}>
          <MapView
            source={draft.source}
            destination={draft.destination}
            route={result?.route.geometry ?? null}
            graphRoute={graph?.geometry ?? null}
            routeStale={loading}
            recommendations={recs}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEndpointMove={() => undefined}
            onCenterChange={() => undefined}
          />
        </Suspense>
      </div>

      <div className="flex flex-col gap-5 px-4 py-6 sm:px-6 lg:order-1 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:border-r lg:border-border">
        <section aria-labelledby="trip-title" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h1 id="trip-title" className="flex min-w-0 flex-wrap items-center gap-x-2 font-display text-2xl leading-tight font-semibold tracking-wide">
              <span className="truncate">{draft.source.name}</span>
              <ArrowRight aria-label="to" className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{draft.destination.name}</span>
            </h1>
            <div className="flex shrink-0 gap-1.5">
              <Button variant="outline" size="sm" className="lg:hidden" aria-pressed={!mapHidden} onClick={() => setMapHidden((h) => !h)}>
                <MapIcon aria-hidden />
                {mapHidden ? "Map" : "Hide"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/plan")}>
                <Pencil aria-hidden />
                Edit
              </Button>
            </div>
          </div>

          {result && (
            <>
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatDistance(result.route.distanceM)} · {formatDuration(result.route.durationSec)} driving · arrive{" "}
                {formatWhen(result.route.arrivalTime)} without a stop
                {result.route.summary && <span className="block truncate text-xs">via {result.route.summary}</span>}
              </p>
              {result.route.alternatives.length > 1 && (
                <div role="radiogroup" aria-label="Route to search along" className="flex flex-wrap gap-1.5">
                  {result.route.alternatives.map((alt) => {
                    const on = alt.index === result.route.index;
                    const fastest = Math.min(...result.route.alternatives.map((a) => a.durationSec));
                    return (
                      <button
                        key={alt.index}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={loading}
                        onClick={() => !on && rerun({ routeIndex: alt.index })}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                        )}
                      >
                        {alt.durationSec - fastest < 30 ? "Fastest" : `+${formatDuration(alt.durationSec - fastest)}`} · {formatDistance(alt.distanceM)}
                        {alt.summary ? ` · ${alt.summary.split(",")[0]}` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
              {ctx && (
                <p className="text-sm">
                  <span className="text-muted-foreground">{ctx.overriddenFields.length ? "This trip: " : "Your preferences: "}</span>
                  {describePreferences(ctx.preferences)}
                </p>
              )}
            </>
          )}
        </section>

        {loading && (
          <div role="status" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <span className="flex items-center gap-2">
                <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
                Finding stops and routing to each entrance…
                <span className="text-xs text-muted-foreground tabular-nums">{elapsedSec}s</span>
              </span>
              <Button variant="ghost" size="sm" onClick={cancel}>
                <X aria-hidden />
                Cancel
              </Button>
            </div>
            {!result &&
              [0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                  <Skeleton className="mt-4 h-5 w-3/4" />
                </div>
              ))}
          </div>
        )}

        {status === "error" && error && (
          <Alert variant="destructive">
            <AlertTitle>The search didn't finish</AlertTitle>
            <AlertDescription>
              <p>
                {error.message}
                {error.retryAfterSec && error.code !== "QUOTA_EXCEEDED" ? ` Try again in about ${error.retryAfterSec} s.` : ""}
              </p>
              <div className="mt-3 flex gap-2">
                {error.retryable && (
                  <Button variant="outline" size="sm" onClick={() => rerun({})}>
                    <RotateCw aria-hidden />
                    Try again
                  </Button>
                )}
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/plan">Change trip</Link>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {result && (
          <div className={cn("flex flex-col gap-5 transition-opacity", loading && "pointer-events-none opacity-50")} aria-busy={loading}>
            {result.diagnostics.warnings.length > 0 && (
              <ul className="flex flex-col gap-1.5" aria-label="Search notes">
                {result.diagnostics.warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-xs text-muted-foreground">
                    <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}

            {recs.length > 0 ? (
              <section aria-labelledby="stops-title" className="flex flex-col gap-3">
                <h2 id="stops-title" className="font-sans text-sm font-semibold tracking-normal">
                  {recs.length} stop{recs.length === 1 ? "" : "s"} on your way{" "}
                  <span className="font-normal text-muted-foreground">· least extra driving first</span>
                </h2>
                <ol ref={listRef} className="flex flex-col gap-3">
                  {recs.map((rec) => (
                    <li key={rec.id}>
                      <RestaurantCard
                        rec={rec}
                        selected={rec.id === selectedId}
                        diet={ctx?.preferences.diet ?? "any"}
                        budgetSet={Boolean(ctx?.budgetApplied)}
                        onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="font-sans text-base font-semibold tracking-normal">
                  {result.diagnostics.inCorridor === 0 ? "No listed restaurants along this route" : "No stops fit this trip"}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {result.diagnostics.inCorridor === 0
                    ? `Google lists no restaurants within ${formatDistance(result.diagnostics.corridorHalfWidthM)} of this route.`
                    : `${result.diagnostics.inCorridor} places are near the route, but none passed every check.`}
                </p>
                {stages.length > 0 && (
                  <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
                    {stages.slice(0, 3).map(([stage, n]) => (
                      <li key={stage}>
                        {STAGE_LABEL[stage as keyof typeof STAGE_LABEL]}: <span className="tabular-nums">{n}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {nextDetour && (
                    <Button variant="outline" onClick={() => rerun({ overrides: { maxDetourMinutes: nextDetour } })}>
                      Allow up to {nextDetour} min extra
                    </Button>
                  )}
                  {ctx && ctx.preferences.cuisines.length > 0 && (
                    <Button variant="outline" onClick={() => rerun({ overrides: { cuisines: [] } })}>
                      Any cuisine
                    </Button>
                  )}
                  {ctx && ctx.preferences.diet !== "any" && !ctx.preferences.includeUnconfirmedDiet && (
                    <Button variant="outline" onClick={() => rerun({ overrides: { includeUnconfirmedDiet: true } })}>
                      Include unconfirmed veg info
                    </Button>
                  )}
                  {ctx?.budgetApplied && (
                    <Button variant="outline" onClick={() => rerun({ overrides: { budgetPerPersonInr: null } })}>
                      No budget limit
                    </Button>
                  )}
                </div>
              </section>
            )}

            <section aria-labelledby="graph-title" className="rounded-xl border border-border bg-card p-4 text-sm">
              <h2 id="graph-title" className="flex items-center gap-2 font-sans text-sm font-semibold tracking-normal">
                <Waypoints aria-hidden className="size-4 text-primary" />
                WayDine graph route
              </h2>
              <p className="mt-1 text-muted-foreground">
                Our own shortest-path calculation over OpenStreetMap roads, drawn in blue{selected ? ` via ${selected.name}` : ""}. A planning preview:
                times and ranking above still use Google routing.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void showGraph()} disabled={graphState.loading}>
                {graphState.loading && <Loader2 aria-hidden className="animate-spin" />}
                {graphState.loading ? "Calculating…" : selected ? "Show graph route via this stop" : "Show graph route"}
              </Button>
              {graphState.error && (
                <p role="status" className="mt-2 text-destructive">
                  {graphState.error}
                </p>
              )}
              {graph && (
                <div className="mt-2 text-muted-foreground">
                  <p className="tabular-nums">
                    WayDine estimate: {formatDistance(graph.distanceM)} · {formatDuration(graph.durationSec)}. {graph.attribution}
                  </p>
                  {graph.warnings.map((w) => (
                    <p key={w} className="mt-1 text-xs">
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <WhyExcluded data={result} />
            <p className="text-xs text-muted-foreground">Restaurant data from Google Maps. Listings can be out of date. Check before you go.</p>
          </div>
        )}
      </div>
    </main>
  );
}
