import type { RecommendRequestBody, RecommendResponseBody } from "@/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export async function fetchRecommendations(
  body: RecommendRequestBody
): Promise<RecommendResponseBody> {
  const res = await fetch(`${API_BASE_URL}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(payload.error ?? `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<RecommendResponseBody>;
}
