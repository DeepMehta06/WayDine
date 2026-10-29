import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSessionToken,
  retrievePlace,
  suggestPlaces,
  type PlaceSuggestion,
  type ResolvedPlace,
} from "@/lib/mapbox";

interface PlaceAutocompleteProps {
  id: string;
  label: string;
  placeholder: string;
  onSelect: (place: ResolvedPlace) => void;
}

export function PlaceAutocomplete({ id, label, placeholder, onSelect }: PlaceAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef(createSessionToken());
  // Setting query programmatically after a selection re-renders with new text,
  // which would otherwise re-trigger the search effect below and reopen the
  // dropdown for the address the user just picked. This flag tells that one
  // render to skip searching.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await suggestPlaces(query, sessionTokenRef.current);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function handleSelect(suggestion: PlaceSuggestion) {
    setOpen(false);
    setSuggestions([]);
    setResolving(true);
    const resolved = await retrievePlace(suggestion, sessionTokenRef.current);
    setResolving(false);
    if (!resolved) return;

    skipNextSearchRef.current = true;
    setQuery(resolved.fullAddress);
    sessionTokenRef.current = createSessionToken();
    onSelect(resolved);
  }

  return (
    <div className="relative">
      <Label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </Label>
      <Input
        id={id}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        disabled={resolving}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {suggestions.map((s) => (
            <li key={s.mapboxId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onMouseDown={() => handleSelect(s)}
              >
                <span className="font-medium">{s.name}</span>
                <span className="block text-xs text-muted-foreground">{s.fullAddress}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
