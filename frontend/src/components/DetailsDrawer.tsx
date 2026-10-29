import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Recommendation } from "@/types";

interface DetailsDrawerProps {
  recommendation: Recommendation | null;
  onClose: () => void;
}

export function DetailsDrawer({ recommendation, onClose }: DetailsDrawerProps) {
  return (
    <Sheet open={Boolean(recommendation)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        {recommendation && (
          <>
            <SheetHeader>
              <SheetTitle>{recommendation.name}</SheetTitle>
              <SheetDescription>
                {recommendation.cuisine ?? "Cuisine not specified"} · {recommendation.side} side
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="capitalize">
                  {recommendation.mealRecommended}
                </Badge>
                <Badge variant="outline">
                  {recommendation.openAtArrival === null
                    ? "Hours unconfirmed"
                    : recommendation.openAtArrival
                      ? "Open now"
                      : "Closed"}
                </Badge>
              </div>

              <Separator />

              <dl className="grid grid-cols-2 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Arrival</dt>
                <dd className="text-right font-medium">{recommendation.etaArrival}</dd>
                <dt className="text-muted-foreground">Detour</dt>
                <dd className="text-right font-medium">{recommendation.detourMinutes} min</dd>
                <dt className="text-muted-foreground">Off the road</dt>
                <dd className="text-right font-medium">{recommendation.distanceFromRoadM} m</dd>
                <dt className="text-muted-foreground">Match score</dt>
                <dd className="text-right font-medium">{Math.round(recommendation.score * 100)}%</dd>
              </dl>

              <Separator />

              <p className="text-sm text-muted-foreground">{recommendation.reason}</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
