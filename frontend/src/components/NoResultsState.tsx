import type { ExcludedRestaurant } from "@/types";

interface NoResultsStateProps {
  excluded: ExcludedRestaurant[];
}

export function NoResultsState({ excluded }: NoResultsStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h3 className="text-lg">No stops match your route</h3>
      <p className="max-w-xs text-sm text-muted-foreground">
        Nothing on this corridor cleared the 200m, direction, timing, and detour checks.
      </p>

      {excluded.length > 0 && (
        <ul className="mt-2 w-full max-w-xs space-y-1.5 text-left text-xs text-muted-foreground">
          {excluded.map((ex) => (
            <li key={ex.id} className="rounded border border-border bg-muted/50 px-2.5 py-1.5">
              <span className="font-medium text-foreground">{ex.name}</span> — {ex.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
