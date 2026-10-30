import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clock, Leaf, Navigation, Pause, Play, TriangleAlert } from "lucide-react";
import CardSwap, { Card, type CardSwapHandle } from "@/components/react-bits/CardSwap";
import { useReducedMotion } from "@/lib/motion";

const evidence = [
  { icon: Navigation, title: "+4 min", body: "Extra driving, routed to the entrance and back." },
  { icon: Clock, title: "Open at 12:14", body: "Checked against your arrival time, not now." },
  { icon: Leaf, title: "Pure veg", body: "Only from listing data, never guessed from a name." },
  { icon: TriangleAlert, title: "U-turn likely", body: "Flagged when the route doubles back near the stop." },
];

export function StopEvidenceCards() {
  const deck = useRef<CardSwapHandle>(null);
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(0);
  return <div className="min-w-0 lg:col-span-7">
    {reduced ? <ul className="grid gap-3 sm:grid-cols-2">{evidence.map(({ icon: Icon, title, body }) => <li key={title} className="rounded-xl border border-border bg-card p-6"><Icon aria-hidden className="size-5 text-accent" /><h3 className="mt-4 text-2xl">{title}</h3><p className="mt-2 text-sm text-foreground/75">{body}</p></li>)}</ul> : <>
      <div className="h-[350px] sm:h-[440px]" onFocusCapture={() => setPaused(true)}>
        <CardSwap ref={deck} width={440} height={260} cardDistance={36} verticalDistance={48} skewAmount={3} theme="light" delay={4000} autoplay={!paused} pauseOnHover dim={0.25} onChange={setActive} className="stop-evidence-deck">
          {evidence.map(({ icon: Icon, title, body }, index) => <Card key={title}>
            <div className="flex h-full flex-col justify-center p-9">
              <div className="mb-6 flex items-center justify-between"><Icon aria-hidden className="size-7 text-accent" /><span className="text-xs tracking-widest text-muted-foreground">0{index + 1} / 04</span></div>
              <h3 className="text-4xl tabular-nums">{title}</h3>
              <p className="mt-3 max-w-[34ch] text-base text-foreground/75">{body}</p>
            </div>
          </Card>)}
        </CardSwap>
      </div>
      <div className="mt-4 flex items-center justify-center gap-4">
        <button type="button" aria-label="Previous evidence card" className="rounded-full border border-border p-2.5 hover:bg-muted" onClick={() => deck.current?.prev()}><ArrowLeft size={16} aria-hidden /></button>
        <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground" aria-live={paused ? "polite" : "off"}>{active + 1} / {evidence.length}</span>
        <button type="button" aria-label="Next evidence card" className="rounded-full border border-border p-2.5 hover:bg-muted" onClick={() => deck.current?.next()}><ArrowRight size={16} aria-hidden /></button>
        <button type="button" aria-label={paused ? "Play card rotation" : "Pause card rotation"} className="rounded-full border border-border p-2.5 hover:bg-muted" onClick={() => setPaused((value) => !value)}>{paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}</button>
      </div>
    </>}
  </div>;
}
