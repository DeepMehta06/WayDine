/** History reads never reload provider content or automatically rerun a search. */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Clock3, Loader2, RotateCcw, Trash2 } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { TripHistoryEntry } from "@contract";
import { EMPTY_DRAFT, useTrip } from "@/app/trip";
import { Button } from "@/components/ui/button";
import { ApiError, deleteTripHistory, getTripHistory, isAbort } from "@/lib/api";
import { describePreferences } from "@/lib/preferences";
import { useReducedMotion } from "@/lib/motion";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function TripHistoryPanel({ preview = false }: { preview?: boolean }) {
  const [trips, setTrips] = useState<TripHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const list = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const { setDraft } = useTrip();
  const reduced = useReducedMotion();

  const read = useCallback(async (after?: string) => {
    ctl.current?.abort();
    const controller = new AbortController();
    ctl.current = controller;
    const id = ++sequence.current;
    try {
      const response = await getTripHistory(preview ? 3 : 20, after, controller.signal);
      if (id !== sequence.current) return;
      setTrips(previous => after ? [...previous, ...response.trips.filter(trip => !previous.some(old => old.id === trip.id))] : response.trips);
      setCursor(response.nextCursor);
    } catch (err) {
      if (!isAbort(err) && id === sequence.current) setError(err instanceof ApiError ? err.message : "Couldn't load your trips. Try again.");
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, [preview]);

  const cancelRead = useCallback(() => { sequence.current++; ctl.current?.abort(); }, []);

  function load(after?: string) {
    setLoading(true);
    setError(null);
    return read(after);
  }

  useEffect(() => {
    void read();
    return cancelRead;
  }, [read, cancelRead]);

  useGSAP(() => {
    if (!reduced && list.current) gsap.fromTo(list.current.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.04, clearProps: "all" });
  }, { dependencies: [trips, reduced], scope: list });

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const current = sequence.current;
    try {
      await deleteTripHistory(id === "all" ? undefined : id);
      if (current !== sequence.current) return;
      setTrips(previous => id === "all" ? [] : previous.filter(trip => trip.id !== id));
      if (id === "all") setCursor(null);
      setConfirm(null);
      setNotice(id === "all" ? "Trip history cleared." : "Trip removed from history.");
    } catch (err) {
      if (current === sequence.current) setError(err instanceof ApiError ? err.message : "Couldn't remove the trip. Try again.");
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }

  function planAgain(trip: TripHistoryEntry) {
    setDraft(() => ({ ...EMPTY_DRAFT, sourceText: trip.sourceLabel, destinationText: trip.destinationLabel, overrides: structuredClone(trip.preferences) }));
    navigate("/plan");
  }

  return (
    <section aria-labelledby={titleId} className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-2 font-sans text-lg font-semibold tracking-normal">
          <Clock3 aria-hidden className="size-5 text-primary" />{preview ? "Recent trips" : "Your planned trips"}
        </h2>
        {preview ? <Link to="/history" className="text-sm font-medium text-primary underline underline-offset-4">View all trips</Link>
          : trips.length > 0 && <Button variant="ghost" disabled={busy || loading} onClick={() => setConfirm("all")}><Trash2 aria-hidden />Clear history</Button>}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Your successful trip searches, saved to your account. These are plans, not confirmed journeys.</p>
      <p className="mt-1 text-xs text-muted-foreground">View past plans without starting a new search. Planning again lets you review the places first.</p>

      {confirm === "all" && <div role="alert" className="mt-4 rounded-lg border border-border bg-card p-4 text-sm">
        <p>Remove all your saved trip history? This cannot be undone.</p>
        <div className="mt-3 flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Keep history</Button><Button variant="destructive" disabled={busy} onClick={() => void remove("all")}>Remove all trips</Button></div>
      </div>}

      {error && <div role="alert" className="mt-4 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
        <p>{error}</p>{!confirm && <Button variant="outline" className="mt-2" disabled={busy || loading} onClick={() => void load()}>Try again</Button>}
      </div>}
      {notice && <p role="status" className="mt-3 text-sm text-primary">{notice}</p>}
      {loading && <p role="status" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Loading trips…</p>}
      {!loading && !error && trips.length === 0 && !cursor && <div className="mt-5 rounded-xl border border-dashed border-border px-5 py-8 text-center">
        <p className="font-medium">No trips yet</p><p className="mt-1 text-sm text-muted-foreground">Your next successful search will appear here.</p>
        <Link to="/plan" className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4">Plan your first trip</Link>
      </div>}

      <ol ref={list} className="mt-5 space-y-3">
        {trips.map(trip => <li key={trip.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 className="flex flex-wrap items-center gap-x-2 font-sans text-base font-semibold tracking-normal"><span className="break-words">{trip.sourceLabel}</span><ArrowRight aria-label="to" className="size-4 shrink-0 text-muted-foreground" /><span className="break-words">{trip.destinationLabel}</span></h3>
          <dl className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            <div><dt className="inline text-muted-foreground">Planned: </dt><dd className="inline">{dateTime.format(new Date(trip.createdAt))} IST</dd></div>
            <div><dt className="inline text-muted-foreground">Departure: </dt><dd className="inline">{dateTime.format(new Date(trip.departureTime))} IST</dd></div>
            <div><dt className="inline text-muted-foreground">Stops returned: </dt><dd className="inline">{trip.resultCount}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-foreground/75">{describePreferences(trip.preferences)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => planAgain(trip)} disabled={busy}><RotateCcw aria-hidden />Plan a similar trip</Button>
            <Button variant="ghost" aria-label={`Remove trip from ${trip.sourceLabel} to ${trip.destinationLabel}`} onClick={() => setConfirm(trip.id)} disabled={busy || loading}><Trash2 aria-hidden />Remove</Button>
          </div>
          {confirm === trip.id && <div role="alert" className="mt-3 border-t border-border pt-3 text-sm"><p>Remove this trip from your history? This cannot be undone.</p><div className="mt-2 flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Keep trip</Button><Button variant="destructive" disabled={busy} onClick={() => void remove(trip.id)}>Remove trip</Button></div></div>}
        </li>)}
      </ol>
      {!preview && cursor && <Button className="mt-5" variant="outline" disabled={busy || loading} onClick={() => void load(cursor)}>Load older trips</Button>}
    </section>
  );
}
