import { useState } from "react";
import { ArrowRight, Check, Link2, Pencil } from "lucide-react";
import type { RecommendResponse } from "@contract";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration, formatWhen } from "@/lib/format";

interface TripSummaryProps {
  data: RecommendResponse;
  sourceName: string;
  destinationName: string;
  onEdit?: () => void;
  onChooseRoute: (index: number) => void;
  shareUrl: string;
  busy: boolean;
}

export function TripSummary({ data, sourceName, destinationName, onEdit, onChooseRoute, shareUrl, busy }: TripSummaryProps) {
  const { route } = data;
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const fastest = Math.min(...route.alternatives.map((a) => a.durationSec));

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied("idle"), 2500);
  }

  return (
    <section aria-label="Trip summary" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-sans text-base font-semibold tracking-normal">
          <span className="truncate">{sourceName}</span>
          <ArrowRight aria-label="to" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{destinationName}</span>
        </h2>
        {onEdit && (
          <Button type="button" variant="outline" size="sm" onClick={onEdit} className="shrink-0">
            <Pencil aria-hidden />
            Edit
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        {formatDistance(route.distanceM)} · {formatDuration(route.durationSec)} driving · arrive {formatWhen(route.arrivalTime)} without a stop
        {route.summary ? <span className="block truncate text-xs">via {route.summary}</span> : null}
      </p>

      {route.alternatives.length > 1 && (
        <div role="radiogroup" aria-label="Route to search along" className="flex flex-wrap gap-1.5">
          {route.alternatives.map((alt) => {
            const selected = alt.index === route.index;
            const slower = alt.durationSec - fastest;
            return (
              <button
                key={alt.index}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => !selected && onChooseRoute(alt.index)}
                className={
                  selected
                    ? "rounded-full border border-primary bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                    : "rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
                }
              >
                {slower < 30 ? "Fastest" : `+${formatDuration(slower)}`} · {formatDistance(alt.distanceM)}
                {alt.summary ? ` · ${alt.summary.split(",")[0]}` : ""}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={copy} className="-ml-2 text-primary">
          {copied === "copied" ? <Check aria-hidden /> : <Link2 aria-hidden />}
          {copied === "copied" ? "Link copied" : copied === "failed" ? "Couldn't copy link" : "Copy link to this trip"}
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied === "copied" ? "Link copied to clipboard" : ""}
        </span>
      </div>
    </section>
  );
}
