"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/theme";
import type { AppSessionUser } from "@/lib/auth";

const nav = [
  { href: "/", label: "Play" },
  { href: "/duel", label: "Which is more?" },
  { href: "/shak", label: "أشك Domino" },
  { href: "/host", label: "Host a game" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/profile", label: "Profile" },
];

export default function Header({ user }: { user: AppSessionUser | null }) {
  const { theme, toggleTheme, muted, toggleMuted } = usePrefs();
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-ink-900/5 bg-ink-50/80 backdrop-blur dark:border-white/10 dark:bg-ink-950/80">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 md:px-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-lg font-black tracking-tight">How Big<span className="text-brand-500">?</span></span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 whitespace-nowrap text-sm font-semibold sm:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`rounded-full px-3 py-1.5 transition ${path === n.href ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-ink-600 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"}`}>{n.label}</Link>
          ))}
          {user?.role === "ADMIN" && <Link href="/admin/monuments" className="rounded-full px-3 py-1.5 text-ink-600 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800">Admin</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={toggleMuted} className="btn-ghost h-9 w-9 !p-0" aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
          <button onClick={toggleTheme} className="btn-ghost h-9 w-9 !p-0" aria-label="Toggle theme" title="Light / dark">{theme === "dark" ? "☀️" : "🌙"}</button>
          {user ? (
            <Link href="/profile" className="btn-ghost h-9 max-w-[140px] truncate !px-3 text-xs">{user.nickname ?? user.name ?? user.email}</Link>
          ) : (
            <Link href="/auth/signin" className="btn-ghost h-9 !px-3 text-xs">Sign in</Link>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto whitespace-nowrap border-t border-ink-900/5 px-2 text-xs font-semibold sm:hidden dark:border-white/10 [scrollbar-width:none]">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={`shrink-0 px-3 py-2 ${path === n.href ? "text-brand-600" : "text-ink-500 dark:text-ink-300"}`}>{n.label}</Link>
        ))}
      </nav>
    </header>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="8" className="fill-brand-500" />
      <rect x="5" y="15" width="6" height="8" rx="1" fill="white" opacity=".8" />
      <rect x="12.5" y="10" width="4.5" height="13" rx="1" fill="white" opacity=".9" />
      <rect x="18.5" y="4" width="4.5" height="19" rx="1" fill="white" />
    </svg>
  );
}
