import { useEffect } from "react";
import { useAuth } from "@/app/auth";
import { TripHistoryPanel } from "@/components/trip/TripHistoryPanel";

export default function HistoryPage() {
  const { user } = useAuth();
  useEffect(() => { document.title = "Trip history · WayDine"; }, []);
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
    <h1 className="font-display text-4xl font-semibold tracking-wide text-primary">Trip history</h1>
    <TripHistoryPanel key={user?.id} />
  </main>;
}
