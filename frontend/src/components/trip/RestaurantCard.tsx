import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, Clock, IndianRupee, Leaf, Star, TriangleAlert, UtensilsCrossed } from "lucide-react";
import type { DietPreference, Recommendation } from "@contract";
import { formatExtra, formatWhen } from "@/lib/format";
import { businessStatusLabel, priceLabel, ratingCountLabel } from "@/lib/google";
import { cn } from "@/lib/utils";

function Badge({ tone, icon, children }: { tone: "good" | "neutral" | "warn"; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        tone === "good" && "bg-primary/10 text-primary",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "warn" && "bg-accent/15 text-accent-foreground"
      )}
    >
      {icon}
      {children}
    </span>
  );
}

interface RestaurantCardProps {
  rec: Recommendation;
  selected: boolean;
  diet: DietPreference;
  budgetSet: boolean;
  onSelect: (id: string) => void;
}

export function RestaurantCard({ rec, selected, diet, budgetSet, onSelect }: RestaurantCardProps) {
  const g = rec.google;
  const price = priceLabel(g);
  const closedStatus = businessStatusLabel(g?.businessStatus ?? null);
  const descriptor = [rec.venueType, ...rec.cuisines.slice(0, 2)].filter(Boolean).join(" · ");
  const uTurn = rec.routeAssessment?.uTurns.additionalToBaseline === "possible" || rec.routing?.uTurns;
  const hours = rec.openingHours;

  return (
    <article
      aria-labelledby={`r-${rec.id}`}
      className={cn(
        "group relative rounded-xl border bg-card transition-[border-color,box-shadow]",
        selected ? "border-primary shadow-[0_8px_24px_-14px_rgb(47_79_47/0.6)]" : "border-border hover:border-primary/40"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(rec.id)}
        aria-pressed={selected}
        aria-label={`Show ${rec.name} on the map`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="pointer-events-none relative flex gap-3.5 p-4">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            selected ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground"
          )}
        >
          {rec.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id={`r-${rec.id}`} className="truncate font-sans text-base font-semibold tracking-normal">
                {rec.name}
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                {g?.rating != null && (
                  <span className="flex items-center gap-1 text-foreground">
                    <Star aria-hidden className="size-3.5 fill-accent text-accent" />
                    <span className="font-medium tabular-nums">{g.rating.toFixed(1)}</span>
                    {g.userRatingCount != null && <span className="text-muted-foreground tabular-nums">({ratingCountLabel(g.userRatingCount)})</span>}
                  </span>
                )}
                {price && <span className="tabular-nums">· {price}</span>}
                {descriptor && <span className="truncate capitalize">· {descriptor}</span>}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-2xl leading-none font-semibold text-primary tabular-nums">{formatExtra(rec.extraTimeSec)}</p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">arrive {formatWhen(rec.arrivalTime)}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {closedStatus ? (
              <Badge tone="warn" icon={<TriangleAlert aria-hidden className="size-3" />}>
                {closedStatus}
              </Badge>
            ) : hours.atArrival === "open" ? (
              <Badge tone={hours.closesWithinMinutes !== null ? "warn" : "good"} icon={<Clock aria-hidden className="size-3" />}>
                {hours.closesWithinMinutes !== null ? `Closes ~${hours.closesWithinMinutes} min after you arrive` : "Open when you arrive"}
              </Badge>
            ) : (
              <Badge tone="neutral" icon={<Clock aria-hidden className="size-3" />}>
                Hours not confirmed
              </Badge>
            )}
            {rec.diet.vegetarian === "pure-veg" && (
              <Badge tone="good" icon={<Leaf aria-hidden className="size-3" />}>
                Pure veg
              </Badge>
            )}
            {rec.diet.vegetarian === "options" && (
              <Badge tone="good" icon={<Leaf aria-hidden className="size-3" />}>
                Veg options
              </Badge>
            )}
            {rec.diet.vegetarian === "unknown" && diet !== "any" && (
              <Badge tone="warn" icon={<Leaf aria-hidden className="size-3" />}>
                Veg unconfirmed
              </Badge>
            )}
            {budgetSet && rec.budgetAssessment?.status === "likely-within" && (
              <Badge tone="good" icon={<IndianRupee aria-hidden className="size-3" />}>
                Within budget
              </Badge>
            )}
            {budgetSet && rec.budgetAssessment?.status === "unconfirmed" && (
              <Badge tone="neutral" icon={<IndianRupee aria-hidden className="size-3" />}>
                Price unconfirmed
              </Badge>
            )}
            {rec.mealRecommendation?.service === "listed" && (
              <Badge tone="good" icon={<UtensilsCrossed aria-hidden className="size-3" />}>
                Serves {rec.mealPeriod}
              </Badge>
            )}
            {uTurn && (
              <Badge tone="warn" icon={<TriangleAlert aria-hidden className="size-3" />}>
                U-turn likely
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="relative flex justify-end border-t border-border px-4 py-2">
        <Link
          to={`/trip/stop/${encodeURIComponent(rec.id)}`}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-muted"
        >
          Photos, reviews & details
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  );
}
