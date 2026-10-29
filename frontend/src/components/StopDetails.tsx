import { useEffect, useRef } from "react";
import { ArrowLeft, ExternalLink, Navigation, Phone, Globe, CircleCheck, CircleHelp } from "lucide-react";
import type { LngLat, Provider, Recommendation, RecommendResponse } from "@contract";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration, formatExtra, formatWhen } from "@/lib/format";

interface StopDetailsProps {
  rec: Recommendation;
  data: RecommendResponse;
  source: LngLat;
  destination: LngLat;
  destinationName: string;
  onBack: () => void;
}

const PROVIDER_NAME: Record<Provider, string> = { mapbox: "Mapbox", geoapify: "OpenStreetMap" };
const latLng = ([lng, lat]: LngLat) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

/** Hand-off links only: these open the user's map app; no third-party API is called. */
function googleMapsUrl(origin: LngLat, destination: LngLat, waypoint?: LngLat): string {
  const p = new URLSearchParams({ api: "1", origin: latLng(origin), destination: latLng(destination), travelmode: "driving" });
  if (waypoint) p.set("waypoints", latLng(waypoint));
  return `https://www.google.com/maps/dir/?${p}`;
}

export function StopDetails({ rec, data, source, destination, destinationName, onBack }: StopDetailsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [rec.id]);

  const hours = rec.openingHours;
  const delay = new Date(rec.destinationArrivalTime).getTime() - new Date(data.route.arrivalTime).getTime();
  const osm = rec.sources.find((s) => s.url);

  return (
    <article aria-labelledby="stop-title" className="flex flex-col gap-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2 w-fit">
        <ArrowLeft aria-hidden />
        All stops
      </Button>

      <header>
        <h2 id="stop-title" ref={headingRef} tabIndex={-1} className="font-sans text-lg leading-snug font-semibold tracking-normal outline-none">
          {rec.name}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground capitalize">
          {[rec.venueType, ...rec.cuisines].filter(Boolean).join(" · ") || "Food place"}
        </p>
        {rec.address && <p className="mt-1 text-sm text-muted-foreground">{rec.address}</p>}
      </header>

      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11 md:h-9">
          <a href={googleMapsUrl(source, destination, rec.routedTo)} target="_blank" rel="noreferrer">
            <Navigation aria-hidden />
            Navigate via this stop
          </a>
        </Button>
        <Button asChild variant="outline" className="h-11 md:h-9">
          <a href={googleMapsUrl(source, rec.routedTo)} target="_blank" rel="noreferrer">
            Directions to stop only
          </a>
        </Button>
        {rec.phone && (
          <Button asChild variant="outline" className="h-11 md:h-9">
            <a href={`tel:${rec.phone.replace(/[^\d+]/g, "")}`}>
              <Phone aria-hidden />
              Call
            </a>
          </Button>
        )}
        {rec.website && (
          <Button asChild variant="outline" className="h-11 md:h-9">
            <a href={rec.website} target="_blank" rel="noreferrer noopener">
              <Globe aria-hidden />
              Website
            </a>
          </Button>
        )}
      </div>

      <section aria-label="Timing" className="rounded-lg border border-border bg-card p-3">
        <ol className="flex flex-col gap-2 text-sm tabular-nums">
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">Leave</span>
            <span>{formatWhen(data.route.departureTime)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">Reach {rec.name}</span>
            <span className="font-medium">{formatWhen(rec.arrivalTime)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-muted-foreground">Reach {destinationName}</span>
            <span>
              {formatWhen(rec.destinationArrivalTime)}
              <span className="ml-1.5 text-xs text-muted-foreground">({delay < 30_000 ? "same as no stop" : `${formatDuration(delay / 1000)} later`})</span>
            </span>
          </li>
        </ol>
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {formatExtra(rec.extraTimeSec)} of driving ({formatDistance(rec.extraDistanceM)} further), routed to the stop's entrance and back to your
          route. Times are India time (IST) and don't include time spent eating.
        </p>
      </section>

      <section aria-label="Opening hours">
        <h3 className="font-sans text-sm font-semibold tracking-normal">Opening hours</h3>
        <p className="mt-1 text-sm">
          {hours.atArrival === "open"
            ? `Expected to be open when you arrive (${formatWhen(rec.arrivalTime)}).`
            : "Unknown: no listed hours, or the listings disagree. It may be closed."}
          {hours.closesWithinMinutes !== null && ` Listed as closing about ${hours.closesWithinMinutes} min after you arrive.`}
        </p>
        {hours.text && (
          <p className="mt-1 text-xs text-muted-foreground">
            Listed hours{hours.source ? ` (${PROVIDER_NAME[hours.source]})` : ""}: {hours.text}
          </p>
        )}
      </section>

      <section aria-label="What we know">
        <h3 className="font-sans text-sm font-semibold tracking-normal">Why it's suggested</h3>
        <ul className="mt-1.5 flex flex-col gap-1.5 text-sm">
          {rec.facts.map((f) => (
            <li key={f} className="flex gap-2">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        {rec.uncertainties.length > 0 && (
          <>
            <h3 className="mt-3 font-sans text-sm font-semibold tracking-normal">Not confirmed</h3>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-sm">
              {rec.uncertainties.map((u) => (
                <li key={u} className="flex gap-2 text-muted-foreground">
                  <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{u}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Location" className="text-xs text-muted-foreground">
        <p>
          About {formatDistance(rec.straightLineFromRouteM)} from your route in a straight line. Driving distance differs; the map shows
          the actual route to the stop and back.
        </p>
        <p className="mt-1">
          Listed by {rec.sources.map((s) => PROVIDER_NAME[s.provider]).join(" and ")}.{" "}
          {osm?.url && (
            <a href={osm.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">
              View listing on OpenStreetMap
              <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
        </p>
        <p className="mt-1">No ratings or reviews are available from these sources.</p>
      </section>
    </article>
  );
}
