import { expect, it, vi } from "vitest";
import { fetchRoadGraph } from "../src/graph/overpass.js";
import { makeGraphPreview } from "../src/graph/preview.js";

const origin: [number, number] = [72.84, 19.21];
const destination: [number, number] = [72.86, 19.23];
const middle: [number, number] = [72.85, 19.22];
const extract = { elements: [
  { type: "node", id: 1, lon: origin[0], lat: origin[1] }, { type: "node", id: 2, lon: middle[0], lat: middle[1] }, { type: "node", id: 3, lon: destination[0], lat: destination[1] },
  { type: "way", id: 11, nodes: [1, 2, 3], tags: { highway: "residential" } },
] };

it("fetches a bounded road graph for trip endpoints and calculates the selected stop locally", async () => {
  const fake = vi.fn(async () => Response.json(extract));
  const graph = await fetchRoadGraph(origin, destination, fake as typeof fetch);
  const init = fake.mock.calls[0]![1] as RequestInit;
  expect(new Headers(init.headers).get("User-Agent")).toContain("WayDine/");
  const query = new URLSearchParams(String(init.body)).get("data")!;
  expect(query).toContain("around:3000,19.21000,72.84000,19.23000,72.86000");
  expect(query).toContain("type=restriction");
  const preview = makeGraphPreview(graph, origin, destination, middle);
  expect(preview.geometry).toEqual([origin, middle, destination]);
  expect(preview.warnings.join(" ")).toContain("limited corridor");
  expect(fake).toHaveBeenCalledTimes(1);
});

it("returns a clear failure when Overpass is unavailable or returns a partial result", async () => {
  await expect(fetchRoadGraph(origin, destination, (async () => new Response("unavailable", { status: 503 })) as typeof fetch)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  await expect(fetchRoadGraph(origin, destination, (async () => Response.json({ ...extract, remark: "runtime error" })) as typeof fetch)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
});

it("rejects oversized trips before contacting Overpass", async () => {
  const fake = vi.fn();
  await expect(fetchRoadGraph(origin, [80, 20], fake as typeof fetch)).rejects.toMatchObject({ code: "OUT_OF_COVERAGE" });
  expect(fake).not.toHaveBeenCalled();
});
