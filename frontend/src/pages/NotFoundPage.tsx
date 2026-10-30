import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shell/Logo";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-wide text-primary">This road doesn't go anywhere</h1>
        <p className="mt-2 text-foreground/75">The page you opened doesn't exist.</p>
      </div>
      <Button asChild size="lg">
        <Link to="/">Back to WayDine</Link>
      </Button>
    </main>
  );
}
