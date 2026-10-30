import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { LogOut, Route, SlidersHorizontal, UserRound } from "lucide-react";
import { useAuth } from "@/app/auth";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
    isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
  );

export function AppHeader() {
  const { user, signOutUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setError(null);
    try {
      await signOutUser();
      navigate("/");
    } catch {
      setError("Couldn't sign out. Try again.");
    }
  }

  const initials = (user?.displayName || user?.email || "?").trim().slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
        <Logo to="/plan" />
        <nav aria-label="Main" className="flex items-center gap-1">
          <NavLink to="/plan" className={navClass}>
            <Route aria-hidden className="size-4" />
            <span className="hidden sm:inline">Plan a trip</span>
          </NavLink>
          <NavLink to="/profile" className={navClass}>
            <SlidersHorizontal aria-hidden className="size-4" />
            <span className="hidden sm:inline">Preferences</span>
          </NavLink>
          <div ref={menuRef} className="relative ml-1">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="Account menu"
              onClick={() => setOpen((o) => !o)}
              className="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-primary"
            >
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initials}
            </button>
            {open && (
              <div role="menu" className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-[0_12px_32px_-12px_rgb(30_35_30/0.35)]">
                <div className="flex items-center gap-2.5 px-2.5 py-2">
                  <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user?.displayName || "Signed in"}</p>
                    <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void logout()}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
                >
                  <LogOut aria-hidden className="size-4" />
                  Sign out
                </button>
                {error && <p className="px-2.5 pb-1 text-xs text-destructive">{error}</p>}
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
