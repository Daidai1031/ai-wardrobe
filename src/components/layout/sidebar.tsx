"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const NAV_ITEMS: { href: string; label: string; mobileLabel?: string }[] = [
  { href: "/home", label: "Home" },
  { href: "/plan", label: "Plan" },
  { href: "/closet", label: "My Closet", mobileLabel: "Closet" },
  { href: "/outfits", label: "Outfits" },
  { href: "/travel", label: "Travel" },
];

const USER_NAV = { href: "/profile", label: "User" };

const CLIENTS_NAV: { href: string; label: string; mobileLabel?: string } = {
  href: "/pro",
  label: "Clients",
};

/**
 * On a phone Travel is not its own tab: the bar has room for five slots, and trips are
 * planning too, so they sit under Plan (a This week / Trips switch at the top of both
 * pages) and Plan stays lit anywhere in that pair.
 */
const MOBILE_HIDDEN = new Set(["/travel"]);
const MOBILE_ALSO_ACTIVE: Record<string, string[]> = { "/plan": ["/travel"] };

function UserAvatar({ active, size }: { active: boolean; size: number }) {
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-full border transition-colors",
        active ? "border-ink" : "border-border"
      )}
      style={{ width: size, height: size }}
    >
      {/* user-avatar.png is user.png cropped square and re-drawn with heavier strokes: the
          original's hairlines vanish when a 900px drawing is shrunk to 30px. Unoptimized on
          purpose, so the browser doesn't thin it out a second time. */}
      <Image
        src="/icons/user-avatar.png"
        alt=""
        fill
        sizes={`${size}px`}
        unoptimized
        className="scale-[1.08] object-cover"
      />
    </span>
  );
}

/** One slot of the phone bottom bar: just the name; the current page is a black capsule. */
function mobileTabClass(active: boolean) {
  return cn(
    "mx-px flex h-10 flex-1 items-center justify-center rounded-full text-[14px] leading-none transition-colors",
    active ? "bg-ink font-semibold text-ink-inverse" : "text-ink-muted"
  );
}

/**
 * An editorial index rather than an icon list: a two-digit number, then the name. The
 * current page is the one thing that changes — its label goes black and semibold with an
 * underline, and its number turns orange. Square and unfilled throughout, since rounded
 * boxes are reserved for buttons; the number is orange only here, as a marker, never a fill.
 */
function navLinkClass(active: boolean) {
  return cn(
    "flex items-baseline gap-2.5 px-3 py-2 text-[15px] leading-6 transition-colors",
    active ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"
  );
}

function NavNumber({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={cn(
        "w-5 shrink-0 text-[10.5px] font-bold leading-none tracking-[0.04em] tabular-nums transition-colors",
        active ? "text-accent" : "text-ink-muted/70"
      )}
    >
      {String(n).padStart(2, "0")}
    </span>
  );
}

/**
 * Roles come from the layout (a Server Component) rather than being read here: they
 * live on `profiles`, and a client-side lookup would both flash the wrong nav on first
 * paint and add a query to every page.
 *
 * "User" (`/profile`) sits at the bottom and is where Sign out lives, so an account
 * with a client side needs nothing else down there. A staff-only account
 * (`roles = {stylist}`) gets the console and nothing else — `/profile` is entirely
 * client-side settings (city, timezone, Google Calendar, stylist sharing) that it has
 * no use for — which would leave it with no way to sign out, so it keeps a Sign out
 * button in the sidebar instead. An account carrying both roles keeps the full nav plus
 * Clients — that's the dev/owner case, and hiding the client app from it would make the
 * product untestable.
 */
export function Sidebar({
  isStylist = false,
  isClient = true,
}: {
  isStylist?: boolean;
  isClient?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const showUser = isClient || !isStylist;
  const navItems = !isClient && isStylist
    ? [CLIENTS_NAV]
    : isStylist
      ? [...NAV_ITEMS, CLIENTS_NAV]
      : NAV_ITEMS;

  const userActive = pathname.startsWith(USER_NAV.href);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const mobileItems = navItems.filter((item) => !MOBILE_HIDDEN.has(item.href));
  const isActiveOnMobile = (href: string) =>
    [href, ...(MOBILE_ALSO_ACTIVE[href] ?? [])].some((prefix) => pathname.startsWith(prefix));

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const navContent = (
    <>
      <div className="p-5 border-b border-border">
        <Image
          src="/icons/TSTBU Logo_orange stroke.png"
          alt="AI Wardrobe"
          width={140}
          height={66}
          className="h-12 w-auto ml-2"
          priority
        />
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, label }, index) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={navLinkClass(active)}
            >
              <NavNumber n={index + 1} active={active} />
              <span className={cn(active && "border-b-[1.5px] border-ink")}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        {showUser ? (
          <Link
            href={USER_NAV.href}
            className={navLinkClass(userActive)}
          >
            {/* Round, 28px, but laid out as 20px (-mx-1) so "User" lines up with the other labels. */}
            <span className="-mx-1 self-center">
              <UserAvatar active={userActive} size={28} />
            </span>
            <span className={cn(userActive && "border-b-[1.5px] border-ink")}>{USER_NAV.label}</span>
          </Link>
        ) : (
          <button
            onClick={handleLogout}
            className={cn(navLinkClass(false), "w-full pl-[2.625rem] text-left")}
          >
            Sign out
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Phone: the logo and the account avatar on top (the avatar opens a small menu), the
          sections along the bottom. */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-surface-200 flex items-center justify-between px-4 z-40">
        <Image
          src="/icons/TSTBU Logo_orange stroke.png"
          alt="AI Wardrobe"
          width={140}
          height={66}
          className="h-10 w-auto ml-2"
          priority
        />
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-11 w-11 items-center justify-center"
        >
          <UserAvatar active={userActive || menuOpen} size={34} />
        </button>
      </div>

      {menuOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-[45]" onClick={() => setMenuOpen(false)} />
          <div
            role="menu"
            className="lg:hidden fixed right-4 top-[52px] z-[46] min-w-[11rem] overflow-hidden rounded-sm border border-border bg-white py-1 shadow-[0_1px_2px_rgba(10,10,10,0.05),0_8px_20px_rgba(10,10,10,0.12)]"
          >
            {showUser && (
              <Link
                href={USER_NAV.href}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "block px-4 py-3 text-[15px] leading-none transition-colors hover:bg-surface-200",
                  userActive ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"
                )}
              >
                Profile
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void handleLogout();
              }}
              className="block w-full px-4 py-3 text-left text-[15px] leading-none text-ink-muted transition-colors hover:bg-surface-200 hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </>
      )}

      <nav
        aria-label="Main"
        className="lg:hidden fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-4 right-4 z-40 flex h-12 items-center rounded-full border border-border bg-white px-0.5 shadow-[0_1px_2px_rgba(10,10,10,0.05),0_8px_20px_rgba(10,10,10,0.1)]"
      >
        {mobileItems.map(({ href, label, mobileLabel }) => {
          const active = isActiveOnMobile(href);
          return (
            <Link key={href} href={href} className={mobileTabClass(active)}>
              <span className={cn(active && "border-b-[1.5px] border-ink pb-0.5")}>
                {mobileLabel ?? label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-56 bg-surface-200 flex-col z-30">
        {navContent}
      </aside>
    </>
  );
}
