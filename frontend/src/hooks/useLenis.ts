import { useEffect, useRef, type RefObject } from "react";
import Lenis from "lenis";
import gsap from "gsap";

/** Smooth scroll for a scrollable container (the results list), synced to GSAP's ticker. */
export function useLenis(containerRef: RefObject<HTMLElement | null>) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;

    const content = wrapper.firstElementChild as HTMLElement | null;
    if (!content) return;

    const lenis = new Lenis({ wrapper, content, duration: 1.0, smoothWheel: true });
    lenisRef.current = lenis;

    const onTick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [containerRef]);

  return lenisRef;
}
