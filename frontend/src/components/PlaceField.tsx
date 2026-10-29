/**
 * Endpoint search field implementing the ARIA combobox pattern. Text and the
 * selected place are owned by the parent: any edit clears the selection, so
 * the coordinates submitted always belong to the visible choice.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Loader2, MapPin, RotateCw, X } from "lucide-react";
import type { LngLat, PlaceSuggestion } from "@contract";
import { Input } from "@/components/ui/input";
import { ApiError, isAbort, suggestPlaces } from "@/lib/api";
import { kindLabel } from "@/lib/format";
import type { SelectedPlace } from "@/lib/search-state";
import { cn } from "@/lib/utils";

export interface PlaceFieldProps {
  id: string;
  label: string;
  placeholder: string;
  text: string;
  place: SelectedPlace | null;
  onTextChange: (text: string) => void;
  onSelect: (place: SelectedPlace) => void;
  /** Biases suggestions (the other endpoint, map centre, or the user's location). */
  near: LngLat | null;
  error?: string | null;
  action?: ReactNode;
  debounceMs?: number;
}

type Status = "idle" | "loading" | "ready" | "empty" | "error";

export function PlaceField({
  id,
  label,
  placeholder,
  text,
  place,
  onTextChange,
  onSelect,
  near,
  error,
  action,
  debounceMs = 250,
}: PlaceFieldProps) {
  const listId = useId();
  const statusId = useId();
  const hintId = useId();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [partial, setPartial] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retryToken, setRetryToken] = useState(0);
  const seq = useRef(0);
  const nearRef = useRef(near);
  nearRef.current = near;

  const query = text.trim();
  const searching = place === null && query.length >= 2;

  useEffect(() => {
    const requestId = ++seq.current;
    if (!searching) {
      setSuggestions([]);
      setStatus("idle");
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const res = await suggestPlaces(query, nearRef.current, controller.signal);
        if (requestId !== seq.current) return;
        setSuggestions(res.suggestions);
        setPartial(res.partial);
        setStatus(res.suggestions.length ? "ready" : "empty");
        setActive(res.suggestions.length ? 0 : -1);
        setOpen(true);
      } catch (err) {
        if (isAbort(err) || requestId !== seq.current) return;
        setSuggestions([]);
        setErrorMessage(err instanceof ApiError ? err.message : "Place search failed.");
        setStatus("error");
        setOpen(true);
      }
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching, retryToken, debounceMs]);

  function choose(s: PlaceSuggestion) {
    seq.current++;
    setOpen(false);
    setSuggestions([]);
    setStatus("idle");
    onSelect(s);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && suggestions.length) setOpen(true);
      setActive((i) => (suggestions.length ? (i + 1) % suggestions.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : -1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && suggestions[active]) {
        e.preventDefault();
        choose(suggestions[active]!);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const showList = open && (status === "ready" || status === "empty" || status === "error");
  const statusText =
    status === "loading"
      ? "Searching…"
      : status === "ready"
        ? `${suggestions.length} place${suggestions.length === 1 ? "" : "s"} found. Use up and down arrows to choose.`
        : status === "empty"
          ? `No places match “${query}”.`
          : status === "error"
            ? (errorMessage ?? "Place search failed.")
            : place
              ? `Selected ${place.name}.`
              : "";

  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {action}
      </div>
      <div className="relative">
        <MapPin aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-opt-${active}` : undefined}
          aria-describedby={`${hintId} ${statusId}`}
          aria-invalid={Boolean(error) || undefined}
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          className="h-11 pr-10 pl-9 text-base md:h-10 md:text-sm"
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length && !place && setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
          {status === "loading" ? (
            <Loader2 aria-hidden className="mr-1 size-4 animate-spin text-muted-foreground" />
          ) : text ? (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}`}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onTextChange("")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </span>
      </div>

      <div id={hintId} className="mt-1 min-h-5 text-xs text-muted-foreground">
        {place ? (
          <span className="flex items-center gap-1.5">
            <Check aria-hidden className="size-3.5 text-primary" />
            <span className="font-medium text-foreground">{kindLabel(place.kind)}</span>
            {place.secondary && <span className="truncate">· {place.secondary}</span>}
            {place.adjusted && <span className="shrink-0 text-accent-foreground">· pin moved</span>}
          </span>
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : query.length === 1 ? (
          "Keep typing…"
        ) : null}
      </div>

      <div id={statusId} aria-live="polite" className="sr-only">
        {statusText}
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList}
        className="absolute z-30 mt-1 max-h-[min(22rem,50svh)] w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-[0_8px_24px_-8px_rgb(30_35_30/0.25)]"
      >
        {status === "ready" &&
          suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                "flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm",
                i === active ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                {s.secondary && <span className="block truncate text-xs text-muted-foreground">{s.secondary}</span>}
              </span>
              <span className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {kindLabel(s.kind)}
              </span>
            </li>
          ))}
        {status === "empty" && (
          <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-2.5 text-sm text-muted-foreground">
            No places match “{query}”. Try the area name with East or West, or a nearby landmark.
          </li>
        )}
        {status === "error" && (
          <li role="option" aria-disabled="true" aria-selected={false} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="text-destructive">{errorMessage}</span>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-muted"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setRetryToken((n) => n + 1)}
            >
              <RotateCw aria-hidden className="size-3.5" />
              Retry
            </button>
          </li>
        )}
        {status === "ready" && partial && (
          <li role="presentation" className="border-t border-border px-3 pt-2 pb-1 text-xs text-muted-foreground">
            One search service didn't respond, so some places may be missing.
          </li>
        )}
      </ul>
    </div>
  );
}
