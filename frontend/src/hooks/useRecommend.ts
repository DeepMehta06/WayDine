import { useCallback, useState } from "react";
import { fetchRecommendations } from "@/lib/api";
import type { RecommendPreferences, RecommendResponseBody } from "@/types";

interface RecommendParams {
  source: [number, number];
  destination: [number, number];
  departureTime: Date;
  preferences: RecommendPreferences;
}

export function useRecommend() {
  const [data, setData] = useState<RecommendResponseBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (params: RecommendParams) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRecommendations({
        source: params.source,
        destination: params.destination,
        departureTime: params.departureTime.toISOString(),
        preferences: params.preferences,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, run };
}
