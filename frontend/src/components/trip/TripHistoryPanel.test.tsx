import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripHistoryEntry } from "@contract";
import { EMPTY_DRAFT } from "@/app/trip";
import { ApiError, deleteTripHistory, getTripHistory } from "@/lib/api";
import { TripHistoryPanel } from "./TripHistoryPanel";

const { setDraft } = vi.hoisted(() => ({ setDraft: vi.fn() }));
vi.mock("@/app/trip", () => ({ EMPTY_DRAFT: { source: null, destination: null, departure: { mode: "now" }, overrides: {} }, useTrip: () => ({ setDraft }) }));
vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), getTripHistory: vi.fn(), deleteTripHistory: vi.fn() }));

const trip: TripHistoryEntry = {
  id: "996b73e2-b094-4ab1-a283-ab4b894517f0", sourceLabel: "Kandivali West", destinationLabel: "Borivali East",
  createdAt: "2026-10-30T06:00:00Z", departureTime: "2026-10-30T06:30:00Z", resultCount: 3,
  preferences: { diet: "pure-veg", cuisines: ["south indian"], includeUnconfirmedDiet: false, maxDetourMinutes: 5, budgetPerPersonInr: 400 },
};
function show(preview = false) {
  return render(<MemoryRouter initialEntries={["/history"]}><Routes><Route path="/history" element={<TripHistoryPanel preview={preview} />} /><Route path="/plan" element={<p>Review your trip</p>} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.mocked(getTripHistory).mockReset().mockResolvedValue({ trips: [trip], nextCursor: null });
  vi.mocked(deleteTripHistory).mockReset().mockResolvedValue(undefined);
  setDraft.mockReset();
});

describe("account trip history", () => {
  it("shows the saved route, India-local departure, counts and preferences without fetching restaurant data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    show();
    expect(await screen.findByText("Kandivali West")).toBeInTheDocument();
    expect(screen.getByText("Borivali East")).toBeInTheDocument();
    expect(screen.getByText(/30 Oct 2026, 12:00/)).toBeInTheDocument();
    expect(screen.getByText(/Pure veg only.*south indian/)).toBeInTheDocument();
    expect(getTripHistory).toHaveBeenCalledWith(20, undefined, expect.any(AbortSignal));
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });
  it("offers an honest empty state and retry for failures", async () => {
    vi.mocked(getTripHistory).mockRejectedValueOnce(new ApiError("UPSTREAM_UNAVAILABLE", "History is offline"))
      .mockResolvedValueOnce({ trips: [], nextCursor: null });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("History is offline");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No trips yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan your first trip" })).toHaveAttribute("href", "/plan");
  });
  it("requires confirmation, removes a trip and handles 204 success", async () => {
    show(); await screen.findByText("Kandivali West");
    fireEvent.click(screen.getByRole("button", { name: /Remove trip from Kandivali/ }));
    expect(deleteTripHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Remove trip$/ }));
    await waitFor(() => expect(deleteTripHistory).toHaveBeenCalledWith(trip.id));
    expect(await screen.findByText("No trips yet")).toBeInTheDocument();
  });
  it("retains rows and shows an error when deletion fails", async () => {
    vi.mocked(deleteTripHistory).mockRejectedValueOnce(new ApiError("NETWORK", "Couldn't remove this trip"));
    show(); await screen.findByText("Kandivali West");
    fireEvent.click(screen.getByRole("button", { name: /Remove trip from Kandivali/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Remove trip$/ }));
    expect(await screen.findByText("Couldn't remove this trip")).toBeInTheDocument();
    expect(screen.getByText("Kandivali West")).toBeInTheDocument();
  });
  it("loads another page and clears the whole history only after confirmation", async () => {
    vi.mocked(getTripHistory).mockResolvedValueOnce({ trips: [trip], nextCursor: "cursor" })
      .mockResolvedValueOnce({ trips: [{ ...trip, id: "996b73e2-b094-4ab1-a283-ab4b894517f1", sourceLabel: "Andheri" }], nextCursor: null });
    show(); await screen.findByText("Kandivali West");
    fireEvent.click(screen.getByRole("button", { name: "Load older trips" }));
    expect(await screen.findByText("Andheri")).toBeInTheDocument();
    expect(getTripHistory).toHaveBeenLastCalledWith(20, "cursor", expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(deleteTripHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove all trips" }));
    expect(await screen.findByText("Trip history cleared.")).toBeInTheDocument();
    expect(deleteTripHistory).toHaveBeenCalledWith(undefined);
  });
  it("prefills a fresh draft and requires endpoint review before any new search", async () => {
    show(); await screen.findByText("Kandivali West");
    fireEvent.click(screen.getByRole("button", { name: "Plan a similar trip" }));
    expect(await screen.findByText("Review your trip")).toBeInTheDocument();
    expect(setDraft.mock.calls[0]![0](EMPTY_DRAFT)).toEqual({ ...EMPTY_DRAFT, sourceText: "Kandivali West", destinationText: "Borivali East", overrides: trip.preferences });
    expect(getTripHistory).toHaveBeenCalledTimes(1);
  });
  it("requests a small profile preview and cancels reads on unmount", async () => {
    let resolve!: (value: { trips: TripHistoryEntry[]; nextCursor: null }) => void;
    vi.mocked(getTripHistory).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = show(true);
    const signal = vi.mocked(getTripHistory).mock.calls[0]![2]!;
    expect(getTripHistory).toHaveBeenCalledWith(3, undefined, expect.any(AbortSignal));
    expect(screen.getByRole("link", { name: "View all trips" })).toHaveAttribute("href", "/history");
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ trips: [trip], nextCursor: null }));
    expect(screen.queryByText("Kandivali West")).not.toBeInTheDocument();
  });
});
