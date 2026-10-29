import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/types";

interface RecommendationCardProps {
  rank: number;
  recommendation: Recommendation;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function RecommendationCard({ rank, recommendation, selected, onSelect }: RecommendationCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(recommendation.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(recommendation.id)}
      className={cn(
        "cursor-pointer gap-2 border p-4 transition-colors",
        selected ? "border-primary bg-secondary/40" : "hover:border-primary/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {rank}
          </span>
          <h3 className="text-base leading-tight">{recommendation.name}</h3>
        </div>
        <Badge variant="secondary" className="shrink-0 capitalize">
          {recommendation.mealRecommended}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-8 text-sm text-muted-foreground">
        <span>ETA {recommendation.etaArrival}</span>
        <span>·</span>
        <span>{recommendation.detourMinutes} min detour</span>
        <span>·</span>
        <span>{recommendation.distanceFromRoadM}m off road</span>
      </div>

      <p className="pl-8 text-sm text-muted-foreground">{recommendation.reason}</p>
    </Card>
  );
}
