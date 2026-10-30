import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/app/auth";
import { TripProvider } from "@/app/trip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FullPageStatus, RequireAuth } from "@/components/shell/RequireAuth";

const LandingPage = lazy(() => import("@/pages/LandingPage"));
const SignInPage = lazy(() => import("@/pages/SignInPage"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const PlanPage = lazy(() => import("@/pages/PlanPage"));
const TripPage = lazy(() => import("@/pages/TripPage"));
const StopPage = lazy(() => import("@/pages/StopPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

const pageFallback = (
  <FullPageStatus>
    <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
    Loading…
  </FullPageStatus>
);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TripProvider>
          <ErrorBoundary
            fallback={
              <FullPageStatus>
                Something went wrong on this page.{" "}
                <a href="/" className="underline">
                  Go home
                </a>
              </FullPageStatus>
            }
          >
            <Suspense fallback={pageFallback}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/signin" element={<SignInPage />} />
                <Route element={<RequireAuth allowWithoutPreferences />}>
                  <Route path="/onboarding" element={<OnboardingPage />} />
                </Route>
                <Route element={<RequireAuth />}>
                  <Route path="/plan" element={<PlanPage />} />
                  <Route path="/trip" element={<TripPage />} />
                  <Route path="/trip/stop/:id" element={<StopPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </TripProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
