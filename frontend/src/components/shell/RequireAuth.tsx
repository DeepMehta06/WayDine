import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/app/auth";
import { AppHeader } from "./AppHeader";

export function FullPageStatus({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Signed-in area: sends visitors to sign in and first-time users through onboarding. */
export function RequireAuth({ allowWithoutPreferences = false }: { allowWithoutPreferences?: boolean }) {
  const { status, preferencesSaved } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <FullPageStatus>
        <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
        Checking your sign-in…
      </FullPageStatus>
    );
  }
  if (status !== "signed-in") {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!allowWithoutPreferences && !preferencesSaved) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <Outlet />
    </div>
  );
}
