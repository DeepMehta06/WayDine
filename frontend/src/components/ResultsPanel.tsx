import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Info } from "lucide-react";
import type { RecommendResponse } from "@contract";
import { RecommendationCard } from "@/components/RecommendationCard";
import { NoResultsState } from "@/components/NoResultsState";
import { WhyExcluded } from "@/components/WhyExcluded";
import { useReducedMotion } from "@/lib/motion";
import type { TripPreferences } from "@/lib/search-state";

const ATTRIBUTION_LINKS: Record<string, string> = {
  "© Mapbox": "https://www.mapbox.com/about/maps/",
  "© OpenStreetMap contributors": "https://www.openstreetmap.org/copyright",
  "Powered by Geoapify": "https://www.geoapify.com/",
};

interface ResultsPanelProps {
  data: RecommendResponse;
  prefs: TripPreferences;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdjust: (patch: Partial<TripPreferences>) => void;
  onEdit: () => void;
}

export function ResultsPanel({ data, prefs, selectedId, onSelect, onAdjust, onEdit }: ResultsPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  const recs = data.recommendations;

  // One authored moment: the list settles in when a new result arrives.
  useEffect(() => {
    if (reduced || !listRef.current) return;
    const items = listRef.current.querySelectorAll("li");
    const tween = gsap.fromTo(items, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.04, ease: "expo.out", clearProps: "all" });
    return () => {
      tween.kill();
    };
  }, [data.requestId, reduced]);

  return (
    <div className="flex flex-col gap-3">
      {data.diagnostics.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Search notes">
          {data.diagnostics.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {recs.length === 0 ? (
        <NoResultsState data={data} prefs={prefs} onAdjust={onAdjust} onEdit={onEdit} />
      ) : (
        <>
          <h2 className="font-sans text-sm font-semibold tracking-normal">
            {recs.length} stop{recs.length === 1 ? "" : "s"} on your way <span className="font-normal text-muted-foreground">· least extra driving first</span>
          </h2>
          <ol ref={listRef} className="flex flex-col gap-2" aria-label="Recommended stops">
            {recs.map((rec) => (
              <li key={rec.id}>
                <RecommendationCard recommendation={rec} selected={selectedId === rec.id} diet={prefs.diet} onSelect={onSelect} />
                {rec.google?.attributions.map((a, i) => <p key={`${a.provider}-${i}`} className="px-2 text-xs text-muted-foreground">{a.providerUri ? <a href={a.providerUri} target="_blank" rel="noreferrer noopener" className="underline">{a.provider}</a> : a.provider}</p>)}
              </li>
            ))}
          </ol>
        </>
      )}

      <WhyExcluded data={data} />

      <p className="text-[11px] text-muted-foreground">
        Map data{" "}
        {data.attribution.map((a, i) => (
          <span key={a}>
            {i > 0 && " · "}
            {ATTRIBUTION_LINKS[a] ? (
              <a href={ATTRIBUTION_LINKS[a]} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                {a}
              </a>
            ) : (
              a
            )}
          </span>
        ))}
        . Listings can be out of date. Check before you go.
      </p>
    </div>
  );
}
