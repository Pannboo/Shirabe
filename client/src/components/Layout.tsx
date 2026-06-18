import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import StatusDots from "./StatusDots";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthed, isAdmin, claims, signOut } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link to="/" className="flex items-baseline gap-1.5 select-none">
            <span className="text-lg font-semibold tracking-tight">Shirabe</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">調べ</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavItem to="/artists">Artists</NavItem>
            <NavItem to="/albums">Albums</NavItem>
            <NavItem to="/rewind">Rewind</NavItem>
            {isAuthed && <NavItem to="/me">Me</NavItem>}
            {isAdmin && (
              <>
                <span className="mx-2 h-4 w-px bg-border" />
                <NavItem to="/library">Library</NavItem>
                <NavItem to="/discover">Discover</NavItem>
                <NavItem to="/queue">Queue</NavItem>
                <NavItem to="/review">Review</NavItem>
                <NavItem to="/settings">Settings</NavItem>
                <StatusDots />
              </>
            )}
            {isAuthed ? (
              <button
                type="button"
                onClick={signOut}
                className="ml-2 text-muted-foreground hover:text-foreground"
                title={claims?.navidrome_username}
              >
                Sign out
              </button>
            ) : (
              <NavLink to="/login" className="ml-2 text-muted-foreground hover:text-foreground">
                Login
              </NavLink>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-5 py-8">{children}</main>

      <footer className="border-t border-border py-4 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Shirabe · 調べ
      </footer>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "px-2.5 py-1.5 rounded-full transition-colors",
          isActive
            ? "text-foreground bg-muted/70"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
        )
      }
    >
      {children}
    </NavLink>
  );
}
