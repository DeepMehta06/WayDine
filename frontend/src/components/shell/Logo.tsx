import { Link } from "react-router";
import { cn } from "@/lib/utils";

export function Logo({ to = "/", className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cn("flex items-center gap-2 rounded-md outline-offset-4", className)} aria-label="WayDine home">
      <img src="/favicon.svg" alt="" className="size-8" width={32} height={32} />
      <span className="font-display text-xl leading-none font-semibold tracking-wide text-primary">WayDine</span>
    </Link>
  );
}
