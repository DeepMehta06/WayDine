import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import {
  ArrowLeft,
  Baby,
  Car,
  CircleCheck,
  CircleHelp,
  Clock,
  CreditCard,
  ExternalLink,
  Globe,
  Leaf,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Star,
  Toilet,
  TriangleAlert,
  UtensilsCrossed,
  Accessibility,
} from "lucide-react";
import type { LngLat } from "@contract";
import { useTrip } from "@/app/trip";
import { Button } from "@/components/ui/button";
import { PhotoGallery } from "@/components/trip/PhotoGallery";
import { Reviews } from "@/components/trip/Reviews";
import { ApiError, getRestaurantDetails, isAbort, type RestaurantDetails } from "@/lib/api";
import { formatDistance, formatDuration, formatExtra, formatWhen } from "@/lib/format";
import { businessStatusLabel, mealsServed, priceLabel, ratingCountLabel, trueOptions } from "@/lib/google";

const MapView = lazy(() => import("@/components/MapView"));

/** Session-only memory of fetched details so revisiting a stop doesn't repeat a billable call. */
const detailsCache = new Map<string, RestaurantDetails>();

const latLng = ([lng, lat]: LngLat) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
function mapsDirections(origin: LngLat, destination: LngLat, waypoint?: LngLat): string {
  const p = new URLSearchParams({ api: "1", origin: latLng(origin), destination: latLng(destination), travelmode: "driving" });
  if (waypoint) p.set("waypoints", latLng(waypoint));
  return `https://www.google.com/maps/dir/?${p}`;
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-sans text-base font-semibold tracking-normal">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

const yesNo = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "Not listed");
const VEG_LABEL = { "pure-veg": "Pure vegetarian", options: "Serves vegetarian food", none: "Listed as not serving vegetarian food", unknown: "Not listed" } as const;
const SIDE_LABEL = { left: "Left side of your route", right: "Right side of your route", "on-route": "On your route", unknown: "Unknown" } as const;

