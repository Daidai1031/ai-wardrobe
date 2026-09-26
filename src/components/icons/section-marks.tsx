"use client";

/**
 * Small solid-block glyphs for section headings that used to share the same
 * lucide `Sparkles` icon (Today's plan / Style swipe / From your stylist —
 * indistinguishable at a glance). Deliberately not line icons: flat
 * `currentColor` shapes, no stroke, no radius, matching the rest of the
 * system's sharp-edged treatment. Shape carries the meaning since color
 * doesn't (`text-ink-muted` throughout, same as the icons they replace):
 * two stacked blocks for a day split into segments, two offset blocks for a
 * stack to swipe through, a chip-framed avatar silhouette for the one human
 * surface in the product.
 */

import { useId } from "react";

interface MarkProps {
  size?: number;
  className?: string;
}

export function PlanMark({ size = 16, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="2" width="10" height="5" fill="currentColor" />
      <rect x="3" y="9" width="10" height="5" fill="currentColor" />
    </svg>
  );
}

export function SwipeMark({ size = 16, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="4" width="9" height="9" fill="currentColor" fillOpacity="0.35" />
      <rect x="5" y="1" width="9" height="9" fill="currentColor" />
    </svg>
  );
}

export function StylistMark({ size = 16, className }: MarkProps) {
  const clipId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="8" cy="8" r="7" />
        </clipPath>
      </defs>
      {/* Chip frame */}
      <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.16" />
      {/* Head + shoulders silhouette, clipped to the frame */}
      <g clipPath={`url(#${clipId})`}>
        <circle cx="8" cy="6.1" r="2.35" fill="currentColor" />
        <circle cx="8" cy="15.5" r="5.4" fill="currentColor" />
      </g>
    </svg>
  );
}
