import { useState } from "react";
import { SearchForm, type SearchSubmitValue } from "@/components/SearchForm";
import { ResultsPanel } from "@/components/ResultsPanel";
import { MapView } from "@/components/MapView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DetailsDrawer } from "@/components/DetailsDrawer";
import { useRecommend } from "@/hooks/useRecommend";

function App() {
  const { data, loading, error, run } = useRecommend();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSubmit(value: SearchSubmitValue) {
    setSelectedId(null);
    run(value);
  }

  const selected = data?.recommendations.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <aside className="order-2 flex h-[55svh] flex-col border-t border-border bg-card md:order-1 md:h-full md:w-96 md:shrink-0 md:border-t-0 md:border-r">
        <header className="shrink-0 border-b border-border px-4 py-3">
          <h1 className="text-xl text-primary">WayDine</h1>
          <p className="text-xs text-muted-foreground">Eat on the way, not out of the way</p>
        </header>

        <div className="shrink-0 border-b border-border p-4">
          <SearchForm onSubmit={handleSubmit} loading={loading} />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        <div className="min-h-0 flex-1">
          {data && (
            <ResultsPanel
              recommendations={data.recommendations}
              excluded={data.excluded}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
          {!data && !loading && (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Enter a route to see highway stops along the way.
            </div>
          )}
        </div>
      </aside>

      <main className="order-1 min-h-0 flex-1 md:order-2">
        <ErrorBoundary
          fallback={
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              The map couldn't load. Your search results are still available on the left.
            </div>
          }
        >
          <MapView
            route={data?.route ?? null}
            recommendations={data?.recommendations ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </ErrorBoundary>
      </main>

      <DetailsDrawer recommendation={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

export default App;
