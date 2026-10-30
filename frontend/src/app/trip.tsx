/**
 * The current trip and its results, held in memory only. Moving between the
 * results list and a restaurant page never re-runs a (billable) search;
 * Google content is not persisted to browser storage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GoogleRecommendRequest, GoogleRecommendResponse, UserPreferences } from "@contract";
import { ApiError, fetchGoogleRecommendations, isAbort } from "@/lib/api";
import { istLocalInputToIso } from "@/lib/format";
import type { DepartureChoice, SelectedPlace } from "@/lib/search-state";

export interface TripDraft {
  source: SelectedPlace | null;
  destination: SelectedPlace | null;
  sourceText?: string;
  destinationText?: string;
  departure: DepartureChoice;
  /** Per-trip changes to saved preferences; omitted fields use the saved value. */
  overrides: Partial<UserPreferences>;
}

export interface TripSearch {
  draft: TripDraft & { source: SelectedPlace; destination: SelectedPlace };
  routeIndex?: number;
}

type Status = "idle" | "loading" | "success" | "error";

interface TripValue {
  draft: TripDraft;
  setDraft: (update: (d: TripDraft) => TripDraft) => void;
  search: TripSearch | null;
  result: GoogleRecommendResponse | null;
  status: Status;
  error: ApiError | null;
  elapsedSec: number;
  run: (search: TripSearch) => void;
  cancel: () => void;
}

const TripContext = createContext<TripValue | null>(null);

export const EMPTY_DRAFT: TripDraft = { source: null, destination: null, departure: { mode: "now" }, overrides: {} };

export function toRequest(search: TripSearch): GoogleRecommendRequest | null {
  const { draft } = search;
  const departure =
    draft.departure.mode === "now"
      ? ({ mode: "now" } as const)
      : (() => {
          const time = istLocalInputToIso(draft.departure.local);
          return time ? ({ mode: "at", time } as const) : null;
        })();
  if (!departure) return null;
  return {
    source: draft.source.coordinates,
    destination: draft.destination.coordinates,
    departure,
    tripLabels: { source: draft.source.name.trim().slice(0, 120), destination: draft.destination.name.trim().slice(0, 120) },
    ...(Object.keys(draft.overrides).length ? { preferences: draft.overrides } : {}),
    ...(search.routeIndex !== undefined ? { routeIndex: search.routeIndex } : {}),
  };
}

export function TripProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<TripDraft>(EMPTY_DRAFT);
  const [search, setSearch] = useState<TripSearch | null>(null);
  const [result, setResult] = useState<GoogleRecommendResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<ApiError | null>(null);
  const [elapsedSec, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (status !== "loading") return;
    const started = Date.now();
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [status]);

  useEffect(() => () => controller.current?.abort(), []);

  const setDraft = useCallback((update: (d: TripDraft) => TripDraft) => setDraftState(update), []);

  const run = useCallback((next: TripSearch) => {
    const body = toRequest(next);
    if (!body) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const id = ++seq.current;
    setSearch(next);
    setStatus("loading");
    setError(null);
    setElapsed(0);
    fetchGoogleRecommendations(body, c.signal).then(
      (data) => {
        if (id !== seq.current) return;
        setResult(data);
        setStatus("success");
      },
      (err) => {
        if (isAbort(err) || id !== seq.current) return;
        setResult(null);
        setError(err instanceof ApiError ? err : new ApiError("INTERNAL", "Something went wrong. Please try again."));
        setStatus("error");
      }
    );
  }, []);

  const cancel = useCallback(() => {
    seq.current++;
    controller.current?.abort();
    setStatus((s) => (s === "loading" ? (result ? "success" : "idle") : s));
  }, [result]);

  const value = useMemo<TripValue>(
    () => ({ draft, setDraft, search, result, status, error, elapsedSec, run, cancel }),
    [draft, setDraft, search, result, status, error, elapsedSec, run, cancel]
  );
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTrip(): TripValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrip must be used inside TripProvider");
  return ctx;
}
