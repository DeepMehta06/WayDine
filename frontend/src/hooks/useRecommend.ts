import { useCallback, useEffect, useRef, useState } from "react";
import type { RecommendRequest, RecommendResponse } from "@contract";
import { ApiError, fetchRecommendations, isAbort } from "@/lib/api";
import type { SelectedPlace } from "@/lib/search-state";

/** The inputs that produced a result, so the UI never shows results for a different trip. */
export interface SearchSnapshot {
  request: RecommendRequest;
  sourceName: string;
  destinationName: string;
}

export interface RecommendState {
  status: "idle" | "loading" | "success" | "error";
  data: RecommendResponse | null;
  snapshot: SearchSnapshot | null;
  /** True while a newer search is running and the visible data belongs to the previous one. */
  stale: boolean;
  error: ApiError | null;
  elapsedSec: number;
}

export function useRecommend() {
  const [state, setState] = useState<RecommendState>({ status: "idle", data: null, snapshot: null, stale: false, error: null, elapsedSec: 0 });
  const controllerRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (state.status !== "loading") return;
    const started = Date.now();
    const t = window.setInterval(() => setState((s) => ({ ...s, elapsedSec: Math.floor((Date.now() - started) / 1000) })), 1000);
    return () => window.clearInterval(t);
  }, [state.status]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async (request: RecommendRequest, source: SelectedPlace, destination: SelectedPlace) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++seq.current;
    setState((s) => ({ ...s, status: "loading", error: null, stale: s.data !== null, elapsedSec: 0 }));
    try {
      const data = await fetchRecommendations(request, controller.signal);
      if (id !== seq.current) return;
      setState({
        status: "success",
        data,
        snapshot: { request, sourceName: source.name, destinationName: destination.name },
        stale: false,
        error: null,
        elapsedSec: 0,
      });
    } catch (err) {
      if (isAbort(err) || id !== seq.current) return;
      setState({
        status: "error",
        data: null,
        snapshot: null,
        stale: false,
        error: err instanceof ApiError ? err : new ApiError("INTERNAL", "Something went wrong. Please try again."),
        elapsedSec: 0,
      });
    }
  }, []);

  const cancel = useCallback(() => {
    seq.current++;
    controllerRef.current?.abort();
    setState((s) => ({ ...s, status: s.data ? "success" : "idle", stale: false, elapsedSec: 0 }));
  }, []);

  const reset = useCallback(() => {
    seq.current++;
    controllerRef.current?.abort();
    setState({ status: "idle", data: null, snapshot: null, stale: false, error: null, elapsedSec: 0 });
  }, []);

  return { ...state, run, cancel, reset };
}
