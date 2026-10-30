/**
 * Google photos for one restaurant (max 5). Every image uses the same width so
 * each photo is at most one billable request; the redirect is browser-cached.
 */
import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { GoogleRestaurantDetails } from "@contract";
import { googlePhotoUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

const WIDTH = 960;

export function PhotoGallery({ photos, name }: { photos: GoogleRestaurantDetails["photos"]; name: string }) {
  const list = photos.slice(0, 5);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  if (list.length === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted text-sm text-muted-foreground">
        <ImageOff aria-hidden className="size-4" />
        No photos listed on Google
      </div>
    );
  }

  const current = list[Math.min(active, list.length - 1)]!;
  const author = current.authorAttributions[0];

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-muted">
        {failed[current.name] ? (
          <div role="img" aria-label="Photo unavailable" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <ImageOff aria-hidden className="size-4" />
            This photo couldn't be loaded
          </div>
        ) : (
          <img
            key={current.name}
            src={googlePhotoUrl(current.name, WIDTH)}
            alt={`Photo ${active + 1} of ${list.length} at ${name}`}
            className="h-full w-full object-cover"
            onError={() => setFailed((f) => ({ ...f, [current.name]: true }))}
          />
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {author ? (
            <>
              Photo by{" "}
              {author.uri ? (
                <a href={author.uri} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  {author.displayName || "a Google user"}
                </a>
              ) : (
                author.displayName || "a Google user"
              )}{" "}
              · Google Maps
            </>
          ) : (
            "Photo from Google Maps"
          )}
        </span>
        <span className="tabular-nums">
          {active + 1} / {list.length}
        </span>
      </figcaption>
      {list.length > 1 && (
        <div role="tablist" aria-label="Photos" className="flex gap-2 overflow-x-auto pb-1">
          {list.map((p, i) => (
            <button
              key={p.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Show photo ${i + 1}`}
              onClick={() => setActive(i)}
              className={cn(
                "relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-muted transition-colors",
                i === active ? "border-accent" : "border-transparent opacity-80 hover:opacity-100"
              )}
            >
              {!failed[p.name] && (
                <img
                  src={googlePhotoUrl(p.name, WIDTH)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={() => setFailed((f) => ({ ...f, [p.name]: true }))}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}
