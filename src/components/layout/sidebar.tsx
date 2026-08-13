"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Home,
  Shirt,
  Sparkles,
  MessageCircle,
  User,
  BarChart3,
  Plane,
  Calendar,
  LogOut,
  Menu,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/plan", label: "This Week", icon: Calendar },
  { href: "/closet", label: "My Closet", icon: Shirt },
  { href: "/outfits", label: "Outfits", icon: Sparkles },
  { href: "/stylist", label: "AI Stylist", icon: MessageCircle },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/travel", label: "Travel", icon: Plane },
  { href: "/profile", label: "Profile", icon: User },
];

const CLIENTS_NAV = { href: "/pro", label: "Clients", icon: Users };

/**
 * Roles come from the layout (a Server Component) rather than being read here: they
 * live on `profiles`, and a client-side lookup would both flash the wrong nav on first
 * paint and add a query to every page.
 *
 * A staff-only account (`roles = {stylist}`) gets the console and nothing else — not
 * even Profile, which is entirely client-side settings (city, timezone, Google Calendar,
 * stylist sharing) that a staff account has no use for. It has no closet of its own, so
 * Home/Plan/Outfits would be seven links to empty pages, and Sign out lives at the
 * bottom of the sidebar rather than inside Profile, so nothing is stranded by dropping
 * it. An account carrying both roles keeps the full nav plus Clients — that's the
 * dev/owner case, and hiding the client app from it would make the product untestable.
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = !isClient && isStylist
    ? [CLIENTS_NAV]
    : isStylist
      ? [...NAV_ITEMS, CLIENTS_NAV]
      : NAV_ITEMS;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const navContent = (
    <>
      <div className="p-5 border-b border-surface-200">
        <h1 className="font-display text-lg font-semibold text-surface-900">
          AI Wardrobe
        </h1>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-surface-600 hover:bg-surface-100 hover:text-surface-900"
              )}
            >
              <Icon size={18} strokeWidth={active ? 2 : 1.5} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-surface-200">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-surface-500 hover:bg-surface-100 hover:text-surface-700 w-full transition-colors"
        >
          <LogOut size={18} strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-surface-200 flex items-center justify-between px-4 z-40">
        <h1 className="font-display text-lg font-semibold">AI Wardrobe</h1>
        <button onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "lg:hidden fixed top-14 left-0 bottom-0 w-64 bg-white border-r border-surface-200 z-50 flex flex-col transition-transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-56 bg-white border-r border-surface-200 flex-col z-30">
        {navContent}
      </aside>
    </>
  );
}
