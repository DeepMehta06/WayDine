/**
 * Vanta NET as a faint road network behind the landing hero. Loaded lazily,
 * desktop only, and never under reduced motion; failure leaves the plain ground.
 */
import { useEffect, useRef } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useReducedMotion } from "@/lib/motion";

export function RoadNetBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!desktop || reduced || !ref.current) return;
    let effect: { destroy(): void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const [THREE, vanta] = await Promise.all([import("three"), import("vanta/dist/vanta.net.min")]);
        const NET = (vanta as unknown as { default?: typeof vanta.default }).default ?? (vanta as unknown as typeof vanta.default);
        if (cancelled || !ref.current) return;
        effect = NET({
          el: ref.current,
          THREE,
          mouseControls: true,
          touchControls: false,
          gyroControls: false,
          backgroundColor: 0xfaf8f2,
          color: 0xb4c2b0,
          points: 8,
          maxDistance: 21,
          spacing: 19,
          showDots: true,
        });
      } catch {
        // WebGL unavailable or module failed: the hero keeps its plain ground.
      }
    })();
    return () => {
      cancelled = true;
      effect?.destroy();
    };
  }, [desktop, reduced]);

  return <div ref={ref} aria-hidden className={className} />;
}
