import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { ArrowRight, CircleHelp, Clock, Leaf, Navigation, Route, Star, TriangleAlert } from "lucide-react";
import { takeReturnPath, useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { ItineraryTicket, type ExampleTrip } from "@/components/landing/ItineraryTicket";
import { RoadNetBackground } from "@/components/landing/RoadNetBackground";
import { Logo } from "@/components/shell/Logo";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const TRIPS: Record<"city" | "highway", ExampleTrip> = {
  city: {
    id: "city",
    from: "Kandivali West",
    to: "Borivali East",
    leave: "12:00",
    arrive: "12:24",
    distance: "5.5 km · 20 min without a stop",
    stops: [
      { name: "Annapoorna Tiffin Room", kind: "South Indian café", arrive: "12:05", extraMin: 0, open: "Open when you arrive", veg: "Pure veg", rating: "4.4" },
      { name: "Link Road Kathi Co.", kind: "Street food", arrive: "12:09", extraMin: 2, open: "Open when you arrive", rating: "4.1" },
      { name: "Station Side Thali", kind: "Gujarati thali", arrive: "12:14", extraMin: 4, open: "Open when you arrive", veg: "Pure veg", rating: "4.5", chosen: true },
    ],
  },
  highway: {
    id: "highway",
    from: "Mumbai",
    to: "Pune",
    leave: "08:30",
    arrive: "11:52",
    distance: "149 km · 3 h 10 min without a stop",
    stops: [
      { name: "Expressway Food Court", kind: "Food court", arrive: "09:41", extraMin: 1, open: "Open when you arrive", veg: "Veg options", rating: "3.9" },
      { name: "Ghat Section Misal House", kind: "Maharashtrian", arrive: "10:12", extraMin: 3, open: "Open when you arrive", veg: "Veg options", rating: "4.3", chosen: true },
      { name: "Lonavala Chikki Café", kind: "Café", arrive: "10:30", extraMin: 6, open: "Closes 25 min after you arrive", rating: "4.0" },
    ],
  },
};

const STEPS = [
  { icon: Route, title: "Your real route", body: "Google Routes draws the drive you'll actually take: the roads, the direction you're travelling and when you'll pass each point." },
  { icon: Star, title: "Restaurants along it", body: "Google Places restaurants within a few hundred metres of that route, start to finish, not just near where you are now." },
  { icon: Clock, title: "Open when you get there", body: "Opening hours are checked for your arrival time at each stop, in India time, then filtered by your food preferences." },
  { icon: Navigation, title: "Priced in minutes", body: "Each stop is routed to its entrance and back onto your route. The list is sorted by the extra driving it adds." },
];

export default function LandingPage() {
  const { status, signIn, preferencesSaved } = useAuth();
  const navigate = useNavigate();
  const [tripType, setTripType] = useState<"city" | "highway">("city");
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const signedIn = status === "signed-in";

  // Returning from Google sign-in: continue to where the user was heading.
  useEffect(() => {
    if (status !== "signed-in") return;
    const back = takeReturnPath();
    if (back) navigate(preferencesSaved ? back : "/onboarding", { replace: true });
  }, [status, preferencesSaved, navigate]);

  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [reduced]);

  useGSAP(
    () => {
      if (reduced) return;
      gsap.from("[data-hero-copy] > *", { opacity: 0, y: 18, duration: 0.7, stagger: 0.08, ease: "expo.out" });
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.from(el, { opacity: 0, y: 28, duration: 0.8, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 85%", once: true } });
      });
    },
    { scope: root, dependencies: [reduced] }
  );

  const primaryCta = signedIn ? (
    <Button asChild size="lg" className="h-12 px-5 text-base">
      <Link to={preferencesSaved ? "/plan" : "/onboarding"}>
        Plan a trip
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  ) : (
    <Button size="lg" className="h-12 px-5 text-base" onClick={() => signIn("/plan")} disabled={status === "unavailable"}>
      <GoogleMark />
      Plan a trip with Google sign-in
    </Button>
  );

  return (
    <div ref={root} className="min-h-dvh bg-background">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav aria-label="Landing" className="flex items-center gap-1 text-sm">
            <a href="#how" className="hidden rounded-md px-3 py-2 text-muted-foreground hover:text-foreground sm:block">
              How it works
            </a>
            {signedIn ? (
              <Button asChild variant="outline" size="lg">
                <Link to="/plan">Open planner</Link>
              </Button>
            ) : (
              <Button variant="outline" size="lg" onClick={() => signIn("/plan")} disabled={status === "unavailable" || status === "loading"}>
                Sign in
              </Button>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden" aria-labelledby="hero-title">
        <RoadNetBackground className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--background)_30%,transparent_75%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pt-28 pb-20 sm:px-6 lg:min-h-[92svh] lg:grid-cols-12 lg:pt-24">
          <div data-hero-copy className="lg:col-span-5">
            <h1 id="hero-title" className="font-display text-[clamp(2.6rem,5.5vw,4.6rem)] leading-[0.98] font-semibold tracking-[0.005em] text-balance text-primary">
              Eat on the way, not out of the way.
            </h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-pretty text-foreground/80">
              WayDine finds restaurants on the road you're already driving and tells you exactly how many minutes each stop adds, whether it's
              open when you arrive, and whether it fits how you eat.
            </p>
            <div className="mt-8 flex flex-col items-start gap-4">
              {primaryCta}
              {status === "unavailable" && <p className="text-sm text-muted-foreground">Sign-in isn't configured on this server yet.</p>}
            </div>
            <div className="mt-10">
              <p id="trip-type-label" className="mb-2 text-sm text-muted-foreground">
                See it on a
              </p>
              <div role="radiogroup" aria-labelledby="trip-type-label" className="inline-flex rounded-full border border-border bg-card p-1">
                {(["city", "highway"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={tripType === t}
                    onClick={() => setTripType(t)}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                      tripType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t === "city" ? "City hop" : "Highway trip"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="lg:col-span-7 lg:pl-8">
            <ItineraryTicket trip={TRIPS[tripType]} />
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="border-t border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-12">
            <div data-reveal className="lg:col-span-4">
              <h2 id="how-title" className="font-display text-4xl leading-tight font-semibold tracking-wide text-balance">
                From two places to a stop worth taking
              </h2>
              <p className="mt-4 max-w-[40ch] text-foreground/75">
                Every search runs the same four checks, so a place near the road but on the wrong side or closed at 2 pm never makes the list.
              </p>
            </div>
            <ol className="relative lg:col-span-8" aria-label="How a search works">
              <span aria-hidden className="route-spine absolute top-3 bottom-3 left-[19px] w-[2px]" />
              {STEPS.map(({ icon: Icon, title, body }) => (
                <li key={title} data-reveal className="relative flex gap-6 pb-10 last:pb-0">
                  <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-primary">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="pt-1.5">
                    <h3 className="font-sans text-lg font-semibold tracking-normal">{title}</h3>
                    <p className="mt-1.5 max-w-[60ch] text-foreground/75">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section aria-labelledby="stop-title" className="border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-12 lg:items-center">
          <div data-reveal className="lg:col-span-5">
            <h2 id="stop-title" className="font-display text-4xl leading-tight font-semibold tracking-wide text-balance">
              Every stop shows its working
            </h2>
            <p className="mt-4 max-w-[44ch] text-foreground/75">
              Open a restaurant to see Google photos, rating and recent reviews, prices, what meals it serves, parking and payment, and a one-tap
              hand-off to navigation that goes via the stop.
            </p>
          </div>
          <ul data-reveal className="grid gap-3 sm:grid-cols-2 lg:col-span-7">
            {[
              { icon: Navigation, title: "+4 min", body: "Extra driving, routed to the entrance and back." },
              { icon: Clock, title: "Open at 12:14", body: "Checked against your arrival time, not now." },
              { icon: Leaf, title: "Pure veg", body: "Only from listing data, never guessed from a name." },
              { icon: TriangleAlert, title: "U-turn likely", body: "Flagged when the route doubles back near the stop." },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-xl border border-border bg-card p-5">
                <Icon aria-hidden className="size-5 text-accent" />
                <p className="mt-3 font-display text-2xl font-semibold tracking-wide tabular-nums">{title}</p>
                <p className="mt-1 text-sm text-foreground/75">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="honest-title" className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:items-end">
          <div data-reveal className="lg:col-span-7">
            <h2 id="honest-title" className="font-display text-4xl leading-tight font-semibold tracking-wide text-balance">
              When we don't know, we say so.
            </h2>
            <p className="mt-4 max-w-[56ch] text-primary-foreground/80">
              Hours not listed, veg status unconfirmed, price unknown: those show up as unknown, with the reason, instead of a confident guess.
              Your saved preferences decide what's hidden; every exclusion can be inspected.
            </p>
          </div>
          <div data-reveal className="flex flex-col items-start gap-3 lg:col-span-5 lg:items-end">
            {signedIn ? (
              <Button asChild size="lg" variant="secondary" className="h-12 px-5 text-base">
                <Link to="/plan">
                  Plan a trip
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button size="lg" variant="secondary" className="h-12 px-5 text-base" onClick={() => signIn("/plan")} disabled={status === "unavailable"}>
                <GoogleMark />
                Continue with Google
              </Button>
            )}
            <p className="flex items-center gap-1.5 text-sm text-primary-foreground/70">
              <CircleHelp aria-hidden className="size-4" />
              Sign-in keeps your food preferences. India only for now.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p>Restaurant data from Google Maps. Map data © Google. Place search powered by Geoapify, © OpenStreetMap contributors.</p>
        </div>
      </footer>
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-5 shrink-0 rounded-full bg-white p-[3px]">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
