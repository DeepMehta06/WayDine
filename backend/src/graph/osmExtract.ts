import { z } from "zod";
import { buildRoadGraph, type RoadGraph } from "./roadGraph.js";

const id = z.number().int().positive().safe();
const tags = z.record(z.string()).optional();
const element = z.discriminatedUnion("type", [
  z.object({ type: z.literal("node"), id, lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) }),
  z.object({ type: z.literal("way"), id, nodes: z.array(id).max(100_000), tags }),
  z.object({ type: z.literal("relation"), id, members: z.array(z.object({ type: z.string(), ref: id, role: z.string() })).max(10_000), tags }),
]);
const extract = z.object({ elements: z.array(element).max(2_000_000) });

/** Parses OSM/Overpass JSON already supplied by the caller. No network access. */
export function graphFromOsmJson(input: unknown): RoadGraph {
  const parsed = extract.safeParse(input);
  if (!parsed.success) throw new Error("Invalid or oversized OSM road extract.");
  return buildRoadGraph(parsed.data.elements);
}
