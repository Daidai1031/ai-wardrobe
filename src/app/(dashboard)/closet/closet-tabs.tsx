"use client";

import type { ReactNode } from "react";
import { BarChart3, Shirt, ShoppingBag } from "lucide-react";
import { PageTabs } from "@/components/layout/page-tabs";

// Analytics and gaps sit next to the items they are computed from (moved from /profile).
const TABS = [
  { id: "items", label: "Items", icon: Shirt },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "gaps", label: "Gaps & shop", icon: ShoppingBag },
] as const;

export type ClosetTab = (typeof TABS)[number]["id"];

export function ClosetTabs({
  initialTab,
  panels,
}: {
  initialTab: ClosetTab;
  panels: Record<ClosetTab, ReactNode>;
}) {
  return <PageTabs tabs={TABS} initialTab={initialTab} panels={panels} defaultTab="items" />;
}
