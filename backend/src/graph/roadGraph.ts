/** Build a directed driving graph from an OSM JSON extract (nodes, ways and restrictions). */
import { haversineM } from "../lib/geo.js";
import type { LngLat } from "../contract/api.js";

export interface OsmNode { type: "node"; id: number; lat: number; lon: number }
export interface OsmWay { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> }
export interface OsmRelation { type: "relation"; id: number; members: Array<{ type: string; ref: number; role: string }>; tags?: Record<string, string> }
export type OsmElement = OsmNode | OsmWay | OsmRelation;
export interface RoadEdge { from: number; to: number; way: number; distanceM: number; seconds: number; trafficKey?: string; /** OSM highway class, so stops are never snapped onto a motorway carriageway. */ highway?: string }
export interface TurnRule { fromWay: number; toWay: number; via: number; kind: "no" | "only"; uturn: boolean; straight: boolean }
export interface RoadGraph { nodes: Map<number, LngLat>; outgoing: Map<number, RoadEdge[]>; restrictions: Map<number, TurnRule[]>; warnings: string[] }

// Deliberately conservative defaults. Speeds are estimates, not traffic forecasts.
const SPEED_KMH: Record<string, number> = { motorway: 80, motorway_link: 40, trunk: 60, trunk_link: 35, primary: 50, primary_link: 30, secondary: 40, secondary_link: 25, tertiary: 35, tertiary_link: 25, unclassified: 30, residential: 25, living_street: 10, service: 15 };
const DENIED = new Set(["no", "private", "agricultural", "forestry"]);

function speed(tags: Record<string, string>): number {
  const raw = tags.maxspeed?.trim().toLowerCase();
  const match = raw?.match(/^(\d+(?:\.\d+)?)\s*(km\/h|kmh|kph|mph)?$/);
  const parsed = match ? Number(match[1]) * (match[2] === "mph" ? 1.609344 : 1) : NaN;
  // Unknown speed tags use a documented road-type estimate, not an invented limit.
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 160 ? Math.min(parsed, SPEED_KMH[tags.highway!]!) : SPEED_KMH[tags.highway!]!;
}

export function buildRoadGraph(elements: OsmElement[]): RoadGraph {
  const nodes = new Map<number, LngLat>();
  const outgoing = new Map<number, RoadEdge[]>();
  const restrictions = new Map<number, TurnRule[]>();
  const warnings: string[] = [];
  for (const e of elements) if (e.type === "node" && Number.isFinite(e.lat) && Number.isFinite(e.lon) && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180) nodes.set(e.id, [e.lon, e.lat]);
  const ways = new Set<number>();
  let incomplete = false, conditional = false;
  const add = (edge: RoadEdge) => { const list = outgoing.get(edge.from) ?? []; list.push(edge); outgoing.set(edge.from, list); };
  for (const e of elements) {
    if (e.type !== "way") continue;
    const tags = e.tags ?? {}; const highway = tags.highway;
    if (!highway || !Object.hasOwn(SPEED_KMH, highway)) continue;
    const access = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
    if (access && DENIED.has(access)) continue;
    if (access && !["yes", "permissive", "designated"].includes(access)) conditional = true;
    if (Object.keys(tags).some((k) => k.endsWith(":conditional"))) conditional = true;
    const one = (tags["oneway:motorcar"] ?? tags["oneway:motor_vehicle"] ?? tags["oneway:vehicle"] ?? tags.oneway ?? (tags.junction === "roundabout" || highway === "motorway" || highway === "motorway_link" ? "yes" : "no")).toLowerCase();
    if (!["yes", "1", "true", "-1", "reverse", "no", "0", "false"].includes(one)) { conditional = true; continue; }
    const forward = !["-1", "reverse"].includes(one);
    const reverse = ["-1", "reverse", "no", "0", "false"].includes(one);
    ways.add(e.id);
    for (let i = 0; i + 1 < e.nodes.length; i++) {
      const from = e.nodes[i]!, to = e.nodes[i + 1]!; const a = nodes.get(from), b = nodes.get(to);
      if (!a || !b) { incomplete = true; continue; }
      const distanceM = haversineM(a, b); if (distanceM === 0) continue;
      const seconds = distanceM / (speed(tags) / 3.6);
      if (forward) add({ from, to, way: e.id, distanceM, seconds, highway });
      if (reverse) add({ from: to, to: from, way: e.id, distanceM, seconds, highway });
    }
  }
  let unsupported = false;
  for (const e of elements) {
    if (e.type !== "relation" || e.tags?.type !== "restriction") continue;
    const tags = e.tags;
    if ((tags.except ?? "").split(/[;,]/).map((s) => s.trim()).some((x) => ["motorcar", "motor_vehicle", "vehicle"].includes(x))) continue;
    if (Object.keys(tags).some((k) => k.includes(":conditional"))) { unsupported = true; continue; }
    const rule = tags["restriction:motorcar"] ?? tags["restriction:motor_vehicle"] ?? tags.restriction;
    const from = e.members.filter((m) => m.role === "from" && m.type === "way");
    const to = e.members.filter((m) => m.role === "to" && m.type === "way");
    const via = e.members.filter((m) => m.role === "via");
    if (!rule || !/^(no|only)_(left_turn|right_turn|straight_on|u_turn)$/.test(rule) || from.length !== 1 || to.length !== 1 || via.length !== 1 || via[0]!.type !== "node") { unsupported = true; continue; }
    if (!ways.has(from[0]!.ref) || !ways.has(to[0]!.ref) || !nodes.has(via[0]!.ref)) { incomplete = true; continue; }
    if (from[0]!.ref === to[0]!.ref && !rule.endsWith("u_turn") && !rule.endsWith("straight_on")) { unsupported = true; continue; }
    const parsed: TurnRule = { fromWay: from[0]!.ref, toWay: to[0]!.ref, via: via[0]!.ref, kind: rule.startsWith("no_") ? "no" : "only", uturn: rule.endsWith("u_turn"), straight: rule.endsWith("straight_on") };
    const list = restrictions.get(parsed.via) ?? []; list.push(parsed); restrictions.set(parsed.via, list);
  }
  if (incomplete) warnings.push("Road extract has missing nodes or restriction members; connectivity may be incomplete.");
  if (conditional) warnings.push("Some road access or direction is conditional or unsupported; legal access is not confirmed.");
  if (unsupported) warnings.push("Some turn restrictions are unsupported or conditional; legal turns are not confirmed.");
  return { nodes, outgoing, restrictions, warnings };
}
