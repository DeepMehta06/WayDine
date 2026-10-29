import { useEffect, useRef } from "react";
import gsap from "gsap";
import { RecommendationCard } from "@/components/RecommendationCard";
import { NoResultsState } from "@/components/NoResultsState";
import { useLenis } from "@/hooks/useLenis";
import type { ExcludedRestaurant, Recommendation } from "@/types";

interface ResultsPanelProps {
  recommendations: Recommendation[];
  excluded: ExcludedRestaurant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ResultsPanel({ recommendations, excluded, selectedId, onSelect }: ResultsPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLenis(wrapperRef);

  useEffect(() => {
    if (!listRef.current || recommendations.length === 0) return;
    const cards = listRef.current.querySelectorAll("[data-card]");
    gsap.fromTo(
      cards,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: "power2.out" }
    );
  }, [recommendations]);

  if (recommendations.length === 0) {
    return <NoResultsState excluded={excluded} />;
  }

  return (
    <div ref={wrapperRef} className="h-full overflow-y-auto">
      <div ref={listRef} className="flex flex-col gap-3 p-4">
        {recommendations.map((rec, i) => (
          <div key={rec.id} data-card>
            <RecommendationCard
              rank={i + 1}
              recommendation={rec}
              selected={selectedId === rec.id}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
