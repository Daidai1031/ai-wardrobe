"use client";

import type { ReactNode } from "react";
import { ShieldCheck, User } from "lucide-react";
import { PageTabs } from "@/components/layout/page-tabs";

// Closet analytics used to be a tab here; it moved to /closet next to the gaps it feeds.
const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "privacy", label: "Permissions & privacy", icon: ShieldCheck },
] as const;

export type ProfileTab = (typeof TABS)[number]["id"];

export function ProfileTabs({
  initialTab,
  panels,
}: {
  initialTab: ProfileTab;
  panels: Record<ProfileTab, ReactNode>;
}) {
  return <PageTabs tabs={TABS} initialTab={initialTab} panels={panels} defaultTab="profile" />;
}
