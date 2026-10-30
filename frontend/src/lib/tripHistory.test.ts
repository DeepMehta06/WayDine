import { afterEach, expect, it, vi } from "vitest";
import { deleteTripHistory, getTripHistory } from "./api";

afterEach(() => vi.unstubAllGlobals());
it("uses cookie-authenticated history endpoints and accepts an empty 204 delete response", async () => {
  const fake = vi.fn().mockResolvedValueOnce(Response.json({ trips: [], nextCursor: null })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fake);
  await expect(getTripHistory(3)).resolves.toEqual({ trips: [], nextCursor: null });
  await expect(deleteTripHistory()).resolves.toBeUndefined();
  expect(fake).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/api\/me\/trips\?limit=3$/), expect.objectContaining({ credentials: "include" }));
  expect(fake).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/api\/me\/trips$/), expect.objectContaining({ method: "DELETE", credentials: "include" }));
});
it("rejects malformed history rather than rendering unexpected provider data", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ trips: [{ id: "bad" }], nextCursor: null })));
  await expect(getTripHistory()).rejects.toMatchObject({ code: "MALFORMED" });
});
