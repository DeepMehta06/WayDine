/** Display formatting. All times are shown in restaurant-local India time, labelled IST. */
import type { PlaceKind } from "@contract";

const TZ = "Asia/Kolkata";

const clock = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayClock = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatClock(iso: string): string {
  return clock.format(new Date(iso));
}

/** "12:05" for today in India, otherwise "Fri, 30 Oct, 12:05". */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return dayKey.format(d) === dayKey.format(now) ? clock.format(d) : dayClock.format(d);
}

export function formatDuration(sec: number): string {
  const totalMin = Math.round(Math.max(0, sec) / 60);
  if (totalMin < 1) return "under 1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatExtra(sec: number): string {
  return sec < 30 ? "No extra time" : `+${formatDuration(sec)}`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

const KIND_LABEL: Record<PlaceKind, string> = {
  neighbourhood: "Neighbourhood",
  locality: "Area",
  suburb: "Area",
  district: "District",
  city: "City",
  region: "Region",
  postcode: "PIN code",
  street: "Street",
  address: "Address",
  poi: "Place",
};

export function kindLabel(kind: PlaceKind): string {
  return KIND_LABEL[kind];
}

/** Value for <input type="datetime-local"> in India time. */
export function toIstLocalInput(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Interprets a datetime-local value as India time and returns an ISO string with +05:30. */
export function istLocalInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return `${value}:00+05:30`;
}
