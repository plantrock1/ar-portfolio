import Link from "next/link";

export function SiteHeader({ displayName }: { displayName?: string }) {
  const label = displayName?.trim() || "Portfolio";
  return (
    <header className="w-full border-b border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between text-sm">
        <Link
          href="/"
          className="display text-lg tracking-tight text-white/90 hover:text-white transition-colors"
        >
          {label}
        </Link>
        <nav className="flex items-center gap-6 text-white/50">
          <Link href="/" className="hover:text-white transition-colors">
            Roster
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ displayName }: { displayName?: string }) {
  const label = displayName?.trim() || "A&R Portfolio";
  return (
    <footer className="mt-24 border-t border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-10 flex items-center justify-between text-xs text-white/40">
        <div>© {new Date().getFullYear()} {label}</div>
        <div>Data: Spotify · Updated daily</div>
      </div>
    </footer>
  );
}
