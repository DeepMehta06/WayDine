import type { ReactNode } from "react";
import { Clock, Leaf, TriangleAlert } from "lucide-react";
import type { DietPreference, Recommendation } from "@contract";
import { formatExtra, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RecommendationCardProps {
  recommendation: Recommendation;
  selected: boolean;
  diet: DietPreference;
  onSelect: (id: string) => void;
}

function Pill({ tone, children }: { tone: "good" | "neutral" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        tone === "good" && "bg-primary/10 text-primary",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "warn" && "bg-accent/15 text-accent-foreground"
      )}
    >
      {children}
    </span>
  );
}

export function RecommendationCard({ recommendation: r, selected, diet, onSelect }: RecommendationCardProps) {
  const descriptor = [r.venueType, ...r.cuisines.slice(0, 3)].filter(Boolean).join(" · ");
  const hours = r.openingHours;

  return (
    <button
      type="button"
      onClick={() => onSelect(r.id)}
      aria-pressed={selected}
      aria-label={`${r.rank}. ${r.name}, ${formatExtra(r.extraTimeSec)}, arrive ${formatWhen(r.arrivalTime)}`}
      className={cn(
        "group w-full rounded-lg border bg-card p-3.5 text-left transition-colors",
        selected ? "border-primary bg-secondary/50" : "border-border hover:border-primary/40 hover:bg-muted/40"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            selected ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground"
          )}
        >
          {r.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate font-sans text-[15px] font-semibold tracking-normal">{r.name}</h3>
            <span className="shrink-0 text-sm font-semibold text-primary tabular-nums">{formatExtra(r.extraTimeSec)}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground capitalize">
            {descriptor || "Food place"} · arrive {formatWhen(r.arrivalTime)}
          </p>
          {r.sources.some((source) => source.provider === "google") && <p translate="no" className="mt-1 whitespace-nowrap font-sans text-xs font-normal text-[#5e5e5e]">Google Maps</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hours.atArrival === "open" ? (
              <Pill tone={hours.closesWithinMinutes !== null ? "warn" : "good"}>
                <Clock aria-hidden className="size-3" />
                {hours.closesWithinMinutes !== null ? `Closes ~${hours.closesWithinMinutes} min after you arrive` : "Open when you arrive"}
              </Pill>
            ) : (
              <Pill tone="neutral">
                <Clock aria-hidden className="size-3" />
                Hours not listed
              </Pill>
            )}
            {r.diet.vegetarian === "pure-veg" && (
              <Pill tone="good">
                <Leaf aria-hidden className="size-3" />
                Pure veg
              </Pill>
            )}
            {r.diet.vegetarian === "options" && (
              <Pill tone="good">
                <Leaf aria-hidden className="size-3" />
                Veg options
              </Pill>
            )}
            {r.diet.vegetarian === "unknown" && diet !== "any" && (
              <Pill tone="warn">
                <Leaf aria-hidden className="size-3" />
                Veg unconfirmed
              </Pill>
            )}
            {r.access.confidence === "uncertain" && (
              <Pill tone="warn">
                <TriangleAlert aria-hidden className="size-3" />
                Entrance unclear
              </Pill>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
