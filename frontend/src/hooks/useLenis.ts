import { useEffect, useState } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { useReducedMotion } from "@/lib/motion";

/**
 * Smooth scrolling for a scroll container, driven by GSAP's ticker. Bound to
 * the element actually mounted (callback ref), so it initializes whenever the
 * list appears, and disabled entirely under reduced motion (native scrolling).
 */
export function useLenis(enabled: boolean): (el: HTMLElement | null) => void {
  const [wrapper, setWrapper] = useState<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!enabled || !wrapper || reduced) return;
    const content = wrapper.firstElementChild as HTMLElement | null;
    if (!content) return;
    const lenis = new Lenis({ wrapper, content, duration: 0.9, smoothWheel: true });
    const onTick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
    };
  }, [enabled, wrapper, reduced]);

  return setWrapper;
}
