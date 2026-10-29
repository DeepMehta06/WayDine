import type { ExclusionStage, RecommendResponse } from "@contract";
import { Button } from "@/components/ui/button";
import { formatDistance } from "@/lib/format";
import { DETOUR_OPTIONS, type TripPreferences } from "@/lib/search-state";
import { STAGE_LABEL } from "@/components/WhyExcluded";

interface NoResultsStateProps {
  data: RecommendResponse;
  prefs: TripPreferences;
  onAdjust: (patch: Partial<TripPreferences>) => void;
  onEdit: () => void;
}

export function NoResultsState({ data, prefs, onAdjust, onEdit }: NoResultsStateProps) {
  const d = data.diagnostics;
  const stages = d.excludedByStage as Partial<Record<ExclusionStage, number>>;
  const nextDetour = DETOUR_OPTIONS.find((m) => m > prefs.maxDetourMinutes);
  const topReasons = (Object.entries(stages) as Array<[ExclusionStage, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const nothingNearby = d.inCorridor === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h3 className="font-sans text-base font-semibold tracking-normal">
        {nothingNearby ? "No listed food places near this route" : "No stops fit this trip"}
      </h3>
      <p className="text-sm text-muted-foreground">
        {nothingNearby
          ? `Our data sources list no restaurants within ${formatDistance(d.corridorHalfWidthM)} of the route. Places may exist that aren't listed. Allowing more extra driving searches a wider strip.`
          : `We found ${d.inCorridor} place${d.inCorridor === 1 ? "" : "s"} near the route, but none passed every check.`}
      </p>
      {topReasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {topReasons.map(([stage, n]) => (
            <li key={stage}>
              {STAGE_LABEL[stage]}: <span className="tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {nextDetour && (
          <Button type="button" variant="outline" size="lg" onClick={() => onAdjust({ maxDetourMinutes: nextDetour })}>
            Allow up to {nextDetour} min extra
          </Button>
        )}
        {(stages.diet ?? 0) > 0 && prefs.diet !== "any" && !prefs.includeUnconfirmedDiet && (
          <Button type="button" variant="outline" size="lg" onClick={() => onAdjust({ includeUnconfirmedDiet: true })}>
            Include unconfirmed veg info
          </Button>
        )}
        {(stages.cuisine ?? 0) > 0 && prefs.cuisines.length > 0 && (
          <Button type="button" variant="outline" size="lg" onClick={() => onAdjust({ cuisines: [] })}>
            Any cuisine
          </Button>
        )}
        {(stages.hours ?? 0) > 0 && prefs.departure.mode === "at" && (
          <Button type="button" variant="outline" size="lg" onClick={() => onAdjust({ departure: { mode: "now" } })}>
            Leave now instead
          </Button>
        )}
        <Button type="button" variant="ghost" size="lg" onClick={onEdit}>
          Change trip
        </Button>
      </div>
    </div>
  );
}
