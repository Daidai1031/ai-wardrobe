"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/plan", label: "This week" },
  { href: "/travel", label: "Trips" },
];

/**
 * Phone only. Travel has no tab of its own on the bottom bar - it lives under Plan - so
 * this is how you get between the two. On desktop both are in the sidebar and this hides.
 */
export function PlanTravelSwitch() {
  const pathname = usePathname();
  return (
    <div className="flex gap-5 border-b border-border lg:hidden">
      {TABS.map(({ href, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "-mb-px border-b-2 pb-2 text-button transition-colors",
              active ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink"
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
