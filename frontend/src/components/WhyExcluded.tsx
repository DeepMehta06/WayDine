import type { ExclusionStage, RecommendResponse } from "@contract";
import { formatDistance } from "@/lib/format";

export const STAGE_LABEL: Record<ExclusionStage, string> = {
  detour: "Too much extra driving",
  hours: "Closed when you'd arrive",
  diet: "Doesn't meet your food choice",
  cuisine: "Cuisine doesn't match",
  unreachable: "No drivable access found",
  verification: "Couldn't be checked right now",
};

/** Search transparency: what was found, what was considered, and why the rest isn't shown. */
export function WhyExcluded({ data, defaultOpen = false }: { data: RecommendResponse; defaultOpen?: boolean }) {
  const d = data.diagnostics;
  const stages = (Object.entries(d.excludedByStage) as Array<[ExclusionStage, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const byStage = new Map<ExclusionStage, typeof data.excluded>();
  for (const e of data.excluded) byStage.set(e.stage, [...(byStage.get(e.stage) ?? []), e]);

  return (
    <details open={defaultOpen} className="rounded-lg border border-border bg-card text-sm">
      <summary className="cursor-pointer px-3 py-2.5 font-medium">How this search worked</summary>
      <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-muted-foreground">
        <p>
          Found {d.inCorridor} listed food place{d.inCorridor === 1 ? "" : "s"} within {formatDistance(d.corridorHalfWidthM)} of your route (from{" "}
          {d.discovered.geoapify} OpenStreetMap and {d.discovered.mapbox} Mapbox listings, after merging duplicates). Checked travel time to{" "}
          {d.screened}, and routed {d.verified} in full to their entrances.
        </p>
        {d.notEvaluated > 0 && (
          <p>
            {d.notEvaluated} more weren't checked in detail: each search has a fixed free routing allowance, so places closest to the route
            along each part of the trip go first.
          </p>
        )}
        {d.searchAreas.truncated > 0 && (
          <p>
            {d.searchAreas.truncated} of {d.searchAreas.total} stretches of the route had more restaurants than our sources return per search,
            so some places there weren't seen at all.
          </p>
        )}
        {stages.length > 0 && (
          <ul className="flex flex-col gap-2">
            {stages.map(([stage, count]) => (
              <li key={stage}>
                <details>
                  <summary className="cursor-pointer text-foreground">
                    {STAGE_LABEL[stage]} <span className="text-muted-foreground tabular-nums">({count})</span>
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1 pl-3 text-xs">
                    {(byStage.get(stage) ?? []).slice(0, 12).map((e) => (
                      <li key={e.id}>
                        <span className="font-medium text-foreground">{e.name}</span>: {e.reason}
                      </li>
                    ))}
                    {(byStage.get(stage)?.length ?? 0) < count && <li>…and {count - (byStage.get(stage)?.length ?? 0)} more.</li>}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs">
          Ranking: least extra driving first, with a documented penalty for each missing piece of evidence (unlisted hours, unclear
          entrance, unconfirmed diet). Neither data source provides ratings or reviews, so quality isn't ranked.
        </p>
      </div>
    </details>
  );
}
