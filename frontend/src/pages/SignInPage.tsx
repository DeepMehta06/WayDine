import { Link, Navigate, useLocation } from "react-router";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shell/Logo";
import { GoogleMark } from "./LandingPage";

export default function SignInPage() {
  const { status, signIn, preferencesSaved, error } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/plan";

  if (status === "signed-in") return <Navigate to={preferencesSaved ? from : "/onboarding"} replace />;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </Link>
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-wide text-primary">Sign in to plan a trip</h1>
          <p className="mt-3 text-foreground/80">
            Signing in keeps your food preferences (diet, cuisines, how far you'll detour, budget) so every search starts from them.
          </p>

          <div className="mt-8 rounded-2xl border border-border bg-card p-6">
            <Button
              size="lg"
              className="h-12 w-full text-base"
              onClick={() => signIn(from)}
              disabled={status === "loading" || status === "unavailable"}
            >
              {status === "loading" ? <Loader2 aria-hidden className="animate-spin" /> : <GoogleMark />}
              Continue with Google
            </Button>
            {status === "unavailable" && (
              <p role="status" className="mt-3 text-sm text-destructive">
                Google sign-in isn't configured on this server yet. Set it up as described in docs/GOOGLE_AUTH.md.
              </p>
            )}
            {error && status !== "unavailable" && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <ul className="mt-6 flex flex-col gap-2.5 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                We receive your name, email and profile picture from Google. Nothing is posted on your behalf.
              </li>
              <li className="flex gap-2">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                Your trip start and destination are used for the search and are not stored with your account.
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
