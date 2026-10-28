import type { ReactNode } from "react";
import type { ClosetGap } from "@/lib/shop/detect-gaps";
import type { ShoppingTier } from "@/types/database";

export const TIER_LABEL: Record<ShoppingTier, string> = {
  lower: "Accessible",
  contemporary: "Contemporary",
  designer: "Designer",
};

const SEVERITY_LABEL: Record<ClosetGap["severity"], string> = {
  high: "Missing",
  medium: "Worth adding",
  low: "Nice to have",
};

/**
 * One closet gap. Shared by the client's Gaps & shop tab and the stylist console, so both
 * read the same gap the same way; the client's version adds brands and actions as children.
 */
export function GapRow({ gap, summary, children }: { gap: ClosetGap; summary?: string | null; children?: ReactNode }) {
  return (
    <li className="border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-ink">
          {gap.category}
          {gap.occasion ? ` · ${gap.occasion}` : gap.season ? ` · ${gap.season}` : ""}
        </p>
        <p className={gap.severity === "high" ? "text-[12px] font-semibold text-accent" : "text-[12px] text-ink-muted"}>
          {SEVERITY_LABEL[gap.severity]}
        </p>
      </div>
      <p className="mt-1.5 text-[14px] leading-[21px] text-ink">{summary || gap.description}</p>
      {gap.pairsWith > 0 && (
        <p className="mt-1 text-[12px] text-ink-muted">
          Would go with {gap.pairsWith} piece{gap.pairsWith === 1 ? "" : "s"} already in the closet
        </p>
      )}
      {children}
    </li>
  );
}
