"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "analytics", label: "Closet analytics", icon: BarChart3 },
  { id: "privacy", label: "Permissions & privacy", icon: ShieldCheck },
] as const;

export type ProfileTab = (typeof TABS)[number]["id"];

/**
 * The panels are server-rendered by the page and passed in, so the analytics query
 * runs on the server and nothing is fetched twice. Inactive panels stay mounted
 * (hidden) so an unsaved profile edit survives a look at another tab.
 */
export function ProfileTabs({
  initialTab,
  panels,
}: {
  initialTab: ProfileTab;
  panels: Record<ProfileTab, ReactNode>;
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-surface-200 max-lg:-mx-4 max-lg:px-4 max-lg:scrollbar-hide" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-surface-500 hover:text-surface-800"
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {TABS.map(({ id }) => (
        <div key={id} role="tabpanel" hidden={tab !== id}>
          {panels[id]}
        </div>
      ))}
    </div>
  );
}
