import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Clock, Leaf, Star } from "lucide-react";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

export interface ExampleStop {
  name: string;
  kind: string;
  arrive: string;
  extraMin: number;
  open: string;
  veg?: string;
  rating?: string;
  chosen?: boolean;
}

export interface ExampleTrip {
  id: string;
  from: string;
  to: string;
  leave: string;
  arrive: string;
  distance: string;
  stops: ExampleStop[];
}

export function ItineraryTicket({ trip }: { trip: ExampleTrip }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      if (reduced) return;
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo("[data-time]", { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.04 })
        .fromTo("[data-stop]", { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.09, clearProps: "transform" }, "<0.05")
        .fromTo("[data-chosen-mark]", { scale: 0.4 }, { scale: 1, duration: 0.5, ease: "back.out(2.5)" }, "-=0.25");
    },
    { scope: root, dependencies: [trip.id, reduced] }
  );

  return (
    <div ref={root} className="relative">
      <div
        className="ticket relative rounded-2xl border border-border bg-card shadow-[0_24px_48px_-28px_rgb(30_35_30/0.45),0_2px_6px_-2px_rgb(30_35_30/0.12)]"
        style={{ ["--stub" as string]: "118px" }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Example trip · illustrative data</p>
            <p className="mt-1 truncate font-display text-2xl leading-tight font-semibold tracking-wide">
              {trip.from} <span className="text-muted-foreground">→</span> {trip.to}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">{trip.distance}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">Leave</p>
            <p data-time className="font-display text-3xl leading-none font-semibold tabular-nums">
              {trip.leave}
            </p>
          </div>
        </div>
        <div className="perforation mx-5 h-px" aria-hidden />

        <ol className="relative px-6 pt-4 pb-5" aria-label="Stops on this example trip">
          <span aria-hidden className="route-spine absolute top-6 bottom-8 left-[33px] w-[2px]" />
          {trip.stops.map((s) => (
            <li key={s.name} data-stop className="relative flex gap-4 py-2.5">
              <span
                aria-hidden
                data-chosen-mark={s.chosen ? "" : undefined}
                className={cn(
                  "relative z-10 mt-1.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2",
                  s.chosen ? "border-accent bg-accent" : "border-primary bg-card"
                )}
              />
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-start justify-between gap-3 rounded-lg px-3 py-2 transition-colors",
                  s.chosen && "bg-secondary"
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.kind} · arrive <span className="tabular-nums">{s.arrive}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="flex items-center gap-1 text-primary">
                      <Clock aria-hidden className="size-3" />
                      {s.open}
                    </span>
                    {s.veg && (
                      <span className="flex items-center gap-1 text-primary">
                        <Leaf aria-hidden className="size-3" />
                        {s.veg}
                      </span>
                    )}
                    {s.rating && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Star aria-hidden className="size-3 fill-accent text-accent" />
                        {s.rating}
                      </span>
                    )}
                  </div>
                </div>
                <p
                  className={cn(
                    "shrink-0 font-display text-xl leading-none font-semibold tabular-nums",
                    s.chosen ? "text-accent-foreground" : "text-primary"
                  )}
                >
                  {s.extraMin === 0 ? "+0" : `+${s.extraMin}`}
                  <span className="ml-0.5 font-sans text-xs font-normal text-muted-foreground">min</span>
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="perforation mx-5 h-px" aria-hidden />
        <div className="flex items-center justify-between px-6 py-4">
          <p className="text-sm text-muted-foreground">Arrive with the chosen stop</p>
          <p data-time className="font-display text-3xl leading-none font-semibold tabular-nums">
            {trip.arrive}
          </p>
        </div>
      </div>
    </div>
  );
}
