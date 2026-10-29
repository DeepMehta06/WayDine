import { getDurationMatrix } from "./mapbox.js";
import type { DirectionClassifiedRestaurant, GraphRankedRestaurant } from "../types/index.js";

interface Edge {
  to: number;
  weightSec: number;
}

/** Textbook Dijkstra over an adjacency list, binary-heap-free (small graphs here: <=25 nodes). */
function dijkstra(adjacency: Edge[][], sourceNode: number): number[] {
  const n = adjacency.length;
  const dist = new Array<number>(n).fill(Infinity);
  const visited = new Array<boolean>(n).fill(false);
  dist[sourceNode] = 0;

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = true;

    for (const edge of adjacency[u]!) {
      const alt = dist[u]! + edge.weightSec;
      if (alt < dist[edge.to]!) {
        dist[edge.to] = alt;
      }
    }
  }
  return dist;
}

const MAX_MATRIX_SIZE = 25;

/**
 * Builds the candidate graph (source, candidates, destination) with real
 * Mapbox-derived driving-time edges, then runs Dijkstra twice (forward from
 * source, backward from destination on the reversed graph) to get the true
 * detour cost ΔT = T(source -> restaurant -> destination) - T(source -> destination)
 * for every candidate, per the build plan's Stage C.
 */
export async function rankByDetour(
  candidates: DirectionClassifiedRestaurant[],
  source: [number, number],
  destination: [number, number],
  baselineDurationSec: number,
  departureTime: Date
): Promise<GraphRankedRestaurant[]> {
  if (candidates.length === 0) return [];

  // Mapbox Matrix API caps at 25 coordinates per call; keep the closest-to-route
  // candidates if there are more (unlikely for a hackathon seed set).
  const trimmed = candidates
    .slice()
    .sort((a, b) => a.distanceFromRoadM - b.distanceFromRoadM)
    .slice(0, MAX_MATRIX_SIZE - 2);

  const coordinates: [number, number][] = [
    source,
    ...trimmed.map((c): [number, number] => [c.longitude, c.latitude]),
    destination,
  ];

  const matrix = await getDurationMatrix(coordinates);

  const sourceIdx = 0;
  const destIdx = coordinates.length - 1;
  const candidateIdx = trimmed.map((_, i) => i + 1);

  // Forward graph: source -> each candidate, each candidate -> destination.
  const forwardAdj: Edge[][] = Array.from({ length: coordinates.length }, () => []);
  for (const ci of candidateIdx) {
    forwardAdj[sourceIdx]!.push({ to: ci, weightSec: matrix[sourceIdx]![ci]! });
    forwardAdj[ci]!.push({ to: destIdx, weightSec: matrix[ci]![destIdx]! });
  }
  forwardAdj[sourceIdx]!.push({ to: destIdx, weightSec: matrix[sourceIdx]![destIdx]! });

  // Reverse graph for the backward Dijkstra (candidate -> destination distances).
  const reverseAdj: Edge[][] = Array.from({ length: coordinates.length }, () => []);
  for (const u of forwardAdj.keys()) {
    for (const edge of forwardAdj[u]!) {
      reverseAdj[edge.to]!.push({ to: u, weightSec: edge.weightSec });
    }
  }

  const distFromSource = dijkstra(forwardAdj, sourceIdx);
  const distToDestination = dijkstra(reverseAdj, destIdx);

  return trimmed.map((candidate, i) => {
    const ci = candidateIdx[i]!;
    const viaCandidateSec = distFromSource[ci]! + distToDestination[ci]!;
    const detourSec = Math.max(0, viaCandidateSec - baselineDurationSec);
    const detourMinutes = Math.round(detourSec / 60);

    const arrival = new Date(departureTime.getTime() + distFromSource[ci]! * 1000);
    const etaArrival = arrival.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return { ...candidate, detourMinutes, etaArrival };
  });
}
