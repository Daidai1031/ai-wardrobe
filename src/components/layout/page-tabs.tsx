"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageTab<Id extends string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

/**
 * The tab strip `/profile` and `/closet` share. Panels are server-rendered by the page and
 * passed in, so a panel's query runs on the server and nothing is fetched twice. Inactive
 * panels stay mounted (hidden) so an unsaved edit or a scrolled grid survives a look at
 * another tab.
 *
 * The chosen tab is written back to `?tab=` with `replaceState`, so a reload or a shared
 * link lands on the same tab without a navigation (which would re-run the page's queries).
 */
export function PageTabs<Id extends string>({
  tabs,
  initialTab,
  panels,
  defaultTab,
}: {
  tabs: readonly PageTab<Id>[];
  initialTab: Id;
  panels: Record<Id, ReactNode>;
  /** The tab that needs no `?tab=` in the URL. */
  defaultTab: Id;
}) {
  const [tab, setTab] = useState<Id>(initialTab);

  function select(id: Id) {
    setTab(id);
    const url = new URL(window.location.href);
    if (id === defaultTab) url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-surface-200 max-lg:-mx-4 max-lg:px-4 max-lg:scrollbar-hide" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => select(id)}
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

      {tabs.map(({ id }) => (
        <div key={id} role="tabpanel" hidden={tab !== id}>
          {panels[id]}
        </div>
      ))}
    </div>
  );
}