export default function StopPage() {
  const { id = "" } = useParams();
  const { search, result } = useTrip();
  const rec = result?.recommendations.find((r) => r.id === id) ?? null;
  const placeId = rec?.google?.placeId ?? null;
  const [details, setDetails] = useState<RestaurantDetails | null>(placeId ? (detailsCache.get(placeId) ?? null) : null);
  const [detailsState, setDetailsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });

  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (rec) document.title = `${rec.name} · WayDine`;
  }, [rec]);

  useEffect(() => {
    if (!placeId || detailsCache.has(placeId)) return;
    const c = new AbortController();
    setDetailsState({ loading: true, error: null });
    getRestaurantDetails(placeId, c.signal).then(
      (res) => {
        detailsCache.set(placeId, res.restaurant);
        setDetails(res.restaurant);
        setDetailsState({ loading: false, error: null });
      },
      (err) => {
        if (isAbort(err)) return;
        setDetailsState({ loading: false, error: err instanceof ApiError ? err.message : "Couldn't load photos and reviews." });
      }
    );
    return () => c.abort();
  }, [placeId]);

  if (!search || !result) return <Navigate to="/plan" replace />;
  if (!rec) return <Navigate to="/trip" replace />;

  const g = details?.google ?? rec.google;
  const price = priceLabel(g);
  const status = businessStatusLabel(g?.businessStatus ?? null);
  const meals = g ? mealsServed(g) : null;
  const parking = trueOptions(g?.amenities.parking ?? null);
  const accessibility = trueOptions(g?.amenities.accessibility ?? null);
  const payment = trueOptions(g?.amenities.payment ?? null);
  const hoursLines = (details?.openingHoursText ?? rec.openingHours.text ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const ra = rec.routeAssessment;
  const delay = new Date(rec.destinationArrivalTime).getTime() - new Date(result.route.arrivalTime).getTime();
  const { source, destination } = search.draft;

  return (
    <main className="grid flex-1 lg:grid-cols-[1fr_minmax(0,440px)]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
        <Link to="/trip" className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4" />
          All stops
        </Link>

        <header className="mt-4">
          <p className="text-sm font-medium text-primary">
            Stop {rec.rank} on your way · {formatExtra(rec.extraTimeSec)}
          </p>
          <h1 className="mt-1 font-display text-4xl leading-tight font-semibold tracking-wide text-balance">{rec.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {g?.rating != null && (
              <span className="flex items-center gap-1 text-foreground">
                <Star aria-hidden className="size-4 fill-accent text-accent" />
                <span className="font-medium tabular-nums">{g.rating.toFixed(1)}</span>
                {g.userRatingCount != null && <span className="text-muted-foreground">({ratingCountLabel(g.userRatingCount)} ratings)</span>}
              </span>
            )}
            {price && <span className="tabular-nums">· {price}</span>}
            <span className="capitalize">· {[rec.venueType, ...rec.cuisines].filter(Boolean).join(", ") || "Restaurant"}</span>
          </p>
          {(g?.shortAddress || rec.address) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
              {g?.shortAddress || rec.address}
            </p>
          )}
          {status && (
            <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent-foreground">
              <TriangleAlert aria-hidden className="size-4" />
              Google lists this place as {status.toLowerCase()}.
            </p>
          )}
        </header>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild size="lg" className="h-11">
            <a href={mapsDirections(source.coordinates, destination.coordinates, rec.routedTo)} target="_blank" rel="noreferrer">
              <Navigation aria-hidden />
              Navigate via this stop
            </a>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11">
            <a href={mapsDirections(source.coordinates, rec.routedTo)} target="_blank" rel="noreferrer">
              Directions to stop only
            </a>
          </Button>
          {(details?.phone ?? rec.phone) && (
            <Button asChild variant="outline" size="lg" className="h-11">
              <a href={`tel:${(details?.phone ?? rec.phone)!.replace(/[^\d+]/g, "")}`}>
                <Phone aria-hidden />
                Call
              </a>
            </Button>
          )}
          {(details?.website ?? rec.website) && (
            <Button asChild variant="outline" size="lg" className="h-11">
              <a href={(details?.website ?? rec.website)!} target="_blank" rel="noreferrer noopener">
                <Globe aria-hidden />
                Website
              </a>
            </Button>
          )}
          {g?.googleMapsUri && (
            <Button asChild variant="ghost" size="lg" className="h-11">
              <a href={g.googleMapsUri} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                Google Maps
              </a>
            </Button>
          )}
        </div>

        <div className="mt-6">
          {detailsState.loading && !details ? (
            <div role="status" className="flex aspect-[16/9] items-center justify-center gap-2 rounded-2xl bg-muted text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading photos and reviews…
            </div>
          ) : (
            <PhotoGallery photos={g?.photos ?? []} name={rec.name} />
          )}
          {detailsState.error && <p className="mt-2 text-sm text-destructive">{detailsState.error} Showing what the search already returned.</p>}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Section title="Your stop" icon={<Clock aria-hidden className="size-4" />}>
            <dl>
              <Row label="Leave">{formatWhen(result.route.departureTime)}</Row>
              <Row label="Arrive here">
                <span className="font-semibold">{formatWhen(rec.arrivalTime)}</span>
              </Row>
              <Row label={`Reach ${destination.name}`}>{formatWhen(rec.destinationArrivalTime)}</Row>
              <Row label="Extra driving">
                {formatExtra(rec.extraTimeSec)} · {formatDistance(rec.extraDistanceM)}
              </Row>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {delay < 30_000 ? "Same arrival as driving straight through." : `${formatDuration(delay / 1000)} later than without a stop.`} Times
              are IST and exclude time spent eating.
            </p>
          </Section>

          <Section title="When you arrive" icon={<UtensilsCrossed aria-hidden className="size-4" />}>
            <p>
              {rec.openingHours.atArrival === "open"
                ? `Expected to be open at ${formatWhen(rec.arrivalTime)}.`
                : "Opening hours couldn't be confirmed for your arrival."}
              {rec.openingHours.closesWithinMinutes !== null && ` Closes about ${rec.openingHours.closesWithinMinutes} min after you arrive.`}
            </p>
            {hoursLines.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground">
                {hoursLines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {rec.mealRecommendation && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="capitalize">
                  {rec.mealPeriod} time
                  {rec.mealRecommendation.service === "listed" ? " · listed as served" : rec.mealRecommendation.service === "not-listed" ? " · not listed" : ""}
                </p>
                {rec.mealRecommendation.ideas.length > 0 && <p className="mt-1 text-muted-foreground">Ideas: {rec.mealRecommendation.ideas.join(", ")}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{rec.mealRecommendation.disclaimer}</p>
              </div>
            )}
          </Section>

          <Section title="Food" icon={<Leaf aria-hidden className="size-4" />}>
            <dl>
              <Row label="Vegetarian">{VEG_LABEL[rec.diet.vegetarian]}</Row>
              {meals && meals.served.length > 0 && <Row label="Serves">{meals.served.join(", ")}</Row>}
              {price && <Row label="Typical price">{price}</Row>}
              {rec.budgetAssessment && rec.budgetAssessment.status !== "not-set" && (
                <Row label="Your budget">
                  {rec.budgetAssessment.status === "likely-within" ? "Likely within" : "Price unconfirmed"}
                  {rec.budgetAssessment.budgetPerPersonInr ? ` (₹${rec.budgetAssessment.budgetPerPersonInr.toLocaleString("en-IN")})` : ""}
                </Row>
              )}
              <Row label="Dine-in">{yesNo(g?.service.dineIn ?? null)}</Row>
              <Row label="Takeaway">{yesNo(g?.service.takeout ?? null)}</Row>
            </dl>
          </Section>

          <Section title="Facilities" icon={<Car aria-hidden className="size-4" />}>
            <ul className="flex flex-col gap-2">
              <li className="flex gap-2">
                <Car aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {parking.length ? parking.join(", ") : "Parking not listed"}
              </li>
              <li className="flex gap-2">
                <Toilet aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Restroom: {yesNo(g?.amenities.restroom ?? null)}
              </li>
              <li className="flex gap-2">
                <Baby aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Good for children: {yesNo(g?.amenities.goodForChildren ?? null)}
              </li>
              <li className="flex gap-2">
                <Accessibility aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {accessibility.length ? accessibility.join(", ") : "Accessibility not listed"}
              </li>
              <li className="flex gap-2">
                <CreditCard aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {payment.length ? payment.join(", ") : "Payment options not listed"}
              </li>
            </ul>
          </Section>
        </div>

        <div className="mt-4" />
        <Section title="Getting in and back on the road" icon={<Navigation aria-hidden className="size-4" />}>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <dl>
              <Row label="From your route">{formatDistance(rec.straightLineFromRouteM)} (straight line)</Row>
              <Row label="Entrance match">{rec.access.confidence === "good" ? "Route reaches it" : `Nearest road ~${rec.access.snapDistanceM} m away`}</Row>
              {ra && <Row label="Side">{SIDE_LABEL[ra.sideOfSelectedRoute]}</Row>}
            </dl>
            <dl>
              {ra && (
                <Row label="U-turn">
                  {ra.uTurns.additionalToBaseline === "possible" ? "Likely" : ra.uTurns.additionalToBaseline === "none-detected" ? "None detected" : "Unknown"}
                </Row>
              )}
              {ra && (
                <Row label="Backtracking">
                  {ra.backwardTravelNearStop.status === "possible"
                    ? `Possible${ra.backwardTravelNearStop.estimatedMetres ? ` (~${formatDistance(ra.backwardTravelNearStop.estimatedMetres)})` : ""}`
                    : ra.backwardTravelNearStop.status === "not-detected"
                      ? "Not detected"
                      : "Unknown"}
                </Row>
              )}
              {rec.routing?.crossCheck && (
                <Row label="Google cross-check">
                  {rec.routing.crossCheck.status === "agrees" ? "Agrees" : rec.routing.crossCheck.status === "differs" ? "Differs" : "Unavailable"}
                </Row>
              )}
            </dl>
          </div>
        </Section>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Section title="Why it's suggested" icon={<CircleCheck aria-hidden className="size-4" />}>
            <ul className="flex flex-col gap-1.5">
              {rec.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Section>
          <Section title="Not confirmed" icon={<CircleHelp aria-hidden className="size-4" />}>
            {rec.uncertainties.length ? (
              <ul className="flex flex-col gap-1.5 text-muted-foreground">
                {rec.uncertainties.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Nothing flagged.</p>
            )}
          </Section>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card p-5">
          {detailsState.loading && !details ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading reviews…
            </p>
          ) : (
            <Reviews reviews={g?.reviews ?? []} mapsUri={g?.googleMapsUri ?? null} rating={g?.rating ?? null} count={g?.userRatingCount ?? null} />
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Data from Google Maps
          {g?.attributions.length ? `, with content from ${g.attributions.map((a) => a.provider).join(", ")}` : ""}. Check details with the
          restaurant before you go.
        </p>
      </div>

      <aside className="h-[40svh] border-t border-border lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:border-t-0 lg:border-l" aria-label="Route via this stop">
        <Suspense fallback={<div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">Loading map…</div>}>
          <MapView
            source={source}
            destination={destination}
            route={result.route.geometry}
            routeStale={false}
            recommendations={[rec]}
            selectedId={rec.id}
            onSelect={() => undefined}
            onEndpointMove={() => undefined}
            onCenterChange={() => undefined}
          />
        </Suspense>
      </aside>
    </main>
  );
}
