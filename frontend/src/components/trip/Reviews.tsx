import { useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import type { GoogleRestaurantDetails } from "@contract";

const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });

function relative(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(months, "month");
  return rtf.format(Math.round(days / 365), "year");
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden className={i <= Math.round(value) ? "size-3.5 fill-accent text-accent" : "size-3.5 text-border"} />
      ))}
    </span>
  );
}

function ReviewItem({ review }: { review: GoogleRestaurantDetails["reviews"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const long = (review.text?.length ?? 0) > 280;
  const author = review.author;
  return (
    <li className="flex gap-3 border-b border-border py-4 last:border-b-0">
      {author?.photoUri ? (
        <img src={author.photoUri} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-9 shrink-0 rounded-full bg-muted object-cover" />
      ) : (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {(author?.displayName || "G").slice(0, 1)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {author?.uri ? (
            <a href={author.uri} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
              {author.displayName || "Google user"}
            </a>
          ) : (
            <span className="text-sm font-medium">{author?.displayName || "Google user"}</span>
          )}
          {review.rating != null && <Stars value={review.rating} />}
          {relative(review.publishTime) && <span className="text-xs text-muted-foreground">{relative(review.publishTime)}</span>}
        </div>
        {review.text && (
          <p className={expanded || !long ? "mt-1.5 text-sm leading-relaxed whitespace-pre-line" : "mt-1.5 line-clamp-4 text-sm leading-relaxed whitespace-pre-line"}>
            {review.text}
          </p>
        )}
        {long && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-sm font-medium text-primary hover:underline">
            {expanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>
    </li>
  );
}

export function Reviews({ reviews, mapsUri, rating, count }: { reviews: GoogleRestaurantDetails["reviews"]; mapsUri: string | null; rating: number | null; count: number | null }) {
  return (
    <section aria-labelledby="reviews-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="reviews-title" className="font-sans text-lg font-semibold tracking-normal">
            Reviews
          </h2>
          {rating != null && (
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-display text-2xl leading-none font-semibold text-foreground tabular-nums">{rating.toFixed(1)}</span>
              <Stars value={rating} />
              {count != null && <span className="tabular-nums">{count.toLocaleString("en-IN")} ratings on Google</span>}
            </p>
          )}
        </div>
        {mapsUri && (
          <a href={mapsUri} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
            All reviews
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
      {reviews.length ? (
        <ul className="mt-2">
          {reviews.map((r, i) => (
            <ReviewItem key={`${r.author?.displayName ?? "r"}-${r.publishTime ?? i}`} review={r} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Google returned no written reviews for this place.</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Reviews from Google Maps, shown as written by their authors.</p>
    </section>
  );
}
